# Existing project

When starting from an earlier assessment, apply [Audit handoff](audit.md#handoff-to-implementation): reuse confirmed user decisions and sufficient evidence, and check the assumptions relevant to the next consequential change. An audit recommendation does not become a platform contract or a reason to preserve a disproved design.

Before changing code, identify the upstream URL and baseline commit, license, user journeys, actual AI/auth/storage entry points, business services, helper processes and active instruction loaders. Record a short upstream/range note in the existing App README or product document; do not create another integration state file.

For a complete App adaptation, account for the original product entry, business settings, input/output formats, recovery and editing handoffs. Restore the required original journeys on the Nimi integration. A capability demo or generated workbench is not a replacement for the existing product, and passing its sample task does not complete the App adaptation.

Match the core journeys' required inputs and outputs against the selected SDK/Kit public contracts before substantial conversion. A request option or scaffold feature name does not prove that a usable result is supported. Consult the SDK README's support boundaries and the selected resource's capabilities; distinguish missing configuration, unclear documentation, an existing-contract defect, and a required new platform capability. Use a small real protected call only where it can resolve the remaining question. If the task excludes new platform capabilities, a required missing capability makes the candidate unsuitable; report it without shrinking the product or continuing with a private inference bypass. Code-level absence of a required operation does not need a running Desktop to be reported, while an unavailable Desktop is only a launch prerequisite failure.

If the task includes Nimi expansion or repair and a required gap is found, follow [Platform gaps](platform-gaps.md), then return to the original App workflow with the delivered shared fix. Existing authorization covers that work; a missing capability is not automatically the end of adaptation.

Install a selected app-tools package and read this package skill before init. For local SDK/Kit/app-tools iteration, use the complete tarball override workflow in its README; do not wait for publication or link to the source workspace. Install its matching SDK/Kit and exact nimi-coding. Follow the package's manifest version matrix and use the lockfile to pin actual resolutions.

Before writing Nimi foundation wiring, use that same app-tools package to generate a minimal reference App with its own identity under `.nimi/local/`. Choose the smallest admitted feature closure that exposes the needed session, App Access, AIConfig and AI call surfaces; use `nimi-app --help` for the actual features and create options. Install the same SDK/Kit/native package combination in the reference, then run its generated setup and Desktop-supervised path. Start from its working Host, preload, renderer bridge and public client calls when integrating the existing App. Align or reuse that code; do not reconstruct these foundation pieces freely from API prose. SDK/Kit documentation defines the contracts and fills gaps in the generated implementation.

When installation and launch are in scope, establish the reference's local installed Access baseline using the acceptance guide before attributing an installed failure to App wiring. A reference failure under the same conditions points to the toolchain or environment; a passing reference makes its wiring differences with the App the next inspection target. Direct evidence of a platform defect remains actionable. Reuse current passing reference results; repeat this baseline for first integration or affected foundation changes, not ordinary business edits. Record only the necessary result in existing project notes, with no extra proof files or state ledger. Missing prerequisites pause the dependent wiring checks, not independent product restoration.

Prepare the existing App's actual pnpm/Electron Host, renderer and test/production-build commands from that integration. Preserve its framework and business code where they fit; do not make init manufacture a test success or convert a server deployment implicitly.

Prepare the actual Electron binary as well as its npm wrapper. The matched Electron 42 package exposes `install-electron` and has no package lifecycle script, so `pnpm rebuild electron` does not install its binary. Run `pnpm exec install-electron --no` from the App. The official fresh scaffold uses `postinstall: "install-electron --no"`; an adopted App owns its existing installation hooks, so add that step to the App's normal setup without discarding other postinstall work. Do not use the installer's `--help` as a read-only probe: this version does not parse that flag.

For a Next.js or other existing renderer, declare the framework-neutral `electron-pnpm` build profile and a real `dev:renderer` package script serving the manifest's loopback origin. Init/sync preserve that command and the App's build owners. The official `dev` launcher still asks Desktop to supervise the Host; `build:electron` must produce `dist-electron/main.js`. Keep any required local backend under App lifecycle management. A Desktop that still requires the old exact Vite command must be upgraded before this project's real launch; do not add an empty Vite server or lose server routes to pass checks.

For a helper process's text/JSON pipes, make UTF-8 explicit for the initial request, callback replies and output. A frozen Python worker should decode and encode the byte streams strictly; interpreter environment settings alone may not govern its text streams. Verify non-ASCII data in the actual packaged worker and at its business consumer, such as saved configuration: a matching wire round trip can hide reciprocal decoding and encoding errors.

If Host sources live outside the scaffold's `src-electron`, declare the actual project-relative directory in `nimi.app.yaml` as `local_development.electron.host_source_directory` (for example `electron`). The directory must exist inside the project. Desktop validates it before launch and watches it for Host rebuilds; init/sync retain it. Keep the upstream source layout instead of adding a placeholder directory.

Use `pnpm exec nimi-app init --adopt --dry-run --json`, then apply without `--dry-run` once the changes fit the authorized scope. Existing nimi.app.yaml and `.nimi/config/build-profile.yaml` are the inputs. If either is absent, supply `--input <json-path>` with only `manifest` and/or `build_profile`, using their existing schemas from the app-tools README. A file under `.nimi/local/` is sufficient. Input supplied alongside an existing file must agree with it. Target paths are declarations at init; build/pack later verify real artifacts.

Review the exact dependency, dev/renderer/pack script and workflow changes. Existing Host and business code, README and license remain App-owned; no fresh intent/lock is created. An unknown same-name skill/workflow or broken managed block requires a bounded cleanup, not forced takeover. Install normalized dependencies, sync/check, then run affected tests and the official App journey.

## Map only the capabilities the product uses

- Renderer code can use `createNimiClient` with Kit's `createNimiLocalAppStandardShellSurface`. Node business work uses `registerNimiElectronAppBridge(...).services` from the same protected Host, fixed app commands and session invalidation callbacks. Consult the installed SDK/Kit public types for exact inputs.
- Keep the App's tool loop, IDs, ordered tool results and any opaque continuity needed in subsequent turns. An SDK model step does not run business callbacks.
- For an existing Vercel AI SDK 6 App, use the matching independent `@nimiplatform/sdk-adapter-vercel-ai` package and its Host-bound Local App factory. Read its README for image upload and complete UI message metadata; keep `useChat`/`streamText` and App-owned tools instead of rebuilding their wire protocol inside the App.
- Preserve Runtime-issued embedding space across batches; do not combine incompatible results. Carry cancellation and session invalidation into outstanding work and prevent late writes to a new session.
- Local media helpers receive bounded business inputs and an explicit environment; they do not receive Nimi credentials or a generic protected forwarding endpoint.
- Non-AI services, such as search engines, stay App-owned with honest setup requirements. Do not turn all external HTTP into an AI bypass finding.

For an existing App, a generic `/api/...` route or provider `/v1/...` URL alone
does not prove a Nimi Realm/Runtime bypass. The checker retains explicit
protected-custody/private-import checks; review actual product call paths to
establish Nimi AI routing. Do not edit vendor code just to remove a keyword.
App-owned login and refresh route literals are not Realm identity evidence.
Python virtual environments identified by `pyvenv.cfg` are installed dependency
trees, not App source; their bundled web clients do not establish App custody.
Custom `.next-*` output trees with Next build/routes manifests and server/static
directories (including the `dev` layout) are also excluded. A similarly named
App source directory without those output markers remains checked.

Separate development instructions from product-operation guides, including other host entry files actually used by the repository. Upstream supplier examples may remain as knowledge; check the active product/agent route instead of deleting by keyword. Keep unimplemented original workflows explicit rather than counting a visible menu or retained source as completion.
