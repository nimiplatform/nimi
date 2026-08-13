# Web AGENTS.md

## Scope
- Applies to `apps/web/**`.
- Web is the independent first-party public site and account-interaction surface: landing, authentication and account-security pages, static Nimi Home and App introductions, legal, download, and navigation pages.

## Hard Boundaries
- Keep landing-specific code under `apps/web/src/landing/**`; do not split the landing surface back out into a separate app.
- Web must not import Desktop renderer or package surfaces, `@renderer/*`, `@runtime/*`, `@desktop-public/*`, `@tauri-apps/*`, Runtime-private code, local-file behavior, native IPC, or Desktop CORS bypasses.
- Use `@nimiplatform/kit` and public typed SDK/Realm surfaces. Web account UI submits credential interactions to Realm but owns neither account truth nor bearer custody.
- Keep landing, auth, legal, download, navigation, and Home/App informational composition under `apps/web`; do not restore Web Shell, hash-shell routing, Desktop adapters, or post/social product routes.
- Simulator remains an independently built and deployed product; Web may link to it but must not import its product source.

## Retrieval Defaults
- Start in the observed Web route, `apps/web/src/landing/**`, or the Web-owned account adapter and follow only public Kit/SDK contracts.
- Skip Desktop renderer, Runtime internals, Simulator source, generated SDK output, and unrelated product layers unless a direct public-contract failure points there.

## Verification Commands
- `pnpm --filter @nimiplatform/web typecheck`
- `pnpm --filter @nimiplatform/web test`
- `pnpm --filter @nimiplatform/web build`
