# App acceptance

Select the actual user journey and affected capability. Reuse the App's package scripts, existing tests and prior sufficient evidence; a small source or wording change does not require the whole release chain.

For development, run the official `nimi-app dev` launcher with Desktop supervising Electron. Attach only to the exact App's reported loopback CDP target. Renderer URLs or independently launched processes cannot prove protected access. Use the existing `--list-registrations` and explicit `--resume <selector>` when continuing the same development data; do not persist selectors or reopen by App ID/path. Native and installed UI use their owner-supported paths, not production CDP additions.

On Windows the project must have its Electron binary installed. If the launcher reports a missing `node_modules/electron/dist/electron.exe`, run the matched package's explicit `pnpm exec install-electron --no`, then retry the original launch. An installed npm wrapper or a successful `pnpm rebuild electron` alone does not prove that binary is present. Keep the explicit installer in the App's normal dependency setup; no empty renderer or alternate Host is needed.

Verify the real output the user needs: a cited research result, a correctly indexed document, or a playable/exported media artifact. Check cancellation, reconnect or account change when that behavior is affected. Tests and mocks can establish a contract; they cannot replace actual AI or App acceptance.

For local installed-App acceptance with complete local npm tarballs, run ordinary `check` and `build --target <target>`, then `pack --target <target> --production` on the matching host. The pack flag observes actual native signature and execution permissions; it neither requires registry dependency resolutions nor publishes. Plain `pack` produces a development archive that Runtime rejects for installation. Use Desktop's Apps → Add App → Import local package, review the actual preview, install and launch that source. Keep this separate from public-release `check --production` and `build --production`.

For a declared release target, verify Catalog discovery/download/install, exact Host launch, current Access, real business use and uninstall on an ordinary machine without the source workspace or development runtimes. Local-package import proves only that separate source path. Keep missing external services visible.

With two separately admitted versions, verify N to N+1 and the promised data retention. Reuse existing Runtime failure tests for preservation of the old package; if a normal real failure is observed, retry the same N/N+1 after confirming N remains available. Do not manufacture N+2, a downgrade path or a new fault-injection service.

Runtime uninstall removes its exact managed package after Desktop stops the Host. App-owned OS storage remains untouched, including disclosed paths; explain the App's own cleanup action separately. Ordinary repair and arbitrary rollback remain outside this workflow.

Report the tested App/version, target and result, plus relevant NOT-VERIFIED paths. Tool-core checks, a representative App slice, first release/install and a later update are separate completion levels. Keep necessary local output under `.nimi/local/`; do not create another task or proof ledger.
