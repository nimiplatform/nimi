<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.remote-clients.web-registration","rule.nimi.sdks.client-core.remote-runtime-carrier"],"sources":["app-tools/package.json","app-tools/bin/nimi-app.mjs","app-tools/lib/web-development.mjs","app-tools/lib/web-scaffold.mjs","sdks/typescript/package.json","kit/package.json","kit/auth/src/app/web.ts","sdks/typescript/runtime/remote.ts"]} -->

# Connect a Web App to Your PC Runtime

Use a browser on this PC or another device to consume your primary Runtime. The current Web entry requires the [source package combination](/start/install); the published App Tools `0.14.0` artifact does not contain `--platform web`.

## Prepare the Host and Source

Keep the primary PC Runtime running and sign in to Home. Bind the primary Runtime through the official account flow, enable remote access, and prepare the Local Loadout or Cloud Connector needed for your task.

Your website needs an admitted Registry client with the exact canonical App ID, client ID, HTTPS origin and same-origin callback. Have the maintainer admit the real source; creating a project does not approve it. The user confirms that source in Home on first use. Ordinary reconnection or changing browser does not add another device approval; a material source revision requires fresh confirmation.

The browser must trust the website's TLS certificate, and the client and PC must be able to connect directly. There is no TURN/Relay fallback. Do not disable TLS checks to make a development source appear usable.

## Create or Adopt the Website

From a directory containing your selected complete source archives:

```bash
pnpm dlx --package="file:$PWD/nimi-packages/nimiplatform-app-tools-0.15.0.tgz" nimi-app create \
  --dir my-web-app --profile standalone --platform web \
  --features studio-create --app-id com.example.web --title "My Web App"
```

Select the matching SDK, Kit and App Tools archives through the [standalone overrides](/start/install#source-package-archives), then run `pnpm install` and `pnpm run init` in the generated project. Current Web `--features all` resolves only to the admitted `studio-create` slice: text generation, streaming chat and embeddings.

In `nimi.app.yaml`, configure `local_development.web`: `origin`, `redirect_uri`, `client_id`, `realm_environment_id`, `realm_url`, `official_web_url` and the real App-owned `command`. These values must identify the admitted source and the same Realm environment as the PC. Set `NIMI_WEB_TLS_KEY` and `NIMI_WEB_TLS_CERT` in the App's `.env.local` to paths of the trusted certificate files.

Prepare the existing website's real `nimi.app.yaml` and `.nimi/config/build-profile.yaml` using `platform: web` and a `web-pnpm` build profile with actual test and build commands. If either file is absent, provide a `nimi-adoption.json` containing only the `manifest` and/or `build_profile` objects as described in the [existing-App adoption guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md). Omit `--input` when both files already exist.

For an existing website, use the selected source tool's `init --adopt --input ./nimi-adoption.json --dry-run --json` to review managed changes, then apply the same adoption without `--dry-run`. Preserve the website's actual product entry, test/build commands and account system. See [App Tools](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md) for the `web-pnpm` build owner. A native project may instead declare an additional App-owned Web development entry; that does not convert its native build profile.

## Sign In and Make a Real Call

```bash
pnpm run check
pnpm run test
pnpm run app:build
pnpm dev
```

After the development server starts, open its configured HTTPS address from the terminal in your browser. Use its Nimi sign-in control, complete the official browser flow, confirm the source in PC Home if needed, and connect to the primary Runtime. Sign-in can succeed while the PC is unavailable; report those states separately.

In AI Studio, select and save the App's AIConfig, then submit a text request. Verify the actual returned text or stream and any owner error. App configuration selects intent; host model preparation remains a PC management task. [Runtime Client](/sdk/runtime-client) describes the typed operations.

Kit `auth/app/web` supplies the session factory, and `auth/app` supplies the Provider, AccountControl and AccessGate. Capture the connected scope's client and signal for each business action; scope loss unmounts the old view and prevents late writes. An optional website account association must follow the website's verified current user; Nimi-only login needs no parallel account system.

## Disconnect, Jobs and Delivery

Closing the page or disconnecting ends active calls from the browser without stopping the PC Runtime. Interrupted streams do not resume, and uncertain `Submit` calls are not replayed automatically. Save a durable Job or submission identifier so you can query its actual state, using the supported `lookupSubmission` operation where the workflow provides it.

The development server coordinates identity and connection signaling only; AI content, files, and results travel directly between the browser and the PC. A production website requires its own admitted origin, trusted HTTPS, and bounded coordination routes. A browser build produces static output. This Web carrier does not provide `pack`, automatic publication, or native package installation.

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`examples/remote-runtime-web/README.md`](https://github.com/nimiplatform/nimi/blob/main/examples/remote-runtime-web/README.md)
