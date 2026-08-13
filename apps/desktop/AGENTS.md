# Desktop AGENTS.md

## Scope
- Applies to `apps/desktop/**`.
- Desktop is a presentation layer over SDK/runtime/realm and local AI host surfaces.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- Do not add direct HTTP/gRPC calls or local hardcoded provider/model capability lists.
- Electron main/preload owns the Desktop host boundary; Desktop must not add a second native shell.
- Desktop account authentication is a browser-only Product Control gate: the renderer requests a RuntimeAccountService attempt, Electron carries the owner-issued URL and loopback callback, and the renderer receives no credential or bearer material.
- Do not add embedded Nimi account login, registration, password, OTP, two-factor, wallet, social-provider, email-verification, or login-provider management controls. Non-credential Profile projection and edit remain Desktop-owned composition; credential management opens the admitted Web account surface.
- Do not hardcode or assemble a Web login URL. Runtime unavailable or an invalid callback fails closed without a direct browser-login fallback.
- Authority preflight is required only for a redesign that changes product semantics or canonical ownership.
- Alignment and bounded fixes follow existing authority; redesign requires prior `.nimi/spec/**` alignment.
- Desktop chat/UI must project runtime authority, not invent a parallel executable truth in renderer-local state.

## Retrieval Defaults
- Start at the observed Desktop consumer, its direct adapter or bridge, and the exact authority it implements.
- Skip generated bridge outputs, `dist/**`, large assets, and unrelated layers.

## Settings-like Surfaces (IA ownership)
- Settings (account menu) owns end-user account and preference content: profile, language, appearance, privacy, security, notifications, developer-mode entry, data management, legal.
- Support (account menu) owns guided repair, diagnostics, logs, and recovery; its section set is contract-fixed (`rule.nimi.desktop.product-surfaces.r023`).
- Runtime (primary rail, `nav_group: core`) owns AI/runtime operations: profiles, models, connectors, environment, access tokens.
- Developer Tools (account menu, Developer Mode gated) owns developer-only content: local-development authorizations/activity; it routes diagnostics to Support instead of duplicating them.
- Authorization/Grant split: account projection and Web account-management handoff → Settings > Security; local-development project authorizations → Developer Tools; external-agent tokens and delegated approvals → Runtime > Environment > Access.
- Never embed a whole settings page inside another surface (or vice versa); deep-link via `settings.openSection(id)` / `setActiveTab` instead. Single-home every control exactly once.

## Verification Commands
- Renderer: `pnpm --filter @nimiplatform/desktop typecheck` and the directly affected test.
- Product Control native changes: targeted `cargo test --manifest-path apps/desktop/product-control-core/Cargo.toml` and, when the Node binding changes, `cargo test --manifest-path apps/desktop/product-control-node/Cargo.toml`.
- Run only the Desktop boundary gate that covers the changed import, chat, bridge, or authority surface.
