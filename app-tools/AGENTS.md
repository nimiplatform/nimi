# AGENTS.md

## Scope

This file applies to `app-tools/**`.

## Authority Boundary

- `@nimiplatform/app-tools` is a public app-authoring scaffold CLI. It is not a Desktop product slice, installed-app registry owner, release admission owner, or permission grant owner.
- Templates under `templates/app-scaffold/**` are package-owned scaffold outputs for generated app projects. Do not treat them as active `apps/desktop` source.
- `templates/app-scaffold/product/nimi-tester/**` is an admitted production scaffold template for the third-party app tooling flow. Do not remove or rewrite it as Desktop tester residue.
- Generated app projects must consume platform surfaces through `@nimiplatform/sdk`, `@nimiplatform/kit`, and `nimi-shell-tauri` contracts. They must not create local registry/admission truth.
- Platform review owns listing admission, permission grants, release descriptors, installed-app visibility, and update truth.

## Editing Rules

- Keep scaffold-managed glue explicit and reviewable. Prefer bounded template edits over broad rewrites.
- Do not add install-time side effects that mutate `.nimi/**`; activation belongs to explicit `nimi-app init`.
- Keep generated examples free of legacy Mod/Extension, Desktop tester, or app-slice admission claims unless the active spec explicitly admits them.
