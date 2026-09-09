//! Shared `deveco-mcp` check helper for the ArkTS / C++ static-check tools.
//!
//! Calls the `check` MCP tool on the `deveco-mcp` server. When the server is
//! not connected (devecocli's MCP server was never configured, was stopped, or
//! the connection dropped), it is provisioned and started on demand from the
//! session harmony project path — mirroring deveco-code `harmony-mcp.ts`
//! `callDevecoCheck` / `restartHarmonyMcp` — so the check flow stays smooth
//! without a manual "configure the MCP server" step.
//!
//! The server command is wrapped in the user's configured terminal shell (same
//! mechanism as `devecocli_run`) so npm-installed `devecocli` `.cmd` shims on
//! Windows and SDK paths only present in shell profiles are resolved correctly.
//!
//! ## HarmonyOS PC stack overflow workaround
//!
//! On HarmonyOS PC, `add_ephemeral_server` → `start_server` → `start_process`
//! (spawning the `devecocli serve mcp` child) overflows the default 2MB tokio
//! worker stack (SIGSEGV). The fix runs `add_ephemeral_server` on a dedicated
//! OS thread with 8MB stack and an independent current-thread tokio runtime,
//! bridging the result back via a oneshot channel with a 60s timeout.

use crate::agentic::tools::framework::ToolUseContext;
use crate::service::mcp::get_global_mcp_service;
use crate::util::errors::{BitFunError, BitFunResult};
use bitfun_services_integrations::mcp::config::ConfigLocation;
use bitfun_services_integrations::mcp::protocol::{MCPToolResult, MCPToolResultContent};
use bitfun_services_integrations::mcp::{MCPConnection, MCPServerConfig, MCPServerType};
use log::{info, warn};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) const MCP_SERVER_ID: &str = "deveco-mcp";

/// Call the `check` tool on the `deveco-mcp` MCP server. If the server is not
/// connected, provision/start it on demand, then retry.
pub(crate) async fn call_deveco_mcp_check(
    files: &[String],
    context: &ToolUseContext,
) -> BitFunResult<String> {
    info!("[deveco-mcp-check] call_deveco_mcp_check enter: {} file(s)", files.len());

    let mcp_service = get_global_mcp_service()
        .ok_or_else(|| BitFunError::tool("MCP service is not initialized".to_string()))?;
    let server_manager = mcp_service.server_manager();

    // Fast path: already connected.
    if let Some(connection) = server_manager.get_connection(MCP_SERVER_ID).await {
        info!("[deveco-mcp-check] fast path: connection already established");
        return call_check_tool(&connection, files).await;
    }

    info!("[deveco-mcp-check] no existing connection; auto-provisioning");

    // Auto-provision / start the server, then retry.
    if let Err(e) = ensure_deveco_mcp_connected(context).await {
        info!("[deveco-mcp-check] ensure_deveco_mcp_connected failed: {}", e);
        return Err(BitFunError::tool(format!(
            "MCP server '{}' is not connected and could not be started automatically: {}. \
             Ensure devecocli is installed (`npm install -g devecocli`) and `devecocli serve mcp` can start.",
            MCP_SERVER_ID, e
        )));
    }

    info!("[deveco-mcp-check] ensure_deveco_mcp_connected ok; fetching connection");

    let connection = server_manager
        .get_connection(MCP_SERVER_ID)
        .await
        .ok_or_else(|| {
            BitFunError::tool(format!(
                "MCP server '{}' was started but no connection is available.",
                MCP_SERVER_ID
            ))
        })?;

    info!("[deveco-mcp-check] calling check tool");
    call_check_tool(&connection, files).await
}

async fn call_check_tool(
    connection: &Arc<MCPConnection>,
    files: &[String],
) -> BitFunResult<String> {
    info!("[deveco-mcp-check] call_check_tool enter: {} file(s)", files.len());
    let result = connection
        .call_tool("check", Some(json!({ "files": files })))
        .await
        .map_err(|e| {
            info!("[deveco-mcp-check] MCP call_tool failed: {}", e);
            BitFunError::tool(format!("MCP check call failed: {}", e))
        })?;
    if result.is_error {
        info!("[deveco-mcp-check] MCP check returned is_error");
        return Err(BitFunError::tool(extract_text(&result)));
    }
    info!("[deveco-mcp-check] MCP check ok");
    Ok(extract_text(&result))
}

