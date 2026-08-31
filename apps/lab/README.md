# Nimi Lab

Profile: `standalone`

Nimi Lab is the full-capability local-development and incubation App. `nimi.app.yaml` carries App identity and a raw `app_access` declaration used by the supervised development path. Development commands do not constitute product acceptance.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run check
pnpm run build
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev` uses the same official launcher as every generated local app and selects
Electron for the current local-development path. `pnpm dev:electron` is the
explicit equivalent. The Nimi desktop host owns project registration, the dev
server, and the native host. Renderer HMR and host-controlled native rebuilds reuse
an unchanged registration; source and declaration changes advance their own
independent generations.

The Lab manifest declares the raw App Access domains `realm.data`, `runtime.consume`, `agent.local`, and `agent.configure`. Unknown valid declaration items remain preserved but inert. Registration, source generation, declaration generation, identity-session posture, account posture, and protected App Access availability are independent facts. During IMP1 every protected operation returns typed `SDK_LOCAL_APP_ACCESS_UNAVAILABLE` before touching a shell carrier; the App does not prompt, request, or fabricate access. No Runtime credential, registration handle, Registered App Subject, or protected session material enters the renderer or terminal. Paths not run in the current development environment remain `NOT-VERIFIED`.

Lab uses its repository-owned `check` (`test` plus `validate`) and `build`
commands for the non-public workspace validation topology. It does not retain
the retired public `doctor` or `update` commands and does not substitute public
standalone `nimi-app sync/check` for workspace validation.

Public distribution, listing, release descriptors, ordinary visibility, install truth, and protected ingress are deferred platform contracts. Nimi Lab neither generates nor validates their inputs or outcomes.
