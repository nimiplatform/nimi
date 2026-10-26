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
- Desktop chat/UI must project runtime authority, not invent a parallel executable truth in renderer-local state.

## Retrieval Defaults
- Start at the observed Desktop consumer, its direct adapter or bridge, and the exact authority it implements.
- Skip generated bridge outputs, `dist/**`, large assets, and unrelated layers.

## Product Presentation
- Main usage flows explain the user's task, current state, action, and consequence. Runtime summaries distinguish recommendations, compatibility, installed/configured models, current selection, and actual execution; internal values belong in relevant technical details when they do not help the immediate choice.
- Judge the specific module's audience. Profile creation and other advanced editing retain precise fields, validation, and control; they do not inherit an introductory interface merely because Desktop's main experience serves ordinary users.

## Settings-like Surfaces (IA ownership)
- Home Settings owns appearance/language, notifications, profile, privacy, account-security browser handoff, data management, Developer Mode, troubleshooting and local log export in one grouped workspace. Normal Support shortcuts target Settings; no parallel normal Support workspace remains. About and legal reading belong to Help.
- AI Capabilities, Cloud Services, integrations, App configuration, Chat and cross-App Agent Center remain independent functional domains. Advanced & Diagnostics remains their secondary Runtime management destination. Do not move these domains into Home Settings merely because their configuration is shared or machine-wide.
- Troubleshooting reuses a minimal degraded recovery host without ordinary Settings, Realm preference or Runtime AI hydration. Preserve owner-permitted degraded App-cache and directory-cleanup actions; an existing ready Product Control record cannot override a current maintenance or admission failure.
- Account security, local development registrations, external-agent access and integration permissions retain their respective owners and destinations. Shared Kit Agent Center and supported App AIConfig editors may have multiple legitimate hosts.
- Reuse the Home navigation controller for normal Settings sections and protect pending autosave on controlled departure. Entry focus and compact presentation may be requested again after unchanged navigation without duplicating history. Never embed a whole feature workspace inside Settings.

## Verification Commands
- Renderer TypeScript or behavior changes: `pnpm --filter @nimiplatform/desktop typecheck` and the directly affected test.
- Product Control native changes: targeted `cargo test --manifest-path apps/desktop/product-control-core/Cargo.toml` and, when the Node binding changes, `cargo test --manifest-path apps/desktop/product-control-node/Cargo.toml`.
- Run only the Desktop boundary gate that covers the changed import, chat, bridge, or authority surface.
