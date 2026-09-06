#!/bin/bash
# Compare non-ASCII character streams between current file and a git baseline
cd /mnt/d/workspace/BitFun_OHOS/BitFun || exit 1
check() {
  local base="$1"; shift
  for f in "$@"; do
    git show "$base:$f" 2>/dev/null | grep -o -P "[\x80-\xFF]{1,}" | md5sum | cut -c1-8 > /tmp/na_base.txt
    grep -o -P "[\x80-\xFF]{1,}" "$f" 2>/dev/null | md5sum | cut -c1-8 > /tmp/na_cur.txt
    if ! diff -q /tmp/na_base.txt /tmp/na_cur.txt > /dev/null 2>&1; then
      # compare counts of lines with non-ascii to reduce false negatives from renames
      b=$(git show "$base:$f" 2>/dev/null | grep -c -P "[\x80-\xFF]")
      c=$(grep -c -P "[\x80-\xFF]" "$f" 2>/dev/null)
      echo "DIFF($b vs $c): $f"
    fi
  done
}
check 6e080b0af \
  src/crates/assembly/core/src/agentic/execution/execution_engine.rs \
  src/crates/assembly/core/src/agentic/session/session_manager.rs \
  src/crates/assembly/core/src/agentic/tools/implementations/skill_tool.rs \
  src/crates/assembly/core/src/agentic/tools/qt_migration_gate.rs \
  src/crates/execution/agent-runtime/tests/agent_interaction_contracts/user_question_tool_contracts.rs \
  src/crates/interfaces/acp/src/client/managed_provisioning.rs \
  src/crates/interfaces/acp/src/client/ohos_node_compat.rs \
  src/apps/desktop/src/api/matrix_skill_api.rs
check 82e6209bd \
  src/web-ui/src/app/components/NavPanel/NavSearchDialog.tsx \
  src/web-ui/src/app/scenes/agents/components/IndustryAgentCard.tsx \
  src/web-ui/src/flow_chat/components/modern/SessionShareFilesButton.tsx \
  src/web-ui/src/infrastructure/appearance/registry/defaultAppearanceRegistry.ts
check 3cccc0f6b \
  Cargo.toml src/apps/desktop/Cargo.toml \
  src/crates/adapters/matrix-adapter/Cargo.toml src/crates/adapters/matrix-adapter/src/client.rs \
  src/apps/desktop/src/api/ohos/screen_capture.rs src/apps/desktop/src/api/screen_capture.rs \
  src/apps/desktop/src/lib.rs
echo AUDIT-DONE
