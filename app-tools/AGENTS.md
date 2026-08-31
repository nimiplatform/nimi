# AGENTS.md

## Scope
- Applies to `app-tools/**`.
- `@nimiplatform/app-tools` is the public full-stack developer toolkit for third-party Nimi Apps. Its closed CLI surface is `create`, `init`, `sync`, `check`, `dev`, `test`, `build`, `pack`, and `publish`; `doctor` and `update` are retired without aliases.
- App Tools prepares repositories, deterministic packages, GitHub release workflows and registry submissions. It does not own GitHub identity or repository truth, registry review/main, Runtime installed state, Desktop process truth, or Runtime access.

## Hard Boundaries
- `apps/lab` is the hand-authored full-capability development and incubation Nimi App. Its presence does not make the whole App, or every Lab surface, scaffoldable.
- Public scaffolding is standalone-only for third-party repositories and uses public registry dependencies. Nimi-workspace validation is a non-public test topology, never a profile, CLI flag, alias, or generated intent variant.
- Every generated App is the generic base plus the dependency closure of explicitly selected `--features`. `all` means every feature admitted by the app-tools capability catalog, not all source under `apps/lab`.
- A Lab capability slice may enter generated output only through an explicit catalog entry. Keep its App Access items, package dependencies, source root, target root, and dependency edges in that admission boundary.
- `templates/default-starter/**` and `templates/default-starter.manifest.json` are committed, hand-authored base sources. They must stay generic and free of Lab-only product code or feature implementations.
- `templates/app-source/**` and `templates/app-source.manifest.json` are derived build artifacts (gitignored, like `dist/`) containing only admitted capability slices for published packages. They are never committed or hand-edited. In a monorepo checkout, the generator reads those exact slices from `apps/lab` live.
- Generated app projects must consume platform surfaces through `@nimiplatform/sdk` and `@nimiplatform/kit`; supervised local development uses the Kit Electron app-host bridge. Independent Tauri shell glue, where present, is bounded OS integration and must not become a second local-development carrier or create local registry/admission truth.
- Platform registry review owns catalog admission and release descriptors; Runtime owns source-qualified installation/update state and access; Desktop owns exact Host process truth.
- Keep scaffold-managed glue explicit and reviewable in generator-owned code. Do not hide shared Runtime/SDK/Kit/shell behavior inside App-owned Lab product files.
- Do not add install-time side effects that mutate `.nimi/**`; activation belongs to explicit `nimi-app init`.
- Do not use Lab-local prose or implementation presence as App ecosystem authority or scaffold admission truth.

## Retrieval Defaults
- For base or profile changes, read the affected generator, `templates/default-starter/**`, its manifest, and focused tests.
- For a feature change, read its capability catalog entry, the exact admitted slice under `apps/lab/**`, and focused tests; do not inspect or edit derived `templates/app-source/**`.
- Read admission or platform authority only when the requested change alters those semantics.

## Verification Commands
- Run the focused Node test while iterating, then `pnpm --filter @nimiplatform/app-tools test`.
- Use `pnpm run sync:app-source -- --apply` only when explicitly materializing the derived admitted-slice snapshot for packaging inspection.
