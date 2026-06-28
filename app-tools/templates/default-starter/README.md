# Acme Widget

Profile: `standalone`

This repository is a Nimi App authoring scaffold. `nimi.app.yaml`, the build profile, permission declarations, pack output, validate output, and local audit output are submitted inputs and pre-submission self-checks only.

## Development

```bash
pnpm install
pnpm run init
pnpm dev:shell
pnpm run validate
pnpm run local-audit
pnpm run pack
pnpm run doctor
pnpm run update
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold admission/build-profile/lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev:shell` launches the Tauri shell (`tauri dev`). The app authenticates through the in-app Runtime account login, exactly like a shipped app — there is no standalone developer session. For a not-yet-admitted local app, enable Developer Mode in the desktop app; the Runtime developer-registration gate then admits the local app under your real logged-in account. This is local developer material only; it is not Nimi listing admission, install truth, or a permission grant.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update an installed app, publish admission truth, create release descriptors, or grant permissions.

For Nimi listing review, keep `nimi.app.yaml`, `.nimi/admission/submission.yaml`, `.nimi/admission/build-profile.yaml`, and `ADMISSION.md` in sync with the product behavior under `src/shell/routes/product-area.tsx`.

Upstream Platform/Runtime review produces release descriptors, ordinary visibility, install truth, and scope authorization. This scaffold does not mint those outcomes.
