# AGENTS.md

## Scope
- Treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections created by `pnpm run init`.
- Keep auth, Runtime, permission, manifest, and Tauri shell glue in scaffold-managed files.
- In a generated app, the app-owned area is src/shell/routes/product-area.tsx plus product-specific screens, view models, tests, and bounded native helpers.
- `.nimi/admission/**` and `ADMISSION.md` are developer-owned release submission inputs, not product acceptance truth.

## Hard Boundaries
- Follow `Runtime / Realm truth -> @nimiplatform/sdk interface -> app consumer`.
- Runtime owns local execution, capability, readiness, routing, model, and memory truth; Realm owns canonical cloud identity, relationships, entities, and shared persistence.
- Use SDK typed projections for Runtime and Realm; do not call private endpoints or mirror their canonical truth locally.
- Use `@nimiplatform/kit` for reusable controls, layout, accessibility, tokens, and interaction patterns; keep app CSS and composition product-specific.
- Use scaffold-managed `nimi-shell-tauri` glue for bounded OS integration only, never authority, permission grants, admission, model routing, or token custody.
- Do not add provider/model hardcoding, compatibility dual-writes, pseudo-success, Runtime internals, generated private clients, or Desktop product source.
- Before durable storage, native commands, private calls, or registries, inspect the nearest contract and current consumer; ask only if multiple semantic owners remain plausible.

## Retrieval Defaults
- Start with the requested product route, its direct SDK/Kit surface, and the relevant scaffold-managed glue.
- Read platform authority only when ownership or semantics remain ambiguous; skip unrelated platform packages and generated files.

## Verification Commands
- Run `pnpm run doctor`, the directly affected tests, and `pnpm run validate`.
- Run shell or native checks only when their managed files changed.
