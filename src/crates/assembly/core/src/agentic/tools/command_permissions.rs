use super::framework::{PermissionIntent, ToolUseContext};
use super::restrictions::is_local_path_within_root;
use crate::util::errors::BitFunResult;
use std::path::Path;
use tool_runtime::shell::command_for_working_directory;

/// Reuse a command only when its effective directory is known to be in the
/// local workspace. External/remote directories retain their exact resource.
pub(crate) fn command_permission_intent(
    command: &str,
    working_directory: Option<&str>,
    context: &ToolUseContext,
) -> BitFunResult<PermissionIntent> {
    let mut intent = PermissionIntent::new(
        "bash",
        vec![command_for_working_directory(command, working_directory)],
    );
    let Some(directory) = working_directory else {
        // Legacy Bash can inherit a mutable terminal cwd. A bare command alone
        // cannot identify that scope; configured Allow still works as usual.
        intent.save_resources.clear();
        return Ok(intent);
    };
    if !context.is_remote() {
        if let Some(root) = context.workspace_root() {
            if is_local_path_within_root(Path::new(directory), root)? {
                intent.save_resources = vec![command.to_string()];
                intent
                    .display_metadata
                    .insert("saveScope".into(), "workspace_command".into());
            }
        }
    }
    Ok(intent)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::agentic::WorkspaceBinding;

    #[test]
    fn a_symlink_to_an_external_directory_keeps_an_exact_command_scope() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let link = workspace.join("linked");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let context =
            ToolUseContext::for_tool_listing(Some(WorkspaceBinding::new(None, workspace)), None);
        let intent =
            command_permission_intent("python cleanup.py", link.to_str(), &context).unwrap();
        assert_eq!(intent.save_resources, intent.resources);
        assert!(!intent.display_metadata.contains_key("saveScope"));
    }
}
