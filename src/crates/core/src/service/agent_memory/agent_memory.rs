use crate::agentic::core::{strip_prompt_markup, SessionSummary};
use crate::agentic::persistence::PersistenceManager;
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::session::DialogTurnData;
use crate::util::errors::*;
use log::{debug, warn};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tokio::fs;

const MEMORY_DIR_NAME: &str = "memory";
const BITFUN_DIR_NAME: &str = ".bitfun";
const MEMORY_INDEX_FILE: &str = "memory.md";
const MEMORY_INDEX_TEMPLATE: &str = "# Memory Index\n";
const MEMORY_INDEX_MAX_LINES: usize = 200;
const DAILY_MEMORY_MAX_FILES: usize = 30;
const TOPIC_MEMORY_MAX_FILES: usize = 30;
const RECENT_WORKSPACE_SESSIONS_MAX_COUNT: usize = 5;
const SESSION_MESSAGE_PREVIEW_CHAR_LIMIT: usize = 100;

fn memory_dir_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(BITFUN_DIR_NAME).join(MEMORY_DIR_NAME)
}

fn format_path_for_prompt(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn ensure_markdown_placeholder(path: &Path, content: &str) -> BitFunResult<bool> {
    if path.exists() {
        return Ok(false);
    }

    fs::write(path, content)
        .await
        .map_err(|e| BitFunError::service(format!("Failed to create {}: {}", path.display(), e)))?;

    Ok(true)
}

fn is_date_based_memory_file(file_name: &str) -> bool {
    let bytes = file_name.as_bytes();
    bytes.len() == 13
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && file_name.ends_with(".md")
        && bytes[..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

async fn list_memory_file_groups(memory_dir: &Path) -> BitFunResult<(Vec<String>, Vec<String>)> {
    let mut daily_files = Vec::new();
    let mut topic_files = Vec::new();
    let mut entries = fs::read_dir(memory_dir).await.map_err(|e| {
        BitFunError::service(format!(
            "Failed to read memory directory {}: {}",
            memory_dir.display(),
            e
        ))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        BitFunError::service(format!(
            "Failed to iterate memory directory {}: {}",
            memory_dir.display(),
            e
        ))
    })? {
        let file_type = entry.file_type().await.map_err(|e| {
            BitFunError::service(format!(
                "Failed to inspect memory entry {}: {}",
                entry.path().display(),
                e
            ))
        })?;
        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.ends_with(".md") || file_name == MEMORY_INDEX_FILE {
            continue;
        }

        if is_date_based_memory_file(&file_name) {
            daily_files.push(file_name);
        } else {
            topic_files.push(file_name);
        }
    }

    daily_files.sort();
    daily_files.reverse();
    topic_files.sort();

    Ok((daily_files, topic_files))
}

fn format_system_time_for_prompt(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Local> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

fn normalize_message_preview(content: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "(empty user message)".to_string();
    }

    normalized
        .chars()
        .take(SESSION_MESSAGE_PREVIEW_CHAR_LIMIT)
        .collect()
}

fn escape_prompt_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn build_turn_preview_value(turn: Option<&DialogTurnData>) -> String {
    // Session previews should reflect the user's visible text, not injected prompt markup.
    turn.map(|turn| normalize_message_preview(&strip_prompt_markup(&turn.user_message.content)))
        .unwrap_or_else(|| "(no saved user messages)".to_string())
}

fn build_session_preview_tags(turns: &[DialogTurnData]) -> String {
    match turns {
        [] => "<user_message_preview>(no saved user messages)</user_message_preview>".to_string(),
        [turn] => format!(
            "<user_message_preview>{}</user_message_preview>",
            escape_prompt_text(&build_turn_preview_value(Some(turn)))
        ),
        _ => format!(
            "<first_user_message_preview>{}</first_user_message_preview>\n<last_user_message_preview>{}</last_user_message_preview>",
            escape_prompt_text(&build_turn_preview_value(turns.first())),
            escape_prompt_text(&build_turn_preview_value(turns.last())),
        ),
    }
}

async fn build_recent_workspace_sessions_content(
    workspace_root: &Path,
    current_session_id: Option<&str>,
) -> String {
    let path_manager = match try_get_path_manager_arc() {
        Ok(path_manager) => path_manager,
        Err(err) => {
            warn!(
                "Failed to initialize PathManager for workspace session prompt section: {}",
                err
            );
            return "(workspace session data unavailable)".to_string();
        }
    };

    let persistence_manager = match PersistenceManager::new(path_manager) {
        Ok(manager) => manager,
        Err(err) => {
            warn!(
                "Failed to initialize PersistenceManager for workspace session prompt section: {}",
                err
            );
            return "(workspace session data unavailable)".to_string();
        }
    };

    let recent_sessions = match persistence_manager.list_sessions(workspace_root).await {
        Ok(sessions) => sessions
            .into_iter()
            .filter(|session| Some(session.session_id.as_str()) != current_session_id)
            .take(RECENT_WORKSPACE_SESSIONS_MAX_COUNT)
            .collect::<Vec<_>>(),
        Err(err) => {
            warn!(
                "Failed to load workspace sessions for agent memory prompt: workspace={} error={}",
                workspace_root.display(),
                err
            );
            return "(workspace session data unavailable)".to_string();
        }
    };

    if recent_sessions.is_empty() {
        return "(no other recent workspace sessions found)".to_string();
    }

    let mut entries = Vec::with_capacity(recent_sessions.len());
    for session in recent_sessions {
        entries.push(
            build_recent_workspace_session_entry(&persistence_manager, workspace_root, &session)
                .await,
        );
    }

    entries.join("\n\n")
}

async fn build_recent_workspace_session_entry(
    persistence_manager: &PersistenceManager,
    workspace_root: &Path,
    session: &SessionSummary,
) -> String {
    let turns = match persistence_manager
        .load_session_turns(workspace_root, &session.session_id)
        .await
    {
        Ok(turns) => turns,
        Err(err) => {
            warn!(
                "Failed to load session turns for agent memory prompt: session_id={} error={}",
                session.session_id, err
            );
            Vec::new()
        }
    };

    let preview_tags = build_session_preview_tags(&turns);

    format!(
        r#"<session id="{}" name="{}" created_at="{}" last_active_at="{}" turn_count="{}">
{}
</session>"#,
        escape_prompt_text(&session.session_id),
        escape_prompt_text(&session.session_name),
        format_system_time_for_prompt(session.created_at),
        format_system_time_for_prompt(session.last_activity_at),
        session.turn_count,
        preview_tags,
    )
}

pub(crate) async fn ensure_workspace_memory_files_for_prompt(
    workspace_root: &Path,
) -> BitFunResult<()> {
    let memory_dir = memory_dir_path(workspace_root);
    if !memory_dir.exists() {
        fs::create_dir_all(&memory_dir).await.map_err(|e| {
            BitFunError::service(format!(
                "Failed to create memory directory {}: {}",
                memory_dir.display(),
                e
            ))
        })?;
    }
    let created_memory_index =
        ensure_markdown_placeholder(&memory_dir.join(MEMORY_INDEX_FILE), MEMORY_INDEX_TEMPLATE)
            .await?;

    debug!(
        "Ensured workspace agent memory files: path={}, created_memory_index={}",
        workspace_root.display(),
        created_memory_index
    );

    Ok(())
}

pub(crate) async fn build_workspace_agent_memory_prompt(
    workspace_root: &Path,
    current_session_id: Option<&str>,
) -> BitFunResult<String> {
    ensure_workspace_memory_files_for_prompt(workspace_root).await?;

    let memory_dir = memory_dir_path(workspace_root);
    let memory_dir_display = format_path_for_prompt(&memory_dir);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let mut section = format!(
        r#"# Agent Memory

You have access to a workspace memory space under `{memory_dir_display}`.

Use it to preserve continuity across conversations. Save only information that is likely to help in future turns: durable preferences, project constraints, important decisions, ongoing plans, and meaningful outcomes. Do not save trivial chatter or temporary details.

## How to use memory
- Read: use Grep/Read to search and retrieve memories when past preferences, decisions, constraints, or ongoing work may matter, especially at the start of a new task, before making decisions, or when the user refers to prior plans or preferences.
- Write: use Edit/Write to create or update memory files when something should survive beyond the current turn.

Write especially for:
- stable user preferences
- project constraints or conventions
- important decisions
- progress, plans, or handoff context
- knowledge a future agent should not need to rediscover
Heuristic: if you expect to want this in a future session, save a short note.
Write once the information is clear enough to be useful. Prefer natural pauses or completed work; do not wait for a formal session end.

## File roles
- `memory.md`: the concise index. Link to important memory files with short summaries, not full details. Use it as a map, not the place for the full facts.
- topic files: durable knowledge organized by subject. Prefer one file per topic; group related durable notes such as user preferences in the same file.
- daily files: date-based notes for important work from a specific day, using `YYYY-MM-DD.md`. Record key outcomes, decisions, and handoff context rather than a full transcript. Current date: `{today}`.

## Topic vs daily
- Use a topic file for lasting knowledge by subject.
- Use a daily file for what happened on a specific date.
- If something is both dated and durable, note it in the daily file for `{today}` and update the relevant topic file.
- Example: a project decision made on `{today}` belongs in both places; a stable preference or lasting technical fact usually belongs in a topic file.

## Writing guidance
Prefer short bullet points. A good `memory.md` is a short list of links with one-line summaries. A good topic or daily file is a few high-signal bullet points rather than a long narrative.
Example: put `user-preferences.md - Stable user preferences` in `memory.md`, and put `- User dislikes emoji.` in `user-preferences.md`.
Avoid duplication. If the memory space is empty, that is normal; create files only when you have something worth keeping. If you create a useful topic file, consider adding it to `memory.md`.

## Memory space files
The following sections describe the memory files currently available in this workspace.
"#
    );

    let index_path = memory_dir.join(MEMORY_INDEX_FILE);
    let (index_content, index_description_suffix) = match fs::read_to_string(&index_path).await {
        Ok(content) if !content.trim().is_empty() => {
            let lines = content.lines().collect::<Vec<_>>();
            let was_truncated = lines.len() > MEMORY_INDEX_MAX_LINES;
            (
                lines
                    .into_iter()
                    .take(MEMORY_INDEX_MAX_LINES)
                    .collect::<Vec<_>>()
                    .join("\n"),
                if was_truncated {
                    format!(" Showing up to {MEMORY_INDEX_MAX_LINES} lines.")
                } else {
                    String::new()
                },
            )
        }
        _ => (String::new(), String::new()),
    };

    let (daily_files, topic_files) = list_memory_file_groups(&memory_dir).await?;

    let daily_description_suffix = if daily_files.len() > DAILY_MEMORY_MAX_FILES {
        format!(" Showing up to {DAILY_MEMORY_MAX_FILES} entries.")
    } else {
        String::new()
    };
    let daily_files_content = if daily_files.is_empty() {
        "(no daily memory files yet)".to_string()
    } else {
        daily_files
            .into_iter()
            .take(DAILY_MEMORY_MAX_FILES)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let topic_description_suffix = if topic_files.len() > TOPIC_MEMORY_MAX_FILES {
        format!(" Showing up to {TOPIC_MEMORY_MAX_FILES} entries.")
    } else {
        String::new()
    };
    let topic_files_content = if topic_files.is_empty() {
        "(no topic memory files yet)".to_string()
    } else {
        topic_files
            .into_iter()
            .take(TOPIC_MEMORY_MAX_FILES)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let recent_workspace_sessions_content =
        build_recent_workspace_sessions_content(workspace_root, current_session_id).await;

    section.push_str(&format!(
        r#"
<memory_index description="The contents of `memory.md`, which acts as the high-level map for this memory space.{index_description_suffix}">
{index_content}
</memory_index>

<daily_memory_files description="Date-based journal files named in the `YYYY-MM-DD.md` format for chronological collaboration notes.{daily_description_suffix}">
{daily_files_content}
</daily_memory_files>

<topic_memory_files description="Topic-oriented memory files for durable knowledge organized by subject.{topic_description_suffix}">
{topic_files_content}
</topic_memory_files>

## Recent Sessions Preview
Structured summaries for up to 5 recent sessions from this workspace, excluding the current session. User message previews are single-line and truncated to the first {SESSION_MESSAGE_PREVIEW_CHAR_LIMIT} characters.

<recent_sessions>
{recent_workspace_sessions_content}
</recent_sessions>
"#
    ));

    Ok(section)
}
