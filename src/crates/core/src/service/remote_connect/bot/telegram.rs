//! Telegram bot integration for Remote Connect.
//!
//! Users create their own bot via @BotFather, obtain a token, and enter it
//! in BitFun settings.  The desktop polls for updates via the Telegram Bot
//! API (long polling) and routes messages through the shared command router.

use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::command_router::{
    execute_forwarded_turn, handle_command, paired_success_message, parse_command,
    BotInteractiveRequest, BotInteractionHandler, BotMessageSender, BotChatState, WELCOME_MESSAGE,
};
use super::{load_bot_persistence, save_bot_persistence, BotConfig, SavedBotConnection};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub bot_token: String,
}

pub struct TelegramBot {
    config: TelegramConfig,
    pending_pairings: Arc<RwLock<HashMap<String, PendingPairing>>>,
    last_update_id: Arc<RwLock<i64>>,
    chat_states: Arc<RwLock<HashMap<i64, BotChatState>>>,
}

#[derive(Debug, Clone)]
struct PendingPairing {
    created_at: i64,
}

impl TelegramBot {
    pub fn new(config: TelegramConfig) -> Self {
        Self {
            config,
            pending_pairings: Arc::new(RwLock::new(HashMap::new())),
            last_update_id: Arc::new(RwLock::new(0)),
            chat_states: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Restore a previously paired chat so the bot skips the pairing step.
    pub async fn restore_chat_state(&self, chat_id: i64, state: BotChatState) {
        self.chat_states.write().await.insert(chat_id, state);
    }

    fn api_url(&self, method: &str) -> String {
        format!(
            "https://api.telegram.org/bot{}/{}",
            self.config.bot_token, method
        )
    }

    pub async fn send_message(&self, chat_id: i64, text: &str) -> Result<()> {
        let client = reqwest::Client::new();
        let resp = client
            .post(&self.api_url("sendMessage"))
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "text": text,
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("telegram sendMessage failed: {body}"));
        }
        debug!("Telegram message sent to chat {chat_id}");
        Ok(())
    }

