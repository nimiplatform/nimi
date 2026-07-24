# Platform Simulator - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/platform/simulator.authority.yaml`。

---

<!-- source: .nimi/spec/platform/kernel/nimi-ecosystem-simulator-contract.md -->

# Nimi Ecosystem Simulator Contract

> Owner Domain: `P-SIM-*`

## Scope

This contract owns the browser-based Nimi Ecosystem Simulator as an independent
Nimi product, its source-integration protocol, deterministic presentation state,
final build, integrated qualification, and release evidence. It does not own App
product identity, App publication/admission, Runtime or Realm truth, Kit
primitives, SDK public request/result semantics, or App UI/UX.

The Simulator exists to demonstrate Nimi's App construction and cross-App
interaction model through current App-owned renderer source. It is not a landing
page mode and does not run the selected Apps' real product capabilities.

## P-SIM-001 — Independent Presentation Product

The Simulator is the private workspace application `@nimiplatform/simulator`
rooted at `apps/simulator`. It owns one browser Shell, one React root, one
deterministic State Engine, one generated selected-module registry, and one
independently deployable artifact.

The product renders persistent, accessible simulation disclosure outside every
App root. The disclosure remains visible in normal, loading, full-window, modal,
instance-failure, and session-failure states. Simulated data and outcomes must
never be presented as Runtime, Realm, account, permission, installation,
provider, model, or persistent-world truth.

## P-SIM-002 — Independent Build And Web Boundary

The Simulator has its own HTML, environment schema, build command, artifact
manifest, deployment route, CSP, and release evidence. `apps/web` may link to
the Simulator but must not bundle the Simulator Shell or any selected App graph.
The Simulator is not a `desktop | web` shell mode and does not add a third value
to Desktop's `VITE_NIMI_SHELL_MODE` contract.

One Simulator-owned final build compiles selected App source into the artifact.
Remote modules, App-prebuilt renderer bundles, runtime plugins, iframes, Workers,
and service-worker module loading are forbidden. The release artifact and its
browser-public environment are credential-free.

## P-SIM-003 — Simulator-Owned Source Selection

Tracked selected-source inputs live under `config/simulator/**` and conform to
`tables/simulator-source-policy.yaml`. A descriptor binds every source location
to a repository key, immutable object identity, source root, source digest,
authority index digest, and structured authority references. It carries an
independent App-production-entry inventory and a separate Nimi
host-invocation inventory.

The Simulator owns inclusion, materialization, resolved ordering, and registry
generation. An App Manifest cannot select its repository, revision, inclusion,
ordering key, chunk, deployment route, or release posture. App production
entries and cross-root host invocations must each resolve to the same canonical
factory and style closure under their own descriptor-bound source locations.

## P-SIM-004 — One Current App Module Contract

The App-owned technical input is `nimi.simulator.yaml` at the selected App root.
Its only schema is `nimi.simulator.module/v1`; operation and interaction
protocols are exactly `nimi.simulator.operation/v1` and
`nimi.simulator.interaction/v1`. The closed field, path, identifier, and
forbidden-authority rules are in `tables/simulator-module-contract.yaml`.

Duplicate YAML keys, anchors, aliases, merge keys, custom tags, non-string keys,
unknown fields, escaping paths, conditional paths, URLs, generated bundles, and
prebuilt assets fail closed. There is no version negotiation, legacy reader,
compatibility adapter, or multi-version registry. A protocol change hard-cuts
all selected modules in one authority and source update.

## P-SIM-005 — Technical Qualification Is Not App Admission

Simulator qualification proves only that selected source can participate in one
controlled Simulator build. It does not publish, install, sign, trust, grant,
review, or admit a Nimi App. `module_id` and `instance_id` are Simulator-local
technical identifiers and cannot become Platform App identity or Runtime
principal identity.

Selected sources are curated by the Simulator owner. There is no self-service
third-party publication pipeline, arbitrary remote loading, App Store, public
review workflow, or second App-admission system. External repository describes
source location only.

## P-SIM-006 — App-Owned Canonical Renderer Factory

Each selected App owns one synchronous, host-neutral renderer instance factory.
Every independently inventoried App production entry, every selected Nimi host
invocation, and the Simulator renderer entry must reach the same resolved
factory export and canonical style-input closure.

