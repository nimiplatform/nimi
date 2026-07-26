# Desktop AGENTS.md

## Scope
- Applies to `apps/desktop/**`.
- Desktop is a presentation layer over SDK/runtime/realm and local AI host surfaces.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- Do not add direct HTTP/gRPC calls or local hardcoded provider/model capability lists.
- Preserve established web reuse boundaries: changes under `apps/desktop/src/shell/renderer/**` may require matching adapter updates in `apps/web/src/desktop-adapter/**`.
- Tauri generated code and bridge outputs are read-only unless the task is codegen.
- Authority preflight is required only for a redesign that changes product semantics or canonical ownership.
- Alignment and bounded fixes follow existing authority; redesign requires prior `.nimi/spec/**` alignment.
- Desktop chat/UI must project runtime authority, not invent a parallel executable truth in renderer-local state.

## Retrieval Defaults
- Start at the observed Desktop consumer, its direct adapter or bridge, and the exact authority it implements.
- Inspect `apps/web/src/desktop-adapter/**` only when the affected renderer surface is shared.
- Skip generated Tauri/bridge outputs, `dist/**`, large assets, and unrelated layers.

## Verification Commands
- Renderer: `pnpm --filter @nimiplatform/desktop typecheck` and the directly affected test.
- Rust/Tauri changes: targeted `cargo check` or `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- Run only the Desktop boundary gate that covers the changed import, chat, bridge, or authority surface.
