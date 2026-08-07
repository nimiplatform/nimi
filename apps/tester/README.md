# Nimi Lab

Profile: `standalone`

This repository is a local-development Nimi App reference. `nimi.app.yaml` carries App identity and a raw `app_access` declaration used by the supervised development path. Development commands do not constitute product acceptance.

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

`dev` uses the same official launcher as every generated local app and selects
Electron for the current local-development path. `pnpm dev:electron` is the
explicit equivalent. Nimi Desktop owns project registration, the dev server,
and the native host. Renderer HMR and Desktop-controlled native rebuilds reuse
an unchanged registration; source and declaration changes advance their own
independent generations.

The Tester manifest declares the raw App Access domains `realm.data`, `runtime.consume`, `agent.local`, and `agent.configure`. Unknown valid declaration items remain preserved but inert. Registration, source generation, declaration generation, identity-session posture, account posture, and protected App Access availability are independent facts. During IMP1 every protected operation returns typed `SDK_LOCAL_APP_ACCESS_UNAVAILABLE` before touching a shell carrier; the App does not prompt, request, or fabricate access. No Runtime credential, registration handle, Registered App Subject, or protected session material enters the renderer or terminal. Paths not run in the current development environment remain `NOT-VERIFIED`.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update a product release, publish admission truth, create release descriptors, or establish App Access.

Public distribution, listing, release descriptors, ordinary visibility, install truth, and protected ingress are deferred platform contracts. This reference App neither generates nor validates their inputs or outcomes.