The factory, not the Simulator Adapter, constructs per-instance providers,
stores, query clients, localization, routes, subscriptions, caches, and named
surfaces. It exposes exactly one required `main` surface and may expose declared
additional surfaces. It does not call `createRoot`, inspect shell/host/provider
identity, construct a production transport, create browser history, install a
process-global host, or reuse module-scope mutable renderer resources.

Graph identity, mutation, two-instance, style-input, and host-discriminator
negative proofs are required. Matching source text, component names, screenshots,
or a copied renderer directory is not single-truth proof.

## P-SIM-007 — App-Owned Simulator Adapter

Each selected App owns its Adapter and conformance fixture under
`src/simulator/**`. One Adapter instance is created per renderer instance. Module
evaluation, Adapter-factory creation, and Adapter construction are side-effect
free; `prepare` is the first lifecycle point that may allocate Simulator host
resources.

The Adapter supplies exact host-neutral Kit, SDK, App projection/command/event,
route, clock, localization, scope, and surface-lifecycle bindings. It may not
render App UI, return React nodes, query or mutate App DOM, reconstruct stores,
replace routes, patch source, inject CSS, select an alternate factory, expose a
host discriminator, or call real Runtime/Realm/native/provider/storage/network
surfaces.

## P-SIM-008 — One Resolver And Exact Shared Graph

The final build uses one Simulator-owned resolver. Resolution identity is the
tuple `package root + exact version + lock identity + export subpath + phase +
ordered conditions + canonical target`, with runtime identity also required for
context-sensitive packages. Version strings or one package realpath alone are
insufficient.

The closed mandatory-singleton policy is
`tables/simulator-mandatory-singletons.yaml`. Selected source cannot contribute
another lockfile, package-manager override, alias, export condition, bundler
plugin, or resolver implementation. A missing, duplicate, or context-divergent
singleton fails before App source evaluation.

## P-SIM-009 — Generated Registry And Reproducible Materialization

The selected-module registry is generated from Simulator-owned descriptors plus
validated App Manifests. Shell source contains no hand-authored App import list
or App-specific registry row. Generated build staging is ignored, disposable,
and reproducible; it cannot become source truth.

Serialized paths are root-independent canonical build paths. Host absolute
paths, credentials, branch names, moving refs, dirty release sources, symlinks,
submodules, Git LFS pointers, unsupported file modes, path normalization
collisions, or source-provided install/build scripts fail release
materialization. Development preparation and functional test materialization
must remain independent from release cleanliness: they read only the selected
immutable object, may proceed while a workspace source is dirty, and mark the
result non-releasable without consuming workspace-only bytes. Release and
artifact qualification remain fail-closed on dirty selected workspace roots.
The source digest algorithm and execution profiles are fixed by
`tables/simulator-source-policy.yaml`.

## P-SIM-010 — Deterministic Presentation State Ownership

The Simulator State Engine owns only deterministic presentation state for the
active scenario. Its immutable snapshot is partitioned into scenario,
ecosystem, Shell/instance presentation, and private App-module state. An
App reducer writes only its own module partition; Simulator interactions write
only their declared Simulator-owned partitions.

The one current executable Scenario is the tracked
`config/simulator/scenario.yaml` artifact with schema
`nimi.simulator.scenario/v1`; its closed field sets, initial state, exact
selected-module data coverage, enabled capabilities, ordered launch intents,
readiness expectations, cross-validation, generated projection, and digest
binding are fixed by `tables/simulator-scenario-contract.yaml`. A non-empty
selection without exact Scenario coverage fails before registry generation.
App conformance fixtures are validation evidence and cannot become runtime
Scenario input.

State Engine data cannot be persisted or consumed as Runtime, Realm, App
registry, identity, permission, account, message-delivery, model, provider,
memory, or world truth. Persistence-shaped behavior is ordinary scenario state
and is erased by scenario reset.

A Scenario may seed an `authenticated` simulated account projection for a
canonical App renderer. This is presentation state, not a real or inferred
product account. The State Engine is its sole session-truth owner: the Scenario
owns one persona input and one closed initial status, while every renderer
instance receives an independent projected session, login attempt, route,
store, and lifecycle. A per-instance override may change only that instance;
Scenario reset clears all overrides and restores the Scenario default.

