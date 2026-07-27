# Nimi Lab

Profile: `standalone`

This repository is a Nimi App authoring scaffold. `nimi.app.yaml`, the build profile, and permission declarations are developer-owned release submission inputs. Development commands do not constitute product acceptance.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run validate
pnpm run doctor
pnpm run update
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold admission/build-profile/lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev` uses the same official launcher as every generated local app and selects Electron for the current local-development path. `pnpm dev:electron` is the explicit equivalent. `pnpm dev:tauri` retains the dual-shell intent and existing Kit Tauri carrier. Nimi Desktop owns the confirmation, dev server, and native host. Renderer HMR and Desktop-controlled native rebuilds reuse an unchanged project authorization; app id, root, shell, account, or capability changes require a new decision.

The Tester local-development manifest declares no Nimi permissions. Its Local app boundary lab shows app-private JSON storage while the reserved `agents.interact` permission remains typed unavailable and cannot be requested. Account, Realm, Agent, AI, lifecycle, realtime, media, and Nimi-owned artifact calls remain fail-closed. No Runtime credential or protected session material enters the app, renderer, or terminal. Paths not run in the current development environment remain `NOT-VERIFIED`.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update a product release, publish admission truth, create release descriptors, or grant permissions.

For Nimi listing review, keep `nimi.app.yaml`, `.nimi/admission/submission.yaml`, `.nimi/admission/build-profile.yaml`, and `ADMISSION.md` in sync with the product behavior under `src/shell/routes/product-area.tsx`.

Upstream Platform/Runtime review produces release descriptors, ordinary visibility, install truth, and scope authorization. This scaffold does not mint those outcomes.
