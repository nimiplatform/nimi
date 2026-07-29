# Nimi Lab

Profile: `standalone`

This repository is a local-development Nimi App reference. `nimi.app.yaml` carries the app identity and permission declarations used by the supervised development path. Development commands do not constitute product acceptance.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run validate
pnpm run doctor
pnpm run update
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev` uses the same official launcher as every generated local app and selects Electron for the current local-development path. `pnpm dev:electron` is the explicit equivalent. `pnpm dev:tauri` retains the dual-shell intent and existing Kit Tauri carrier. Nimi Desktop owns the confirmation, dev server, and native host. Renderer HMR and Desktop-controlled native rebuilds reuse an unchanged project authorization; app id, root, shell, account, or capability changes require a new decision.

The Tester local-development manifest declares the account-scope `agents.interact` permission for all current and future Agents. Its Local app boundary lab requests that one permission, uses a current opaque Agent handle only as the target of a conversation journey, and verifies app-private JSON storage independently. Other reserved permissions and unadmitted Account, Realm, AI, lifecycle, realtime, media, and Nimi-owned artifact calls remain fail-closed. No Runtime credential or protected session material enters the app, renderer, or terminal. Paths not run in the current development environment remain `NOT-VERIFIED`.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update a product release, publish admission truth, create release descriptors, or grant permissions.

Public distribution, listing, release descriptors, ordinary visibility, install truth, and scope authorization are deferred platform contracts. This reference app neither generates nor validates their inputs or outcomes.