The canonical Scenario defaults both Desktop instances to `authenticated`.
Every identity-shaped identifier in that input uses the `sim-` prefix. Shared
ecosystem identity presentation must be deterministically derived from that one
persona through a declared interaction or State Engine derivation with explicit
idempotency; a second independently authored persona is forbidden. Simulated
login, logout, and browser OAuth completion remain declared State Engine
commands/events. They create no Runtime/Realm call, token, credential, Cookie,
browser-storage record, persistent session, or account authority.

## P-SIM-011 — Serial Queue And Atomic Publication

There is one FIFO operation queue per session for commands and declared read
queries. Acceptance allocates one global operation sequence. One drain turn is
synchronous to quiescence, contains no `await`, host yield, or microtask
checkpoint, and processes at most 10,000 operations. A further operation is a
terminal integrity failure; the engine does not yield and continue.

A command validates one declared owner/write set and either atomically commits
one immutable snapshot with one revision increment and ordered events, or
commits nothing with a typed result. A query reads only its declared projection,
commits no state/revision/random/event, and is ordered in the same FIFO. Commit,
subscriber, event, target, result-recording, and Promise-observation order is
fixed by `tables/simulator-state-engine-policy.yaml`.

## P-SIM-012 — Deterministic Time, Randomness, Async, Streams, And Replay

Logical time advances only through explicit integer `advanceBy` or `advanceTo`
operations. State-affecting external Promise work reserves release order before
awaiting; settlement timing writes only a typed completion buffer, and release
occurs strictly by reservation allocation sequence. Reducers are synchronous
and pure.

Randomness is `xoshiro256ss-v1` using the algorithm and canonical JSON state in
`tables/simulator-state-engine-policy.yaml`. Real time, timers, Promise
settlement order, `Math.random`, and cryptographic randomness cannot influence
committed state. Replay uses RFC 8785 canonical JSON and SHA-256 and must
reproduce the final digest byte-for-byte.

## P-SIM-013 — Lifecycle, Cleanup, And Scenario Reset

The closed instance states and transitions are defined in
`tables/simulator-state-engine-policy.yaml`. Lifecycle intents are serialized
except for the one admitted close-during-prepare interrupt. Disposal invalidates
the instance token before unmount, disposes the canonical renderer at most once,
then Adapter disposal at most once, then host cleanup once in reverse
registration order.

Cleanup is cancellation-safe and must settle within the fixed 5,000 ms
host-integrity watchdog. Cleanup rejection or timeout is a terminal session
integrity failure. There is no instance reset hook. Scenario reset is one
two-phase barrier: synchronous old-epoch linearization and admission closure,
asynchronous ordered cleanup outside the FIFO drain, then synchronous
reconstruction and ordered settlement. No accepted result remains pending.

## P-SIM-014 — Surface Readiness And Visible Checkpoints

App readiness is a typed candidate signal, not self-attested completion. A
visible checkpoint requires: the declared candidate, State Engine quiescence,
current instance/epoch validity, React commit, two animation frames, successful
Paint/Composite observation, and declared semantic markers within the assigned
renderer/overlay roots.

The immutable browser runner injects the closed `qualification_trace` port
defined by `tables/simulator-browser-effects.yaml`. The Shell begins capture
before the first readiness frame, records runner-owned clock-sync markers after
each frame callback, and must end or cancel capture before the readiness
terminal. Selected source and selected dependencies cannot call the injected
global transport directly. Absence, stale tokens, overlapping trace ownership,
or a trace without Paint/Composite evidence between the two markers fails
readiness.

Scenario readiness rows must exactly cover selected surfaces and exactly match
each App-owned readiness declaration. Projection and blocking predicates are
data from the closed predicate kinds in
`tables/simulator-scenario-contract.yaml`; executable predicate functions or
App-specific Shell branches are not Scenario authority. For a Scenario whose
Desktop default is authenticated, Desktop readiness must identify a stable,
accessible primary control in the canonical post-login main Shell and prove the
Shell is usable; a login logo, login form, loading screen, or Simulator-owned
Desktop-specific DOM cannot satisfy that contract.

