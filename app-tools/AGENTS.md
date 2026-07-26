# AGENTS.md

## Scope
- Applies to `app-tools/**`.
- `@nimiplatform/app-tools` is a public app-authoring scaffold CLI. It is not a Desktop product slice, installed-app registry owner, release admission owner, or permission grant owner.

## Hard Boundaries
- `apps/tester` is the single hand-authored proof/reference Nimi App. It demonstrates Runtime AI consume, SDK, Kit, and shell integration, but it is not the default generic scaffold output.
- Default scaffold profiles generate a generic app starter and must not inherit tester-only product code, proof UI, tester settings fixtures, tester storage, world-tour surfaces, or monorepo-only Kit source aliases.
- The explicit `tester-reference` profile may carry the full proof app when the caller intentionally asks for that profile and the active scaffolding contract admits it.
- `templates/default-starter/**` and `templates/default-starter.manifest.json` are committed, hand-authored generic starter sources for default scaffold profiles. They must stay free of tester product semantics.
- `templates/app-source/**` and `templates/app-source.manifest.json` are derived build artifacts (gitignored, like `dist/`) for packaged tester-reference scaffold sources. They are never committed and never hand-edited. In a monorepo checkout, generator-owned code may read `apps/tester` live only for the explicit `tester-reference` path.
- Generated app projects must consume platform surfaces through `@nimiplatform/sdk`, `@nimiplatform/kit`, and `nimi-shell-tauri` contracts. They must not create local registry/admission truth.
- Platform review owns listing admission, permission grants, release descriptors, installed-app visibility, and update truth.
- Keep scaffold-managed glue explicit and reviewable in generator-owned code. Do not hide shared Runtime/SDK/Kit/shell behavior inside app-owned tester product files.
- Do not add install-time side effects that mutate `.nimi/**`; activation belongs to explicit `nimi-app init`.
- Keep `apps/tester` free of legacy Mod/Extension or app-slice admission claims unless the active spec explicitly admits them.

## Retrieval Defaults
- For generic scaffolds, read the affected generator, `templates/default-starter/**`, its manifest, and focused tests.
- For `tester-reference`, read the profile branch and affected `apps/tester/**` source; do not inspect or edit derived `templates/app-source/**`.
- Read admission or platform authority only when the requested change alters those semantics.

## Verification Commands
- Run the focused Node test while iterating, then `pnpm --filter @nimiplatform/app-tools test`.
- Use `pnpm run sync:app-source -- --apply` only when explicitly materializing the derived tester-reference package for packaging inspection.
