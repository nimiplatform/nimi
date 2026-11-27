<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.remote-clients.web-registration","rule.nimi.sdks.client-core.remote-runtime-carrier"],"sources":["app-tools/package.json","app-tools/bin/nimi-app.mjs","app-tools/lib/web-development.mjs","app-tools/lib/web-scaffold.mjs","sdks/typescript/package.json","kit/package.json","kit/auth/src/app/web.ts","sdks/typescript/runtime/remote.ts"]} -->

# Connect a Web App to Your PC Runtime

A Web App lets you use your primary PC Runtime from a browser on the same machine or another device.

Web scaffolding and tooling are available on the npm `pre` channel—App Tools `0.16.0-rc.10`, SDK `0.24.0-rc.10`, and Kit `0.24.0-rc.16` (separate from `latest`). See [Install](/start/install) to align package versions and host requirements. Published `pre` packages let you create and run Web projects locally, but package availability alone is not end-to-end production sign-off.

## 1. Prepare Your PC Runtime and Web Source

On an ordinary development machine, you can use your installed, compatible Nimi Home and primary PC Runtime against the official Realm—you do not need to run a local Realm.

Make sure your host is ready:

- Keep the primary PC Runtime running, signed in to Home, and bound through the official account flow.
- Enable remote access and configure the Local Loadout or Cloud Connector your App needs.

Your website also needs an admitted client in the Registry with its exact canonical App ID, client ID, HTTPS origin, and same-origin callback. Scaffolding a project locally does not admit it; a maintainer must approve the real source. Users confirm the source in Home on first use—routine reconnections or switching browsers won't prompt again, though a material source revision requires fresh confirmation.

Finally, the browser must trust your site's TLS certificate (do not disable TLS checks during development), and the browser and PC must be able to reach each other directly—there is no TURN/Relay fallback.

## 2. Create a New Web App—or Adopt an Existing Site

### Start from scratch

Scaffold a standalone Web project using App Tools from the `pre` channel:

```bash
pnpm dlx --package=@nimiplatform/app-tools@0.16.0-rc.10 nimi-app create \
  --dir my-web-app --profile standalone --platform web \
  --features studio-create --app-id com.example.studio --title "My Web App"
```

Right now, `--features all` on Web resolves to the admitted `studio-create` slice: text generation, streaming chat, and embeddings.

In `my-web-app`, run `pnpm install` to install the dependencies declared by the scaffold. Fill in the Web configuration before running `init`, `check`, or `dev`:

1. In `nimi.app.yaml`, populate `local_development.web` with your admitted `origin`, `redirect_uri`, `client_id`, `realm_environment_id`, `realm_url`, `official_web_url`, and your real App-owned `command`. These values must match the admitted source and the Realm your PC uses.
2. In `.env.local`, set `NIMI_WEB_TLS_KEY` to the path of your HTTPS private key and `NIMI_WEB_TLS_CERT` to the matching certificate. Your browser must trust that certificate.
3. Run `pnpm run init`.

### Adopt an existing website

Install the selected version of `@nimiplatform/app-tools` as a dev dependency in the website project before running the following commands from its root.

Prepare a real `nimi.app.yaml` (`platform: web`, including your admitted `local_development.web` values) and `.nimi/config/build-profile.yaml` using the `web-pnpm` profile with your actual test and build commands. If either file does not exist yet, pass a `nimi-adoption.json` containing only the missing `manifest` and/or `build_profile` objects as documented in the [existing-App adoption guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md); omit `--input` when both files already exist.

Preview managed changes first, then apply:

```bash
pnpm exec nimi-app init --adopt --input ./nimi-adoption.json --dry-run --json
pnpm exec nimi-app init --adopt --input ./nimi-adoption.json
```

Keep your site's existing product entry, test/build commands, and account system intact. See [App Tools](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md) for how `web-pnpm` owns builds. Native projects can also declare an extra App-owned Web dev entry without altering their native build profile.

### Add Web to an existing desktop App

Keep the existing `app_id`, Electron entry and native build profile. Select a Web-capable App Tools, SDK and Kit combination from [Install](/start/install). Add `local_development.web` beside the Electron configuration and point its `command` at your browser dev script. Wire the browser renderer to Kit’s Web session, give it its own Vite entry and add `build:web:release` to run that build in `web-release` mode. In the Vite config, pass `release: mode === 'web-release'` to `nimiWebViteConfig` from `@nimiplatform/app-tools/web`. Keep product logic shared where it serves both clients. Expose model configuration and recovery from the browser itself.

Run `pnpm exec nimi-app sync --dry-run --json`, inspect the changes, then run `pnpm exec nimi-app sync`, `pnpm exec nimi-app check` and `pnpm exec nimi-app dev --platform web`. Exercise both entries when shared behavior changes. To upgrade platform packages, follow the [existing-App upgrade guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/upgrade-platform.md).

