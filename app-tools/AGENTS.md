# AGENTS.md

## Scope

This file applies to `app-tools/**`.

## Authority Boundary

- `@nimiplatform/app-tools` is a public app-authoring scaffold CLI. It is not a Desktop product slice, installed-app registry owner, release admission owner, or permission grant owner.
- `apps/tester` is the single hand-authored reference Nimi App and the only scaffold template source, kept verbatim in git. The scaffold generator forks it: every generated app starts as a `apps/tester` clone with its identity rewritten.
- `templates/app-source/**` and `templates/app-source.manifest.json` are a derived build artifact (gitignored, like `dist/`): a verbatim snapshot of `apps/tester` baked into the published tarball at pack time by `scripts/sync-app-source.mjs --apply` (wired into `prepack`/`prepublishOnly`). They are never committed and never hand-edited. In a monorepo checkout no snapshot exists, so the generator reads `apps/tester` live (`resolveAppSource()` prefers a baked snapshot, else the live tree) — exactly one copy in git, no build step for development.
- Generated app projects must consume platform surfaces through `@nimiplatform/sdk`, `@nimiplatform/kit`, and `nimi-shell-tauri` contracts. They must not create local registry/admission truth.
- Platform review owns listing admission, permission grants, release descriptors, installed-app visibility, and update truth.

## Editing Rules

- To change generated app content, edit `apps/tester` (the reference app). No re-sync step is needed in the monorepo — the generator reads it live. `pnpm run sync:app-source` (`--apply`) only materializes the baked snapshot for packaging/inspection. Do not edit `templates/app-source/**` directly.
- Keep scaffold-managed glue explicit and reviewable in `apps/tester`. The generator only rewrites identity literals and the two profile seams (Cargo shell dependency, `nimi.app.yaml` profile); everything else ships verbatim.
- Do not add install-time side effects that mutate `.nimi/**`; activation belongs to explicit `nimi-app init`.
- Keep `apps/tester` free of legacy Mod/Extension or app-slice admission claims unless the active spec explicitly admits them.
