# Existing project

Before changing code, identify the upstream URL and baseline commit, license, user journeys, actual AI/auth/storage entry points, business services, helper processes and active instruction loaders. Record a short upstream/range note in the existing App README or product document; do not create another integration state file.

Install a selected published app-tools package and read this package skill before init. Install its matching SDK/Kit and exact nimi-coding. Follow the package's manifest version matrix and use the lockfile to pin actual resolutions. Prepare the actual pnpm/Electron Host, renderer and test/production-build commands; do not make init manufacture a test success or convert a server deployment implicitly.

For a Next.js or other existing renderer, declare the framework-neutral `electron-pnpm` build profile and a real `dev:renderer` package script serving the manifest's loopback origin. Init/sync preserve that command and the App's build owners. The official `dev` launcher still asks Desktop to supervise the Host; `build:electron` must produce `dist-electron/main.js`. Keep any required local backend under App lifecycle management. A Desktop that still requires the old exact Vite command must be upgraded before this project's real launch; do not add an empty Vite server or lose server routes to pass checks.

If Host sources live outside the scaffold's `src-electron`, declare the actual project-relative directory in `nimi.app.yaml` as `local_development.electron.host_source_directory` (for example `electron`). The directory must exist inside the project. Desktop validates it before launch and watches it for Host rebuilds; init/sync retain it. Keep the upstream source layout instead of adding a placeholder directory.

Use `pnpm exec nimi-app init --adopt --dry-run --json`, then apply without `--dry-run` once the changes fit the authorized scope. Existing nimi.app.yaml and `.nimi/config/build-profile.yaml` are the inputs. If either is absent, supply `--input <json-path>` with only `manifest` and/or `build_profile`, using their existing schemas from the app-tools README. A file under `.nimi/local/` is sufficient. Input supplied alongside an existing file must agree with it. Target paths are declarations at init; build/pack later verify real artifacts.

Review the exact dependency, dev/renderer/pack script and workflow changes. Existing Host and business code, README and license remain App-owned; no fresh intent/lock is created. An unknown same-name skill/workflow or broken managed block requires a bounded cleanup, not forced takeover. Install normalized dependencies, sync/check, then run affected tests and the official App journey.

## Map only the capabilities the product uses

- Renderer code can use `createNimiClient` with Kit's `createNimiLocalAppStandardShellSurface`. Node business work uses `registerNimiElectronAppBridge(...).services` from the same protected Host, fixed app commands and session invalidation callbacks. Consult the installed SDK/Kit public types for exact inputs.
- Keep the App's tool loop, IDs, ordered tool results and any opaque continuity needed in subsequent turns. An SDK model step does not run business callbacks.
- Preserve Runtime-issued embedding space across batches; do not combine incompatible results. Carry cancellation and session invalidation into outstanding work and prevent late writes to a new session.
- Local media helpers receive bounded business inputs and an explicit environment; they do not receive Nimi credentials or a generic protected forwarding endpoint.
- Non-AI services, such as search engines, stay App-owned with honest setup requirements. Do not turn all external HTTP into an AI bypass finding.

For an existing App, a generic `/api/...` route or provider `/v1/...` URL alone
does not prove a Nimi Realm/Runtime bypass. The checker retains explicit
protected-custody/private-import checks; review actual product call paths to
establish Nimi AI routing. Do not edit vendor code just to remove a keyword.

Separate development instructions from product-operation guides, including other host entry files actually used by the repository. Upstream supplier examples may remain as knowledge; check the active product/agent route instead of deleting by keyword. Keep unimplemented original workflows explicit rather than counting a visible menu or retained source as completion.
