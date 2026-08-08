# AGENTS.md

## Scope
- Applies to `apps/tester/**`; treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections; keep auth, Runtime, permission, manifest, and shell glue in scaffold-managed files.
- The app-owned area is `src/shell/routes/product-area.tsx`, `src/tester/**`, `src-tauri/src/world_tour.rs`, `src-electron/**`, and tester contract tests.

## Hard Boundaries
- Consume Runtime and Realm only through SDK and reusable UI through Kit; do not create app-local platform truth, private transport, provider/model constants, or admission truth.
- Do not add app-local persistence commands or modules; history, export, artifacts, and storage use admitted Kit shell capabilities.
- The current reference app is local-development-only and must not carry public admission, listing, release, registry, or install truth.

## Retrieval Defaults
- Read the affected tester route, its direct SDK/Kit or shell dependency, and the matching tester contract test.

## Internationalization
- All user-visible copy in `src/tester/**` and product shell surfaces goes through `src/shell/i18n/index.js` (`useTranslation` in components, bare `t()` in pure modules); never import `react-i18next` directly.
- Locale bundles live in `src/shell/i18n/locales/{en,zh}/*.json`, one top-level section object per file (e.g. `studio.json` → `"Studio"`); new section files must be registered in `src/shell/i18n/index.ts` and mirrored in both locales (`test/i18n-parity.test.mjs` enforces key parity).
- Static data modules store i18n keys (e.g. `labelKey`) and translate at render time; prompts/directives sent to Runtime and UI Recipes gallery copy stay English.
- `src/shell/i18n/index.ts` is reachable from the simulator adapter closure: no `document`/`window`, no module-scope `let`/`var`, no module-scope resource factories (`create*`, `new` except whitelisted `Intl.DateTimeFormat`). DOM language sync lives in `src/shell/i18n/document-lang.ts`, imported only by entry points.

## Verification Commands
- Run the focused test, then `pnpm --filter @nimiplatform/tester test` and `pnpm --filter @nimiplatform/tester run validate`.
