# AGENTS.md

## Scope
- Applies to `apps/lab/**`; treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections; keep auth, Runtime, permission, manifest, and shell glue in scaffold-managed files.
- The app-owned area is `src/shell/routes/product-area.tsx`, `src/lab/**`, `src-tauri/src/world_tour.rs`, `src-electron/**`, and lab contract tests.

## Hard Boundaries
- Consume Runtime and Realm only through SDK and reusable UI through Kit; do not create app-local platform truth, private transport, provider/model constants, or admission truth.
- Do not add app-local persistence commands or modules; history, export, artifacts, and storage use admitted Kit shell capabilities.
- Nimi Lab is local-development-only and must not carry public admission, listing, release, registry, or install truth.

## Retrieval Defaults
- Read the affected lab route, its direct SDK/Kit or shell dependency, and the matching lab contract test.

## Internationalization
- All user-visible copy in `src/lab/**` and product shell surfaces goes through `src/shell/i18n/index.js` (`useTranslation` in components, bare `t()` in pure modules); never import `react-i18next` directly.
- Locale bundles live in `src/shell/i18n/locales/{en,zh}/*.json`, one top-level section object per file (e.g. `studio.json` → `"Studio"`); new section files must be registered in `src/shell/i18n/index.ts` and mirrored in both locales (`test/i18n-parity.test.mjs` enforces key parity).
- Static data modules store i18n keys (e.g. `labelKey`) and translate at render time; prompts/directives sent to Runtime and UI Recipes gallery copy stay English.

## Styling
- `src/styles.css` imports Tailwind with `source(none)` and adds `@source "./**/*.{ts,tsx}"` so app composition classes are generated; Kit component classes come from the `@source` rules inside Kit's own `styles.css`. Keep new app utilities inside that scan.
- App plain CSS is wrapped in `@scope (.nimi-workbench-host)`; Kit Popover/Dialog content portals to `<body>` and escapes that scope, so portal-targeted styles must live in their own `@scope (<panel-root-class>)` block (single root per block) — see the history filter popover and image preview modal blocks at the end of `src/ai-studio-core/ai-studio-core.css`.
- Kit `Button` wraps children in one inline content span with pointer events disabled; composite rows that lay out structured children dissolve that wrapper with `> span { display: contents; }` (and restore `pointer-events: auto` where nested Tooltips need hover).

## Verification Commands
- Run the focused test, then `pnpm --filter @nimiplatform/lab test` and `pnpm --filter @nimiplatform/lab run validate`.
