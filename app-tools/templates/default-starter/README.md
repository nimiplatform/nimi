# Acme Widget

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

`dev` enters the official Nimi local-development launcher and selects Tauri by default. Use `pnpm dev:shell -- --shell electron` or `pnpm dev:shell -- --shell tauri` to select a shell explicitly. On macOS, use `--shell electron`; the independent Tauri carrier remains fail-closed. Keep Nimi Desktop open and signed in. Desktop shows the canonical project, app identity, shell, current account, and requested capabilities. Choose only this run, remember the project, or deny.

Desktop owns the dev server and native host lifecycle. Renderer HMR and Desktop-controlled native rebuilds reuse the same project authorization. Changing the app id, canonical project root, shell, current account, or requested capabilities requires a new decision. Direct shell launches remain untrusted, and the app never receives Runtime credentials or protected session material. The generated app requests only the typed Runtime artifact-read surface; account, Realm, AI, lifecycle, realtime, and media operations remain fail-closed. Local-development authorization is not Nimi listing admission, install truth, a production release, signing evidence, or a permission grant. macOS intent submission remains negative until the signed Runtime/Desktop/host and live native admission gate passes.

`pack` writes `dist/nimi-app-submission.json` and `dist/nimi-app-artifact-evidence.json` after a successful renderer build. These files include sha256 and typed size evidence for `dist/index.html` and explicitly mark public admission, release descriptor, ordinary visibility, signing, notarization, mirror/license clearance, and permission grant truth as `not-generated`.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update an installed app, publish admission truth, create release descriptors, or grant permissions.

For Nimi listing review, keep `nimi.app.yaml`, `.nimi/admission/submission.yaml`, `.nimi/admission/build-profile.yaml`, and `ADMISSION.md` in sync with the product behavior under `src/shell/routes/product-area.tsx`.

Upstream Platform/Runtime review produces release descriptors, ordinary visibility, install truth, and scope authorization. This scaffold does not mint those outcomes.
