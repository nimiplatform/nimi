# AGENTS.md

## Scope
- Treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections created by `pnpm run init`.
- Keep auth, Runtime, App Access declaration, manifest, and Tauri shell glue in scaffold-managed files.
- App-owned product code is `src/workbench-core/**`, selected `src/capabilities/**`, `src/shell/routes/product-area.tsx`, and App-authored product screens, state, tests, styles, and bounded native helpers.
- Scaffold-managed code is the carrier/auth wiring, identity, manifests, project tooling, bounded native integration, and `src/scaffold/generated/**` composition glue.
- Treat this template as the identity-neutral, Lab-derived base. The generator composes it positively with only the dependency closure of explicitly selected admitted features under `src/capabilities/**`.
- The current scaffold is local-development-only and must not generate public admission, listing, release, registry, or install truth.

## Hard Boundaries
- Follow `Runtime / Realm truth -> @nimiplatform/sdk interface -> app consumer`.
- Runtime owns local execution, capability, readiness, routing, model, and memory truth; Realm owns canonical cloud identity, relationships, entities, and shared persistence.
- Use SDK typed projections for Runtime and Realm; do not call private endpoints or mirror their canonical truth locally.
- Use `@nimiplatform/kit` for reusable controls, layout, accessibility, tokens, and interaction patterns; keep app CSS and composition product-specific.
- Keep the base free of Lab-only product behavior. Feature implementations enter generated output only through the app-tools module registry and public admitted `--features` selection. Internal modules such as `ai-studio-core` enter only through dependency closure and are never selected directly.
- Keep Lab-only Settings/account, App Access diagnostics, Realm/Agent probes, World Tour, and native or diagnostic surfaces outside generated product composition.
- Preserve ownership: doctor/update may refresh scaffold-managed files but must not overwrite app-owned workbench or module code. Identity and direct feature selection are immutable; create a fresh scaffold to change them.
- Preserve lifecycle order: `create -> dependency install -> init -> doctor/build -> Desktop-supervised dev`. Never run `init`, `doctor`, or `update` before dependencies are installed.
- This third-party scaffold uses public registry versions only; do not substitute workspace paths, local overrides, tarballs, or downgrades. A private workspace-validation result is not standalone evidence.
- Use the scaffold-managed Kit Electron app-host bridge for supervised local development. Treat `nimi-shell-tauri` glue, where present, as bounded independent OS integration only, never a second local-development carrier, authority, App registration, admission, model-routing, or token-custody surface.
- Do not add provider/model hardcoding, compatibility dual-writes, pseudo-success, Runtime internals, generated private clients, or Desktop product source.
- Before durable storage, native commands, private calls, or registries, inspect the nearest contract and current consumer; ask only if multiple semantic owners remain plausible.

## Retrieval Defaults
- Start with the requested product route, its direct SDK/Kit surface, and the relevant scaffold-managed glue.
- Read platform authority only when ownership or semantics remain ambiguous; skip unrelated platform packages and generated files.

## Verification Commands
- After `pnpm install` and `pnpm run init`, run `pnpm run doctor`, the directly affected tests, `pnpm run validate`, and the affected build.
- Run the official Desktop-supervised App journey when product interaction is in scope; shell or native checks alone do not replace it.
- Mark every product path not actually run as `NOT-VERIFIED`. Help text, focused tests, and CDP visibility do not establish implementation or release acceptance.
