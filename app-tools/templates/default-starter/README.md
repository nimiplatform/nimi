# Acme Widget

Profile: `standalone`

This repository is a local-development Nimi App authoring scaffold. `nimi.app.yaml` carries the app identity and App Access domain declaration used by the supervised development path. Development commands do not constitute product acceptance.

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

`dev` enters the official Nimi local-development launcher and selects Electron. `pnpm dev:shell -- --shell electron` is the explicit equivalent. Windows and macOS accept only the Desktop-supervised Electron carrier; Tauri is not an admitted local-development path. Keep Nimi Desktop open with Developer Mode enabled. Desktop registers and launches the canonical project without creating access authority or requiring an account.

For explicit local UI inspection, `pnpm dev -- --cdp-port 9334` asks the
Desktop supervisor to expose this run's Electron DevTools protocol on
`127.0.0.1:9334`. CDP is disabled when the option is omitted.

Desktop owns the dev server and native host lifecycle. Renderer HMR and Desktop-controlled native rebuilds reuse the same registered App subject while source and declaration generations advance when their inputs change. Direct shell launches remain untrusted, and the app never receives Runtime credentials or protected session material. Protected operations stay typed unavailable until Runtime establishes a fresh account-bound App session. Local-development registration is not Nimi listing admission, install truth, a production release, signing evidence, or operation authority.

`doctor` and `update` are developer scaffold checks for this source repository. They do not update an installed app, publish admission truth, create release descriptors, or admit protected operations.

Public distribution, listing, release descriptors, ordinary visibility, install truth, and protected App Access ingress are deferred platform contracts. This scaffold neither generates nor validates their inputs or outcomes.
