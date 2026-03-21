# Contributing

[中文版](./CONTRIBUTING_CN.md)

Thanks for your interest in BitFun! BitFun is a multi-platform AI programming environment powered by Rust and TypeScript, with shared core logic across Desktop/CLI/Server. This guide explains how to contribute effectively.

## Code of Conduct

Be respectful, kind, and constructive. We welcome contributors of all backgrounds and experience levels.

## Quick Start

### Prerequisites

- Node.js (LTS recommended)
- pnpm
- Rust toolchain (install via [rustup](https://rustup.rs/))
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for desktop development

#### Windows: OpenSSL Setup

The desktop app includes SSH remote support, which requires OpenSSL. On Windows, you need to provide pre-built OpenSSL binaries and set environment variables before building.

1. Download the [FireDaemon OpenSSL 3.5.5 LTS ZIP (x86+x64+ARM64)](https://download.firedaemon.com/FireDaemon-OpenSSL/openssl-3.5.5.zip)
2. Extract to a directory, e.g. `C:\Users\<you>\openssl`
3. Set the following **user environment variables** (persist across terminal sessions):

```powershell
[System.Environment]::SetEnvironmentVariable("OPENSSL_DIR", "C:\Users\<you>\openssl\x64", "User")
[System.Environment]::SetEnvironmentVariable("OPENSSL_NO_VENDOR", "1", "User")
[System.Environment]::SetEnvironmentVariable("OPENSSL_STATIC", "1", "User")
```

4. Restart your terminal (or IDE) for the variables to take effect.

> **Alternative**: Install [Strawberry Perl](https://strawberryperl.com/) to let Cargo build OpenSSL from source automatically — no environment variables needed.

### Install dependencies

```bash
pnpm install
```

### Common commands

```bash
# Desktop
pnpm run desktop:dev
pnpm run desktop:build

# E2E
pnpm run e2e:test
```

> Note: More granular scripts are available (e.g. `dev:web`, `cli:dev`, `website:dev`). See `package.json` for details.

## Code Standards and Architecture Constraints

### Logging

- English only, avoid verbose logs
- Frontend: `createLogger('ModuleName')`
- Backend: `log::{info, debug, warn, error}` macros

### Platform-agnostic core

Do not use platform-specific dependencies in `core`:

- ❌ `tauri::AppHandle`
- ✅ `bitfun_events::EventEmitter`

### Tauri command conventions

- Command names use `snake_case`
- Keep Rust and TypeScript naming aligned
- Always use structured request format:

```rust
#[tauri::command]
pub async fn your_command(
  state: State<'_, AppState>,
  request: YourRequest,
) -> Result<YourResponse, String>
```

```ts
await api.invoke("your_command", { request: { /* ... */ } });
```

## Key Contribution Focus Areas

1. Contribute good ideas/creativity (features, interactions, visuals, etc.) by opening issues
   > Product managers and UI designers are welcome to submit ideas quickly via PI. We will help refine them for development.
2. Improve the Agent system and overall quality
3. Improve system stability and strengthen foundational capabilities
4. Expand the ecosystem (Skills, MCP, LSP plugins, or better support for domain-specific development scenarios)

## Contribution Workflow and PR Expectations

### What to Contribute (Beyond Features and Fixes)

We welcome contributions beyond standard feature or bug-fix PRs. Examples include:

| Contribution area | Location / files | Example |
| --- | --- | --- |
| Prompts | `src/crates/core/src/agentic/agents/prompts/` | Add or refine prompts, and update related logic as needed |
| Tools | `src/crates/core/src/agentic/tools/implementations/`, `src/crates/core/src/agentic/tools/registry.rs` | Add tool implementations and register them in the tool registry |
| Subagents | `src/crates/core/src/agentic/agents/custom_subagents/`, `src/crates/core/src/agentic/agents/registry.rs` | Add subagent implementations and register them in the subagent registry |
| Mode contributions | `src/crates/core/src/agentic/agents/*_mode.rs`, `src/crates/core/src/agentic/agents/prompts/*_mode.md`, `src/web-ui/src/locales/*/settings/modes.json` | Add/improve agent modes (e.g. Plan/Debug/Agentic or custom modes) and keep prompts + UI copy in sync |
| Scenario guides for Code Agent and AIIde | `website/src/docs/` | Add workflows, playbooks, and real-world scenario docs (or link them from `README.md`) |

### Before you start

- Open an issue to describe the problem or proposal, especially for larger changes, to avoid duplication and design conflicts
- For new features or UI changes, discuss the design direction early to ensure it fits the product experience

### PR title and description

We recommend using Conventional Commits for clearer history and better automation:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `chore:` maintenance/deps
- `refactor:` refactor without behavior change
- `test:` tests

UI changes should include before/after screenshots or a short recording for fast review.

If your work is AI-assisted, please note it in the PR and indicate testing level (untested/lightly tested/fully tested) to help reviewers assess risk.

### Branch management

**The `master` branch is for stable features and does not accept feature merges.** Since this repo encourages product managers and developers to use AI-generated code for rapid validation or idea submission, **please open all PRs targeting the `dev` branch**. We will periodically review and polish changes in `dev`, then merge back into `master`.

### Scope

Keep PRs small and focused. Avoid bundling unrelated changes.

## Testing and Verification

Run relevant tests for your change:

```bash
# Rust
cargo test --workspace

# E2E
pnpm run e2e:test
```

If you cannot run tests, explain why in the PR and provide manual verification steps.



## Security and Compliance

- Do not commit secrets, tokens, certificates, or any sensitive data
- When adding dependencies, ensure license compatibility and explain the purpose

## Thanks

Every contribution matters. Issues, PRs, and suggestions are all welcome!