Close, reset, stale epoch, failure, or new state invalidates the barrier. A
skeleton, loading fallback, off-root marker, hidden simulation disclosure, or
pending lifecycle/reset cannot become ready. Readiness order and evidence are
recorded in replay/release evidence.

## P-SIM-015 — Typed Cross-App Interaction

Cross-App behavior uses the `nimi.simulator.interaction/v1` namespace and a
Simulator-owned interaction catalog. Payload and target sets are schema-checked
before queue acceptance. Apps emit only declared interaction types; targets
resolve only through the generated registry and live instance set.

Cross-App state changes route through ordered State Engine commands/events.
Direct App-to-App imports, direct mutation of another App store, and
`RuntimeAppService.SendAppMessage` are forbidden. Missing targets and unsupported
behavior return explicit typed results and never silent no-op or success-shaped
mock output.

## P-SIM-016 — Kit And SDK Owner Boundaries

Kit owns the reusable provider-scoped renderer host seam, opaque DOM/global-name
scope, mandatory theme/overlay targets, overlay lease/coordinator types, and
host-neutral standard shell result mapping. The Simulator owns concrete lease
allocation and permitted effect execution. Missing provider/target fails closed;
there is no global fallback or shell-mode inference.

SDK owns the host-neutral typed facade used by canonical renderer bindings and
the deterministic in-process harness under the existing public
`@nimiplatform/sdk/testing` subpath. The harness derives requests, results,
streams, and errors from SDK public types. It creates no production transport,
endpoint, credential, principal, or Runtime/Realm truth. Canonical UI receives
only the facade and host-neutral `NimiError`; it cannot observe Simulator IDs or
Simulator error codes.

## P-SIM-017 — DOM, CSS, Route, And Overlay Composition

The Simulator owns one React root and Shell route/deep-link serialization. Apps
do not install independent browser-history owners. Every module has one
canonical style entry, one generated root namespace, one exact scanner input,
and one lazy App CSS layer. Kit foundation/theme/utility CSS is emitted once.

App CSS cannot own `html`, `body`, `:root`, preflight/reset, unscoped global
selectors, unnamespaced variables/keyframes/fonts, remote imports, dynamic
utility interpolation, host-only safelists, or z-index outside its allocated
range. DOM/ARIA/SVG/form/radio/fragment identities use the instance scope. One
Shell coordinator owns document listeners, overlay ordering, focus/Escape,
inertness, Simulator-root scroll lock, and z-index leases.

## P-SIM-018 — Reviewed Source Containment Without Security Sandbox

Selected renderer source executes in one trusted shared JavaScript context after
source and dependency review. No iframe, Worker, or process sandbox is required,
and the Simulator does not claim hostile-code isolation.

The closed browser-effect and listener-family policies are
`tables/simulator-browser-effects.yaml` and
`tables/simulator-listener-families.yaml`. A minimal bootstrap verifies browser
descriptors and installs guards before importing Shell, Kit, SDK, selected
source, or any effect-capable dependency. Static qualification, typed ports,
runtime guards, source review, and deployment CSP jointly enforce the no-real-
effects boundary.

The CSP floor is `connect-src 'none'`, `worker-src 'none'`, `frame-src 'none'`,
`object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`; remaining
sources are restricted to the Simulator origin and emitted asset classes.
Simulated authentication does not weaken this boundary: auth and Runtime/Realm
requests plus authentication use of Cookie, `localStorage`, `sessionStorage`,
IndexedDB, Cache Storage, or any persistent browser session surface are
forbidden and must be observed as absent in controlled-browser qualification.
Development, CP5-Z, and CP6 use the same real controlled Vite + Chromium trace
mechanism rather than a receipt-only substitute.

## P-SIM-019 — Closed Errors And Failure Scope

Simulator errors are the closed enum in `tables/simulator-error-codes.yaml` and
are always non-retryable within one deterministic operation. Invalid input,
unsupported behavior, capability denial, exhaustion, stale epoch, disposed
instance, and invalid lifecycle commit no state. Attributable renderer/Adapter
faults fail one instance after ordered cleanup; a shared module-load fault fails
instances bound to that module graph.

