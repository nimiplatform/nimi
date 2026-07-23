# @nimiplatform/simulator

Private, independent static-site product for the Nimi Ecosystem Simulator.

## I1 — Build control (CP1: green-with-followups)

Strict selected-source inputs, immutable Git materialization, App-tools report
revalidation, one exact mandatory-singleton resolver, a generated registry, an
explicit browser-public environment allowlist, and a reproducible
credential-free artifact.

## I2 — Deterministic core and Shell (CP2)

- `src/state-engine/**` — one FIFO operation queue with synchronous drain to
  quiescence (10,000-operation drain limit), atomic transactions, fixed
  notification order, logical clock with typed scheduled jobs, ordered async
  reservations, `xoshiro256ss-v1` randomness with canonical JSON state,
  typed streams, two-phase scenario reset, and RFC 8785 + SHA-256 replay.
- `src/lifecycle/**` — closed instance state machine with the one admitted
  close-during-prepare interrupt, exact disposal order (unmount, canonical
  renderer, Adapter, reverse host cleanup), the fixed 5,000 ms host-integrity
  watchdog, and the per-surface readiness barrier.
- `src/effects/**` + `src/bootstrap/**` — the generated browser-effect catalog
  (from `simulator-browser-effects.yaml` / `simulator-listener-families.yaml`),
  interceptable-surface guards installed before any Shell or effect-capable
  module evaluates, and the restrictive CSP generator asserted against the
  emitted artifact inventory. Runtime owner/phase scope is synchronous
  supplemental evidence only; authority-derived static qualification owns
  module evaluation, Promise continuations, and React callbacks.
- `src/shell/**` — the Shell session composition, Shell-owned routes and deep
  links, the single global-listener coordinator, overlay/z-index allocation,
  instance/module/session diagnostics, and the persistent simulated-status
  surface. No App imports exist in the empty Shell graph.

State Engine modules are pure TypeScript with explicit `.ts` import
specifiers so the identical production source runs under Node's type
stripping in the contract suite. The JSX shell view (`src/shell/ui.tsx` and
`src/shell/chrome/**`) runs its contract file under `tsx --test` instead;
`test:contract:prepared` chains both runners (`node --test` + `tsx --test`).

## Shell chrome and product presentation (CP6)

- `src/shell/chrome/**` — the Aurora-field shell chrome ported from
  `apps/prototype2`: the WebGL/CSS living-sky Field, the Cradle pane
  constellation (identity, modules, instances, grants, worlds, and the agent
  HUD), draggable/flickable surface windows over the imperative
  `.simulator-surface` sections, AppRail, the Spine dock, the Lens (⌘K),
  the Tide 3D overview, the Apps page, field menu, sky panel, and toasts.
  Window geometry and atmosphere state live in a shell-local React context
  (`ui-context.tsx`); every document/window listener rides the admitted
  global-listener coordinator families.
- `src/shell/chrome/product-presentation.tsx` — the product presentation
  layer, backed by the State Engine `shell.product` partition (grants,
  interaction ledger, consent, base-agent presence, persona) through the
  declared `simulator.product.*` commands. Everything it renders is seeded,
  simulated, and labeled as such (P-SIM-001); none of it is permission or
  account truth.
- Cross-app presentation flows are engine flow definitions
  (`state-engine/product-flows.ts`) ticked by the Shell runner: persona
  share (Desktop simulated login projects the persona onto Zhiyu and Tester
  surfaces), intent handoff, and agent context carry — emitted as typed
  `nimi.simulator.interaction/v1` envelopes from a live desktop origin
  instance.
- Desktop admits the simulator auth port via `sdk_methods` in
  `apps/desktop/nimi.simulator.yaml`: the simulated RuntimeAccount broker flow
  (`desktop.auth.*` commands/events) drives the simulated login that
  triggers persona share.

## I3/I4 — Verified component evidence

- Kit exposes the host-neutral canonical renderer contract and SDK exposes the
  testing host seam used by App-owned Simulator Adapters.
- App-tools validates Tester's canonical factory, Adapter, fixture, dependency,
  effect/resource, and style closure from exact source bytes.
- The Simulator resolver materializes an immutable temporary Tester commit,
  generates its registry graph, builds it with the final dependency resolver,
  and proves production/Simulator canonical CSS byte identity.
- The contract suite directly wires the real Tester source factory and Adapter
  into the State Engine. It proves a visible text action, two-instance
  isolation, lifecycle/reset, and cleanup under JSDOM.

The product-acceptance qualifier closes these segments over the built artifact
in pinned Chromium. It proves the selected Desktop, Tester, and Zhiyu
canonical renderers, two instances of each module, visible deterministic
interactions, isolation, reset, cleanup, replay, and browser Paint/Composite
evidence.

## Current admission boundary

The tracked product configuration selects immutable Desktop, Tester, and
Zhiyu source objects and binds them to one source-bound Scenario. That exact
three-module graph is the current admission boundary. External-repository
source, release performance ceilings, deployment, and hostile-code isolation
are not implied by this evidence.

```bash
pnpm check:simulator-selected-sources
pnpm check:simulator-modules
pnpm --filter @nimiplatform/simulator test          # I1 build-control suite
pnpm test:simulator-contract                         # core + source-wired contracts (node --test + tsx --test)
pnpm test:simulator-integration                      # real-module integration (tsx --test)
pnpm build:simulator
pnpm check:simulator-reproducible-build
pnpm check:simulator-cp5-z
pnpm check:simulator-cp6
```

App rows are generated only from `config/simulator/selected-sources/*.yaml`.
Shell source must not contain manual App imports or App-specific registry rows.
Generated materialization, registry, and effect-catalog files live under
`.generated/`, are ignored, and contain no source authority.
