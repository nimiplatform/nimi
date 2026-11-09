# New project

Use `nimi-app create --platform desktop|web` with an App ID, title and the admitted features the user's task needs. `--features all` means the selected carrier's admitted catalog, not all Nimi Lab code. Web generation currently admits `studio-create` and a base-only App; mobile generation is not yet available. `nimi-app --help` lists the actual options and capability names.

After creation: install dependencies, run `pnpm exec nimi-app init`, then sync/check. Init can be previewed with `--dry-run --json`. The lifecycle skill becomes project-local at init; create's package content can already be read for guidance.

Build App-owned routes and workflows on the generated carrier. Preserve the selected App identity and direct feature selection. Use existing package test/build commands and exercise the affected real App task through the official launcher. Placeholder artwork or an empty feature list does not make a release-ready product: complete the App's portable information before production packaging.

Maintain the App-owned root `NIMI_APP.md` as the user introduction under the lifecycle guide. Remove `metadata.readme`; check and pack use only the fixed file, and sync never supplies missing product prose. Keep engineering setup and verification records in repository/developer documentation.

Web projects use the existing official Runtime-client login and direct carrier. Configure `local_development.web` in nimi.app.yaml and the trusted TLS file paths in .env.local; these Web connection inputs remain App-authored through sync. `@nimiplatform/app-tools/web` supplies Node-only Vite configuration for the bounded development coordinator. Source admission and first PC Home confirmation are separate owner actions, never generated permissions. `nimi-app build` produces website files; Web pack and release preflight are unavailable. Production hosting must supply the bounded coordination routes and real production source separately.
