# @nimiplatform/simulator

Private static-site product for the Nimi Ecosystem Simulator.

## Development

`pnpm dev:simulator` generates the selected module inputs and starts the
ordinary Vite development server. It does not launch or supervise a browser
and does not create a separate acceptance environment.

`pnpm build:simulator` performs the same module generation, runs the Simulator
typecheck, builds with Vite, and applies the artifact's CSP and security
checks. The build finalizer emits only ordinary logs and an exit code; it does
not write an acceptance report, receipt, ledger, or attestation.

```bash
pnpm dev:simulator
pnpm build:simulator
pnpm --filter @nimiplatform/simulator test
pnpm --filter @nimiplatform/simulator test:contract
pnpm --filter @nimiplatform/simulator test:integration
```

## Product boundaries

- `src/state-engine/**` owns deterministic Simulator state, commands, events,
  scheduling, reset, and replay.
- `src/lifecycle/**` owns instance lifecycle and browser-observable readiness.
- `src/effects/**` and `src/bootstrap/**` install effect guards before selected
  modules load and maintain the artifact CSP floor.
- `src/shell/**` owns Simulator routes, global-listener coordination,
  presentation, and module instances.
- `build/generate-modules.mjs` validates and materializes the configured source
  modules into `.generated/` for direct Vite consumption.
- `build/finalize-build.mjs` checks the built artifact's CSP, credential
  boundary, and guard-first entry ordering.

App rows come only from `config/simulator/selected-sources/*.yaml`. Shell source
must not contain manual App imports or App-specific registry rows. Generated
module inputs live under `.generated/`, are ignored, and are not product
authority.

The contract and integration suites are nearest-owner development tests. Their
success does not constitute final product acceptance or prove an end-to-end
cross-App journey; that judgment remains with the user in the current
development environment.
