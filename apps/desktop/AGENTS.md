# Desktop AGENTS.md

## Scope
- Applies to `apps/desktop/**`.
- Desktop is a presentation layer over SDK/runtime/realm plus the first-party mod host.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- Do not add direct HTTP/gRPC calls, first-party shortcuts, or local hardcoded provider/model capability lists.
- Keep mod hosting inside the existing hook/runtime surfaces; mods never call runtime SDK directly.
- Preserve established web reuse boundaries: changes under `apps/desktop/src/shell/renderer/**` may require matching adapter updates in `apps/web/src/desktop-adapter/**`.
- Tauri generated code and bridge outputs are read-only unless the task is codegen.

## Retrieval Defaults
- Start in `apps/desktop/src/shell/renderer`, `apps/desktop/src/runtime`, `apps/desktop/src-tauri/src`, and `apps/desktop/test`.
- Skip `apps/desktop/src-tauri/gen/**`, `dist/**`, generated bridge code, and large asset bundles unless required.

## Verification Commands
- TypeScript/UI: `pnpm --filter @nimiplatform/desktop typecheck`, `pnpm --filter @nimiplatform/desktop test`.
- Tauri/Rust: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets`.
- Desktop hard gates: `pnpm check:desktop-token-api-runtime-only`, `pnpm check:desktop-no-legacy-runtime-config-path`, `pnpm check:no-local-ai-private-calls`, `pnpm check:no-local-ai-tauri-commands`, `pnpm check:runtime-mod-hook-hardcut`.
