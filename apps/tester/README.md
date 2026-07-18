# Nimi Lab

Profile: `standalone`

This repository is a Nimi App authoring scaffold. `nimi.app.yaml`, the build profile, permission declarations, pack output, validate output, and local audit output are submitted inputs and pre-submission self-checks only.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run validate
pnpm run local-audit
pnpm run pack
pnpm run doctor
pnpm run update
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold admission/build-profile/lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev` uses the same official launcher as every generated local app and selects Electron for the proven local-development path. `pnpm dev:electron` is the explicit equivalent. `pnpm dev:tauri` retains the dual-shell intent and existing Kit Tauri carrier; Desktop's Tauri supervisor path is still partial and may fail closed before launch while its script-selection contract is aligned upstream. Nimi Desktop owns the confirmation, dev server, and native host. Renderer HMR and Desktop-controlled native rebuilds reuse an unchanged project authorization; app id, root, shell, account, or capability changes require a new decision.

The Tester local-development manifest admits app-owned JSON storage and the typed Runtime artifact-read proof. The Local app status control opens a focused permission lab for zero-grant, exact request, Desktop approval, protected write, and revoke-then-deny regression. Account, Realm, AI, lifecycle, realtime, and media calls remain visibly fail-closed. No Runtime credential or protected session material enters the app, renderer, or terminal. This non-production authorization is not listing admission, install truth, a production release, signing evidence, or a permission grant. Non-Windows development admission currently fails closed.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update a product release, publish admission truth, create release descriptors, or grant permissions.

For Nimi listing review, keep `nimi.app.yaml`, `.nimi/admission/submission.yaml`, `.nimi/admission/build-profile.yaml`, and `ADMISSION.md` in sync with the product behavior under `src/shell/routes/product-area.tsx`.

Upstream Platform/Runtime review produces release descriptors, ordinary visibility, install truth, and scope authorization. This scaffold does not mint those outcomes.