/// Ensure the `deveco-mcp` server is connected. If a persisted/builtin config
/// exists, (re)start it; otherwise provision a runtime-only (ephemeral) server
/// from `devecocli serve mcp` with `PROJECT_PATH` set to the harmony cwd.
///
/// On HarmonyOS PC, `add_ephemeral_server` runs on a dedicated 8MB-stack OS
/// thread with an independent tokio runtime to avoid overflowing the default
/// 2MB tokio worker stack (see module docs).
async fn ensure_deveco_mcp_connected(context: &ToolUseContext) -> BitFunResult<()> {
    info!("[deveco-mcp] ensure_deveco_mcp_connected enter");

    let mcp_service = get_global_mcp_service()
        .ok_or_else(|| BitFunError::tool("MCP service is not initialized".to_string()))?;
    let sm = mcp_service.server_manager();

    if sm.get_connection(MCP_SERVER_ID).await.is_some() {
        info!("[deveco-mcp] connection already established (early)");
        return Ok(());
    }

    // Pre-check devecocli availability before entering start_server. On HarmonyOS
    // PC the `devecocli` npm package may not be in the app process's PATH (even
    // if it works in a login terminal). `resolve_shell_argv_for_command` only
    // checks if a shell exists, not if `devecocli` is actually reachable, so we
    // also probe by spawning `devecocli --version`.
    info!("[deveco-mcp] pre-checking devecocli availability");
    let shell_argv =
        super::exec_command::resolve_shell_argv_for_command("devecocli --version").await;
    if shell_argv.is_empty() {
        warn!("[deveco-mcp] shell not resolvable — devecocli cannot run");
        return Err(BitFunError::tool(format!(
            "{} Cannot auto-start MCP server (no shell). On HarmonyOS PC ensure devecocli is \
             installed (`npm install -g devecocli`) and in PATH, or use `arkts_check` skill / \
             DevEco Studio IDE LSP for static checks.",
            super::devecocli_run::DEVECOCLI_MISSING
        )));
    }
    info!("[deveco-mcp] shell resolved (len={}); probing devecocli --version", shell_argv.len());
    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new(&shell_argv[0])
            .args(&shell_argv[1..])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            info!(
                "[deveco-mcp] devecocli probe ok: exit={} stdout_len={}",
                output.status.code().unwrap_or(-1),
                output.stdout.len()
            );
        }
        Ok(Err(e)) => {
            warn!("[deveco-mcp] devecocli probe spawn failed: {}", e);
            return Err(BitFunError::tool(format!(
                "{} The probe `devecocli --version` failed to spawn: {}. On HarmonyOS PC the \
                 app process PATH may differ from your login terminal — ensure devecocli is \
                 installed (`npm install -g devecocli`) and its directory is in the app's PATH, \
                 or use `arkts_check` skill / DevEco Studio IDE LSP for static checks.",
                super::devecocli_run::DEVECOCLI_MISSING,
                e
            )));
        }
        Err(_) => {
            warn!("[deveco-mcp] devecocli probe timed out (5s)");
            return Err(BitFunError::tool(format!(
                "{} The probe `devecocli --version` timed out after 5s. On HarmonyOS PC the app \
                 process PATH may differ from your login terminal — ensure devecocli is \
                 installed (`npm install -g devecocli`) and its directory is in the app's PATH, \
                 or use `arkts_check` skill / DevEco Studio IDE LSP for static checks.",
                super::devecocli_run::DEVECOCLI_MISSING
            )));
        }
    }

    // 1. If a persisted/builtin config exists, (re)starting it is the cheapest
    //    path and respects the user's own config.
    info!("[deveco-mcp] trying start_server (persisted/builtin config path)");
    let _ = sm.start_server(MCP_SERVER_ID).await;
    if sm.get_connection(MCP_SERVER_ID).await.is_some() {
        info!("[deveco-mcp] start_server succeeded (persisted/builtin path)");
        return Ok(());
    }

    // 2. Provision a runtime-only ephemeral server. Run on a dedicated OS
    //    thread with 8MB stack + independent tokio runtime to avoid the tokio
    //    worker (default 2MB) stack overflow observed on HarmonyOS PC.
    info!("[deveco-mcp] provisioning ephemeral server (big-stack thread)");
    let config = build_deveco_mcp_config(context).await?;
    let sm_clone = sm.clone();

    let (tx, rx) = tokio::sync::oneshot::channel::<BitFunResult<()>>();
    let spawn_result = std::thread::Builder::new()
        .stack_size(8 * 1024 * 1024)
        .name("deveco-mcp-ephemeral-spawn".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = tx.send(Err(BitFunError::tool(format!(
                        "Failed to build runtime: {}",
                        e
                    ))));
                    return;
                }
            };
            rt.block_on(async move {
                let result = sm_clone.add_ephemeral_server(config).await;
                let _ = tx.send(result);
            });
        });
    match spawn_result {
        Ok(_) => {}
        Err(e) => {
            warn!("[deveco-mcp] big-stack thread spawn failed: {}", e);
            return Err(BitFunError::tool(format!(
                "Failed to spawn big-stack thread: {}",
                e
            )));
        }
    }
    match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(Ok(()))) => {
            info!("[deveco-mcp] add_ephemeral_server ok (big-stack thread)");
        }
        Ok(Ok(Err(e))) => {
            warn!("[deveco-mcp] add_ephemeral_server failed (big-stack thread): {}", e);
            return Err(e);
        }
        Ok(Err(_)) => {
            warn!("[deveco-mcp] add_ephemeral_server oneshot dropped (big-stack thread)");
            return Err(BitFunError::tool(
                "add_ephemeral_server thread panicked (big-stack thread)".to_string(),
            ));
        }
        Err(_) => {
            warn!("[deveco-mcp] add_ephemeral_server timed out (60s, big-stack thread)");
            return Err(BitFunError::tool(
                "add_ephemeral_server timed out after 60s (big-stack thread)".to_string(),
            ));
        }
    }

    if sm.get_connection(MCP_SERVER_ID).await.is_some() {
        info!("[deveco-mcp] ephemeral connection established");
        return Ok(());
    }
    info!("[deveco-mcp] ephemeral started but no connection — returning error");
    Err(BitFunError::tool(format!(
        "'{}' started but no MCP connection was established",
        MCP_SERVER_ID
    )))
}

