# AGENTS.md

## Scope
- Treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- App Tools maintains its identity/contract projections and the declared engineering fields in `.nimi/config` and `.nimi/admission`; the build profile and product declarations retain their App-owned inputs. Nimi-coding maintains its own methodology and AGENTS block through its declared sync command.
- Keep auth, Runtime, App Access declaration, manifest, and Tauri shell glue in scaffold-managed files.
- App-owned product code is `src/workbench-core/**`, selected `src/capabilities/**`, `src/shell/routes/product-area.tsx`, and App-authored product screens, state, tests, styles, and bounded native helpers.
- Scaffold-managed code is the carrier/auth wiring, identity, manifests, project tooling, bounded native integration, and `src/scaffold/generated/**` composition glue.
- Treat this template as the identity-neutral, Lab-derived base. The generator composes it positively with only the dependency closure of explicitly selected admitted features under `src/capabilities/**`.
- The scaffold contains developer build/release inputs and one managed GitHub workflow, but it must not generate public admission, listing, registry-main, installed, running, or Runtime-access truth.

## Hard Boundaries
- Follow `Runtime / Realm truth -> @nimiplatform/sdk interface -> app consumer`.
- Runtime owns AI execution and its exact configuration/admission; Cognition owns canonical long-term Memory and Knowledge. Realm owns ecosystem identity, relationships and shared entities; App business state follows its declared storage boundary.
- Use SDK typed projections for Runtime and Realm; do not call private endpoints or mirror their canonical truth locally.
- Use `@nimiplatform/kit` for reusable controls, layout, accessibility, tokens, and interaction patterns; keep app CSS and composition product-specific.
- Keep the base free of Lab-only product behavior. Feature implementations enter generated output only through the app-tools module registry and public admitted `--features` selection. Internal modules such as `ai-studio-core` enter only through dependency closure and are never selected directly.
- Keep Lab-only Settings/account, App Access diagnostics, Realm/Agent probes, World Tour, and native or diagnostic surfaces outside generated product composition.
- Preserve ownership: `sync` may refresh scaffold-managed files but must not overwrite app-owned workbench or module code; `check` is non-mutating. Identity and direct feature selection are immutable; create a fresh scaffold to change them.
- Preserve lifecycle order: `create -> dependency install -> init -> sync -> check -> dev/test/build -> pack`. Never run lifecycle commands after `create` before dependencies are installed. Local publish remains unavailable; production publication is owned by the managed protected-tag GitHub workflow, while registry admission and installation remain separate later owners.
- Keep public dependency version declarations and the selected package matrix. Development may resolve complete local npm tarballs through the explicit overrides supported by the selected app-tools README; source-workspace and directory links remain invalid. Public-release preflight requires registry resolutions. A private workspace-validation result is not standalone evidence.
- Use generated Host, preload, renderer and SDK/Kit wiring as the foundation for session, App Access, AIConfig and AI calls. An existing App adaptation starts with a same-package generated reference and preserves the original product's workflows and business settings; do not substitute a reference workbench for the complete App.
- Use the scaffold-managed Kit Electron app-host bridge for supervised local development. Treat `nimi-shell-tauri` glue, where present, as bounded independent OS integration only, never a second local-development carrier, authority, App registration, admission, model-routing, or token-custody surface.
- Do not add provider/model hardcoding, compatibility dual-writes, pseudo-success, Runtime internals, generated private clients, or Desktop product source.
- Before durable storage, native commands, private calls, or registries, inspect the nearest contract and current consumer; ask only if multiple semantic owners remain plausible.

## Retrieval Defaults
- Feasibility, capability-fit and cost requests use the lifecycle skill's audit guide before implementation setup. When following an audit, preserve confirmed user decisions and verify consequential assumptions against current owner contracts rather than treating the report as authority.
- Start with the requested product route, its direct SDK/Kit surface, and the relevant scaffold-managed glue.
- Read platform authority only when ownership or semantics remain ambiguous; skip unrelated platform packages and generated files.

## Verification Commands
- Initial setup: after `pnpm install` and `pnpm run init`, run `pnpm run sync`, `pnpm run check`, the directly affected tests, and the affected build.
- In an initialized project, app-owned changes use the directly affected tests and build. Rerun sync/check when scaffold inputs, managed glue, or dependencies change, and before packaging; do not repeat initialization for ordinary product edits.
- Run the official Desktop-supervised App journey when product interaction is in scope; shell or native checks alone do not replace it.
- Mark every product path not actually run as `NOT-VERIFIED`. Help text, focused tests, and CDP visibility do not establish implementation or release acceptance.
