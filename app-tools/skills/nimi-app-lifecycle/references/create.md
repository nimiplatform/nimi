# New project

Use `nimi-app create --platform desktop|web` with an App ID, title and the admitted features the user's task needs. `--features all` means the selected carrier's admitted catalog, not all Nimi Lab code. Web generation currently admits `studio-create` and a base-only App; mobile generation is not yet available. `nimi-app --help` lists the actual options and capability names.

After creation: install dependencies, run `pnpm exec nimi-app init`, then sync/check. Init can be previewed with `--dry-run --json`. The lifecycle skill becomes project-local at init; create's package content can already be read for guidance.

Build App-owned routes and workflows on the generated carrier. Preserve the selected App identity and direct feature selection. Use existing package test/build commands and exercise the affected real App task through the official launcher. Placeholder artwork or an empty feature list does not make a release-ready product: complete the App's portable information before production packaging.

Maintain the App-owned root `NIMI_APP.md` as the user introduction under the lifecycle guide. Remove `metadata.readme`; check and pack use only the fixed file, and sync never supplies missing product prose. Keep engineering setup and verification records in repository/developer documentation.

Native development normally uses installed Nimi and official Realm. App commands use the active Home; source integration requires quitting the current Runtime before starting source Nimi. Web projects use official Runtime-client login and the direct carrier. Configure their initially empty exact HTTPS origin, callback and real registered client id in `local_development.web` before init/check/dev, and browser-trusted TLS paths in .env.local. Untrusted Apps must not reuse one browser origin. Explicit local Realm inputs belong in `local_development.web.local` and require `--realm local`; ordinary developers need no local Realm. `@nimiplatform/app-tools/web` supplies the bounded coordinator. Source admission and first Home confirmation remain owner actions, not generated permissions. Web build produces files, not hosting or Runtime acceptance.