Guard bypass, State Engine invariant failure, shared dependency corruption,
ambiguous global async failure, or unprovable cleanup terminates the session as
`SIMULATOR_INTEGRITY_FAILURE`. Error text contains no credentials, absolute
paths, raw source, or scenario-defined free-text status.

## P-SIM-020 — Two Independent Qualification Owners

`nimi-app doctor --conformance simulator --json` is the App-side source
conformance command under `P-SCAF-*`. It validates the Manifest, declared
factory/style/Adapter/fixture surface, forbidden imports/effects, and source-
bound report digests. It cannot decide Simulator inclusion or final graph
qualification.

The Simulator revalidates source and App-tool evidence, generates the registry,
and owns final resolver, build, graph, interaction, no-effect, CSS/DOM,
performance, and release evidence. A forged, stale, path-dependent, or
source-mismatched App report fails. Structural authority is guarded by
`pnpm check:simulator-authority`; product gates are admitted only when their
executable implementation exists.

## P-SIM-021 — External Repository Equivalence

Workspace and external-repository source use the same Manifest, materialized
tree model, resolver, registry, final build, and integrated gates. An external
source is selected only by a Nimi-owned repository catalog key plus full commit
object identity. Branches, tags, abbreviated IDs, tag peeling, submodules,
symlinks, LFS pointers, source scripts, and source-owned lock/override/plugin
configuration are rejected.

External location introduces no separate third-party mode, trust tier, runtime,
publication path, or relaxed gate. Credentials used by a fetch process remain
out-of-band and never enter source descriptors or evidence.

## P-SIM-022 — Structural Performance And Calibration

The structural performance invariants are
`tables/simulator-performance-policy.yaml`: public-site isolation, empty-Shell
isolation, singleton identity, lazy App graphs, lazy App CSS, projection-scoped
rendering, complete cleanup, zero runtime materialization, and stable chunk
attribution.

Numerical ceilings become release authority only after measurement on the final
artifact under an immutable runner/browser/server/config profile. Until that
calibration is admitted, numerical values are diagnostic and cannot block
component construction. Structural invariant failures remain blocking at the
first checkpoint where the relevant graph exists.

## P-SIM-023 — Hash-Rooted Release Evidence

Release evidence binds source objects/digests, authority refs, Manifests,
App-production and host-invocation inventories, resolver targets, catalog
versions/digests, graph/style identities, artifact chunks/assets/maps, guard
installation, denied effects, lifecycle/reset/replay records, visual and
accessibility evidence, calibrated performance, and the final gate verdict.
It also binds the canonical Scenario digest, generated Scenario projection,
ordered launch intents, and the readiness expectation rows used by the final
artifact.

Every referenced artifact has a SHA-256 digest and summaries are reproducible.
Evidence contains no absolute user path, credential, token, source secret, or
unbound artifact. Local preflight and App-tool reports remain evidence only and
cannot promote product truth.

## P-SIM-024 — Required App Set And Hard-Cut Updates

The first complete Simulator release requires Desktop, Zhiyu, and Tester. Each
must use one current canonical factory and App-owned Adapter. At least one
reference scenario opens all three, uses at least three concurrent instances,
and commits one deterministic cross-App command/event chain visible in at least
two App surfaces.

App UI/UX updates are consumed by selecting the current App source and rebuilding
the Simulator. Historical App versions, compatibility shims, retained old
Manifests, dual resolver paths, Simulator-owned UI copies, and patched App source
are forbidden.

## Authority Relations

`tables/simulator-authority-boundaries.yaml` records the exact owner split and
the amendment/cross-reference/no-change disposition for Platform, Web, Kit,
SDK, app-tools, Desktop, Zhiyu, Tester, Runtime, Realm, release, and test
authority. That table cannot grant authority to an implementation path.

## Fact Sources

- `tables/simulator-authority-boundaries.yaml`
- `tables/simulator-module-contract.yaml`
- `tables/simulator-source-policy.yaml`
- `tables/simulator-scenario-contract.yaml`
- `tables/simulator-state-engine-policy.yaml`
- `tables/simulator-error-codes.yaml`
- `tables/simulator-mandatory-singletons.yaml`
- `tables/simulator-browser-effects.yaml`
- `tables/simulator-listener-families.yaml`
- `tables/simulator-performance-policy.yaml`


---