/// Build a runtime-only `deveco-mcp` config, resolving the user's shell so the
/// `devecocli` command is spawnable on every platform.
async fn build_deveco_mcp_config(context: &ToolUseContext) -> BitFunResult<MCPServerConfig> {
    info!("[deveco-mcp] build_deveco_mcp_config enter");
    let command_str = "devecocli serve mcp";
    let shell_argv = super::exec_command::resolve_shell_argv_for_command(command_str).await;
    if shell_argv.is_empty() {
        info!("[deveco-mcp] build_deveco_mcp_config: shell_argv empty (devecocli missing)");
        return Err(BitFunError::tool(
            super::devecocli_run::DEVECOCLI_MISSING.to_string(),
        ));
    }
    let project_path = super::devecocli_run::resolve_harmony_cwd(context);
    info!("[deveco-mcp] build_deveco_mcp_config: project_path={}", project_path);
    Ok(build_config_from_shell(shell_argv, project_path))
}

/// Pure config builder (separated for unit testing).
fn build_config_from_shell(shell_argv: Vec<String>, project_path: String) -> MCPServerConfig {
    let command = shell_argv.first().cloned().unwrap_or_default();
    let args: Vec<String> = if shell_argv.len() > 1 {
        shell_argv[1..].to_vec()
    } else {
        Vec::new()
    };
    let mut env = HashMap::new();
    if !project_path.is_empty() {
        env.insert("PROJECT_PATH".to_string(), project_path);
    }
    MCPServerConfig {
        id: MCP_SERVER_ID.to_string(),
        name: "DevEco CLI MCP".to_string(),
        server_type: MCPServerType::Local,
        transport: None,
        command: Some(command),
        args,
        env,
        working_directory: None,
        inherit_parent_environment: None,
        headers: HashMap::new(),
        url: None,
        auto_start: true,
        enabled: true,
        location: ConfigLocation::BuiltIn,
        capabilities: Vec::new(),
        settings: HashMap::new(),
        oauth: None,
        oauth_enabled: None,
        xaa: None,
        timeouts: Default::default(),
    }
}

/// Extract concatenated text content from an MCP tool result.
fn extract_text(result: &MCPToolResult) -> String {
    if let Some(content) = &result.content {
        let texts: Vec<String> = content
            .iter()
            .filter_map(|c| match c {
                MCPToolResultContent::Text { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        if !texts.is_empty() {
            return texts.join("\n");
        }
    }
    serde_json::to_string_pretty(result).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_services_integrations::mcp::MCPServerType;

    #[test]
    fn config_uses_shell_argv_and_project_path() {
        let cfg = build_config_from_shell(
            vec![
                "/bin/zsh".to_string(),
                "-c".to_string(),
                "devecocli serve mcp".to_string(),
            ],
            "/home/user/project".to_string(),
        );
        assert_eq!(cfg.id, MCP_SERVER_ID);
        assert_eq!(cfg.server_type, MCPServerType::Local);
        assert_eq!(cfg.command.as_deref(), Some("/bin/zsh"));
        assert_eq!(
            cfg.args,
            vec!["-c".to_string(), "devecocli serve mcp".to_string()]
        );
        assert_eq!(
            cfg.env.get("PROJECT_PATH").map(|s| s.as_str()),
            Some("/home/user/project")
        );
        assert!(cfg.enabled);
        assert!(cfg.auto_start);
    }

    #[test]
    fn config_handles_empty_shell_argv() {
        let cfg = build_config_from_shell(Vec::new(), String::new());
        assert!(cfg.command.as_deref().unwrap_or("").is_empty());
        assert!(!cfg.env.contains_key("PROJECT_PATH"));
    }

    #[test]
    fn extract_text_joins_text_content() {
        let result = MCPToolResult {
            content: Some(vec![
                MCPToolResultContent::Text {
                    text: "line1".to_string(),
                },
                MCPToolResultContent::Text {
                    text: "line2".to_string(),
                },
            ]),
            is_error: false,
            structured_content: None,
            meta: None,
        };
        assert_eq!(extract_text(&result), "line1\nline2");
    }
}