    /// Register the bot command menu visible in Telegram's "/" menu.
    pub async fn set_bot_commands(&self) -> Result<()> {
        let client = reqwest::Client::new();
        let commands = serde_json::json!({
            "commands": [
                { "command": "switch_workspace", "description": "List and switch workspaces" },
                { "command": "resume_session", "description": "Resume an existing session" },
                { "command": "new_code_session", "description": "Create a new coding session" },
                { "command": "new_cowork_session", "description": "Create a new cowork session" },
                { "command": "cancel_task", "description": "Cancel the current task" },
                { "command": "help", "description": "Show available commands" },
            ]
        });
        let resp = client
            .post(&self.api_url("setMyCommands"))
            .json(&commands)
            .send()
            .await?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!("Failed to set Telegram bot commands: {body}");
        }
        Ok(())
    }

    pub async fn register_pairing(&self, pairing_code: &str) -> Result<()> {
        self.pending_pairings.write().await.insert(
            pairing_code.to_string(),
            PendingPairing {
                created_at: chrono::Utc::now().timestamp(),
            },
        );
        Ok(())
    }

    pub async fn verify_pairing_code(&self, code: &str) -> bool {
        let mut pairings = self.pending_pairings.write().await;
        if let Some(p) = pairings.remove(code) {
            let age = chrono::Utc::now().timestamp() - p.created_at;
            return age < 300;
        }
        false
    }

    pub async fn poll_updates(&self) -> Result<Vec<(i64, String)>> {
        let offset = *self.last_update_id.read().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(35))
            .build()?;

        let resp = client
            .get(&self.api_url("getUpdates"))
            .query(&[
                ("offset", (offset + 1).to_string()),
                ("timeout", "30".to_string()),
            ])
            .send()
            .await?;

        let body: serde_json::Value = resp.json().await?;
        let results = body["result"].as_array().cloned().unwrap_or_default();

        let mut messages = Vec::new();
        for update in results {
            if let Some(update_id) = update["update_id"].as_i64() {
                let mut last = self.last_update_id.write().await;
                if update_id > *last {
                    *last = update_id;
                }
            }

            if let (Some(chat_id), Some(text)) = (
                update.pointer("/message/chat/id").and_then(|v| v.as_i64()),
                update.pointer("/message/text").and_then(|v| v.as_str()),
            ) {
                messages.push((chat_id, text.trim().to_string()));
            }
        }

        Ok(messages)
    }

    /// Start a polling loop that checks for pairing codes.
    /// Returns the chat_id when a valid pairing code is received.
    pub async fn wait_for_pairing(&self) -> Result<i64> {
        info!("Telegram bot waiting for pairing code...");
        loop {
            match self.poll_updates().await {
                Ok(messages) => {
                    for (chat_id, text) in messages {
                        let trimmed = text.trim();

                        if trimmed == "/start" {
                            self.send_message(chat_id, WELCOME_MESSAGE).await.ok();
                            continue;
                        }

                        if trimmed.len() == 6 && trimmed.chars().all(|c| c.is_ascii_digit()) {
                            if self.verify_pairing_code(trimmed).await {
                                info!("Telegram pairing successful, chat_id={chat_id}");
                                let success_msg = paired_success_message();
                                self.send_message(chat_id, &success_msg).await.ok();
                                self.set_bot_commands().await.ok();

                                let mut state = BotChatState::new(chat_id.to_string());
                                state.paired = true;
                                self.chat_states.write().await.insert(chat_id, state.clone());
                                self.persist_chat_state(chat_id, &state).await;

                                return Ok(chat_id);
                            } else {
                                self.send_message(
                                    chat_id,
                                    "Invalid or expired pairing code. Please try again.",
                                )
                                .await
                                .ok();
                            }
                        } else {
                            self.send_message(
                                chat_id,
                                "Please enter the 6-digit pairing code from BitFun Desktop.",
                            )
                            .await
                            .ok();
                        }
                    }
                }
                Err(e) => {
                    error!("Telegram poll error: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    }

    /// Main message loop that runs after pairing is complete.
    /// Continuously polls for messages and routes them through the command router.
    pub async fn run_message_loop(self: Arc<Self>, stop_rx: tokio::sync::watch::Receiver<bool>) {
        info!("Telegram bot message loop started");
        let mut stop = stop_rx;

        loop {
            if *stop.borrow() {
                info!("Telegram bot message loop stopped by signal");
                break;
            }

            let poll_result = tokio::select! {
                result = self.poll_updates() => result,
                _ = stop.changed() => {
                    info!("Telegram bot message loop stopped by signal");
                    break;
                }
            };

            match poll_result {
                Ok(messages) => {
                    for (chat_id, text) in messages {
                        let bot = self.clone();
                        tokio::spawn(async move {
                            bot.handle_incoming_message(chat_id, &text).await;
                        });
                    }
                }
                Err(e) => {
                    error!("Telegram poll error in message loop: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    }

    async fn handle_incoming_message(self: &Arc<Self>, chat_id: i64, text: &str) {
        let mut states = self.chat_states.write().await;
        let state = states
            .entry(chat_id)
            .or_insert_with(|| {
                let mut s = BotChatState::new(chat_id.to_string());
                s.paired = true;
                s
            });

        if !state.paired {
            let trimmed = text.trim();
            if trimmed == "/start" {
                self.send_message(chat_id, WELCOME_MESSAGE).await.ok();
                return;
            }
            if trimmed.len() == 6 && trimmed.chars().all(|c| c.is_ascii_digit()) {
                if self.verify_pairing_code(trimmed).await {
                    state.paired = true;
                    let msg = paired_success_message();
                    self.send_message(chat_id, &msg).await.ok();
                    self.set_bot_commands().await.ok();
                    self.persist_chat_state(chat_id, state).await;
                    return;
                } else {
                    self.send_message(
                        chat_id,
                        "Invalid or expired pairing code. Please try again.",
                    )
                    .await
                    .ok();
                    return;
                }
            }
            self.send_message(
                chat_id,
                "Please enter the 6-digit pairing code from BitFun Desktop.",
            )
            .await
            .ok();
            return;
        }

        let cmd = parse_command(text);
        let result = handle_command(state, cmd, vec![]).await;

        self.persist_chat_state(chat_id, state).await;
        drop(states);

        self.send_message(chat_id, &result.reply).await.ok();

        if let Some(forward) = result.forward_to_session {
            let bot = self.clone();
            tokio::spawn(async move {
                let interaction_bot = bot.clone();
                let handler: BotInteractionHandler = std::sync::Arc::new(move |interaction: BotInteractiveRequest| {
                    let interaction_bot = interaction_bot.clone();
                    Box::pin(async move {
                        interaction_bot
                            .deliver_interaction(chat_id, interaction)
                            .await;
                    })
                });
                let msg_bot = bot.clone();
                let sender: BotMessageSender = std::sync::Arc::new(move |text: String| {
                    let msg_bot = msg_bot.clone();
                    Box::pin(async move {
                        msg_bot.send_message(chat_id, &text).await.ok();
                    })
                });
                let response = execute_forwarded_turn(forward, Some(handler), Some(sender)).await;
                bot.send_message(chat_id, &response).await.ok();
            });
        }
    }

    async fn deliver_interaction(&self, chat_id: i64, interaction: BotInteractiveRequest) {
        let mut states = self.chat_states.write().await;
        let state = states
            .entry(chat_id)
            .or_insert_with(|| {
                let mut s = BotChatState::new(chat_id.to_string());
                s.paired = true;
                s
            });
        state.pending_action = Some(interaction.pending_action.clone());
        self.persist_chat_state(chat_id, state).await;
        drop(states);

        self.send_message(chat_id, &interaction.reply).await.ok();
    }

    async fn persist_chat_state(&self, chat_id: i64, state: &BotChatState) {
        let mut data = load_bot_persistence();
        data.upsert(SavedBotConnection {
            bot_type: "telegram".to_string(),
            chat_id: chat_id.to_string(),
            config: BotConfig::Telegram {
                bot_token: self.config.bot_token.clone(),
            },
            chat_state: state.clone(),
            connected_at: chrono::Utc::now().timestamp(),
        });
        save_bot_persistence(&data);
    }
}
