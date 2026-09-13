# Existing project

Before changing code, identify the upstream URL and baseline commit, license, user journeys, actual AI/auth/storage entry points, business services, helper processes and active instruction loaders. Record a short upstream/range note in the existing App README or product document; do not create another integration state file.

Install a selected published app-tools package and read this package skill before init. Install its matching SDK/Kit and exact nimi-coding. Prepare actual App-owned pnpm/Vite/Electron Host, renderer and test/production-build commands; do not make init manufacture a test success or convert a server deployment implicitly.

Use `pnpm exec nimi-app init --adopt --dry-run --json`, then apply without `--dry-run` once the changes fit the authorized scope. Existing nimi.app.yaml and `.nimi/config/build-profile.yaml` are the inputs. If either is absent, supply `--input <json-path>` with only `manifest` and/or `build_profile`, using their existing schemas from the app-tools README. A file under `.nimi/local/` is sufficient. Input supplied alongside an existing file must agree with it. Target paths are declarations at init; build/pack later verify real artifacts.

Review the exact dependency, dev/renderer/pack script and workflow changes. Existing Host and business code, README and license remain App-owned; no fresh intent/lock is created. An unknown same-name skill/workflow or broken managed block requires a bounded cleanup, not forced takeover. Install normalized dependencies, sync/check, then run affected tests and the official App journey.

## Map only the capabilities the product uses

- Renderer code can use `createNimiClient` with Kit's `createNimiLocalAppStandardShellSurface`. Node business work uses `registerNimiElectronAppBridge(...).services` from the same protected Host, fixed app commands and session invalidation callbacks. Consult the installed SDK/Kit public types for exact inputs.
- Keep the App's tool loop, IDs, ordered tool results and any opaque continuity needed in subsequent turns. An SDK model step does not run business callbacks.
- Preserve Runtime-issued embedding space across batches; do not combine incompatible results. Carry cancellation and session invalidation into outstanding work and prevent late writes to a new session.
- Local media helpers receive bounded business inputs and an explicit environment; they do not receive Nimi credentials or a generic protected forwarding endpoint.
- Non-AI services, such as search engines, stay App-owned with honest setup requirements. Do not turn all external HTTP into an AI bypass finding.

Separate development instructions from product-operation guides, including other host entry files actually used by the repository. Upstream supplier examples may remain as knowledge; check the active product/agent route instead of deleting by keyword. Keep unimplemented original workflows explicit rather than counting a visible menu or retained source as completion.