## 3. Run Locally and Make a Real Call

Once your admitted Web config is in place and `init` has succeeded, run the checks, build, and dev server:

```bash
pnpm run check
pnpm run test
pnpm run app:build
pnpm dev
```

Open the HTTPS URL printed in your terminal:

1. Click the Nimi sign-in control and finish the official browser auth flow.
2. Confirm the source in PC Home if prompted, then connect to your primary Runtime. Keep in mind that signing in can succeed while the PC is unreachable—display those two states separately in your UI.
3. In AI Studio, pick and save the App's `AIConfig`, submit a text request, and check the returned text, stream, or owner error. App config only expresses intent; model preparation stays a PC host task. See [Runtime Client](/sdk/runtime-client) for typed operations.

## 4. Wire Auth, Scopes, and Disconnects

Kit's `auth/app/web` provides the session factory, while `auth/app` provides `NimiAppSessionProvider`, `NimiAccountControl`, and `NimiAppAccessGate`:

- Capture the connected scope's `client` and `signal` for every action. When the scope is lost, unmount the stale view so late responses cannot overwrite UI state.
- If your site links a Nimi session to its own account system, bind it strictly to the site's verified current user. If your App only uses Nimi sign-in, you do not need a parallel account system.
- Closing the tab or disconnecting stops active browser calls without stopping the PC Runtime. Interrupted streams never resume automatically, and uncertain `Submit` calls are never replayed. Persist a durable Job or submission ID so you can query its real state—use `lookupSubmission` where your workflow supports it.

## 5. Ship Your Web App

For Runtime calls, your Web server coordinates sign-in and connection setup. AI content, files, and results travel directly between the browser and the PC.

Building a Web App produces static assets. Running a build never publishes or deploys your site automatically, and Web does not use desktop `pack` or native package installation.

When you are ready to release, you have two paths:

- **Host on your own domain**: deploy with an admitted origin, trusted HTTPS, and bounded coordination routes.
- **Platform-hosted candidate**: declare `public_slug` to generate an immutable hosted candidate. The release goes through a protected `web-v*` workflow and Registry review, and can go live once the platform verifies the approved source and bundle.

### Release on nimi.xyz

1. Choose the product’s permanent public slug and set `public_slug` in `nimi.app.yaml`. With App Tools `0.16.0-rc.10`, a new project's first `init` installs `.github/workflows/nimi-web-release.yml`. In an initialized project, run `pnpm exec nimi-app sync` and review and commit the managed workflow.
2. Locally run `pnpm run build:release` (desktop + Web: `pnpm run build:web:release`) with `NIMI_WEB_VERSION=X.Y.Z` and `NIMI_WEB_ARCHIVE=nimi-web-X.Y.Z.zip`, using the actual release number. Check the root `index.html`, the source and version in `nimi-web-bundle.json`, and assets under `/_releases/X.Y.Z/`.
3. Enable immutable GitHub Releases in the App repository and protect `web-v*` against updates and deletion. Push `web-vX.Y.Z` for the tested commit. Submit the exact release and its hosted source together following the [Registry instructions](https://github.com/nimiplatform/nimi-app-registry#remote-application-sources). This review supplies the production source registration. A development origin used for live calls has its own registration.
4. After merge the platform verifies the release, makes its assets available and switches the active version. Open `https://nimi.ai/apps/<slug>` and launch `https://<slug>.nimi.xyz` there. The publisher needs no Cloudflare account or per-App DNS record.
5. Sign in and connect. In Home, open **Settings → Account Security → Remote access**, match the App and origin, and allow the source. Reconnect from the browser if the request timed out. For an App that saves results, perform one user task, disconnect, reconnect with the same account and primary PC, and read the result. A content update retains consent. Changes to the qualified source or its requested capabilities can require another confirmation.

Web and native releases can advance independently. Hosted Web delivery and public directory availability follow explicit Registry publication and suspension state applied in Cloudflare: an active published version keeps serving from the last successfully applied state until an explicit update, rollback, or suspension (there is no 24-hour automatic stop if a sync has not run or fails; sync failures are resolved by operator inspection and manual workflow rerun). Once explicit product suspension or Web-source disablement takes effect in published state, the edge Worker blocks new page and script requests before cache reads while retaining only required existing coordination context cleanup paths; hiding a product from the public directory stays separate from suspension. To roll Web back, a maintainer selects a retained, approved release compatible with current policy. For a storage change, verify that version can read data already written by the new version.

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/hosted-web.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/hosted-web.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`examples/remote-runtime-web/README.md`](https://github.com/nimiplatform/nimi/blob/main/examples/remote-runtime-web/README.md)
