# Tester Simulator Integration Contract

> Owner Domain: `T-SIM-*`

## T-SIM-001 — One Canonical Renderer Factory

Tester owns one synchronous canonical renderer factory consuming
`nimi.renderer.host/v1`. Its production browser/Tauri/Electron entries, every
Nimi host invocation, and its Simulator renderer entry must resolve to the same
factory export and canonical style-input closure.

The factory constructs the current Tester UI/UX and named surfaces. It cannot
branch on host identity, self-mount a React root, construct a production
transport, or select a Simulator-only component/style path.

## T-SIM-002 — Per-Instance Renderer Resources

Every factory call creates an independent provider, store, query client,
localization, route, cache, subscription, and surface graph. Production hosts
may bind one instance; Simulator may bind multiple concurrent instances.
Mutable renderer resources cannot live at module scope or cross instance/reset
boundaries. Disposal releases every resource exactly once.

## T-SIM-003 — App-Owned Simulator Adapter

Tester owns one Adapter instance per renderer instance under
`apps/tester/src/simulator/**`. It implements the exact
`nimi.simulator.module/v1` Adapter lifecycle and supplies declared App
projections, commands, events, route, clock, localization, Kit, SDK, and
surface-lifecycle bindings.

The Adapter cannot render UI, query/mutate Tester DOM, reconstruct stores,
replace routes, inject CSS, choose an alternate factory, expose host identity,
or call real Runtime, Realm, native, network, persistent storage, provider,
model, account, permission, or App-message surfaces.

## T-SIM-004 — Current Manifest And Fixture

The only Tester Simulator Manifest is `apps/tester/nimi.simulator.yaml`, using
the exact current Platform protocols. Its conformance fixture is App-owned and
deterministic. It contains explicit scenario inputs and expected typed
projection/result/readiness outcomes; it cannot contain credentials, endpoints,
absolute paths, production snapshots, prebuilt bundles, or success-shaped
placeholders.

Protocol changes hard-cut the Manifest, Adapter, fixture, and App source in one
current update. Tester keeps no compatibility reader or historical module
version.

## T-SIM-005 — Reference Consumer Without Privilege

Tester is the reference second consumer for app-tools and Simulator
conformance. It uses the same `nimi-app doctor --conformance simulator --json`
command, selected-source descriptor, final resolver, generated registry, and
integrated gates as Desktop, Zhiyu, and externally materialized Apps.

Tester cannot use a hard-coded registry row, private resolver, relaxed effect
policy, fixture-only App entry, special singleton copy, or selection/admission
bypass. Passing Tester proves the generic contract against one real App; it
does not certify other Apps or the final ecosystem scenario.

## T-SIM-006 — DOM, CSS, Effects, And Routing

Tester renders only inside assigned renderer/overlay roots, uses instance-
scoped identities, consumes Kit's shared host seam, and provides one canonical
style entry. It cannot own global reset/preflight, unscoped global selectors,
browser history, document listeners, overlay ordering, z-index allocation, or
browser-global effects outside the Platform catalogs.

Element-scoped React interaction remains Tester UI behavior. Every global or
state-affecting operation passes through an admitted host port and cleanup
contract.

## T-SIM-007 — Failure Semantics

Unsupported fixture behavior returns an explicit typed host-neutral result.
Tester never converts missing behavior, missing binding, denied effects, stale
epochs, disposed instances, or SDK failure into a silent no-op, empty data, or
success-shaped response.

`SIMULATOR_*` failures remain Simulator Shell control-plane errors. They cannot
enter Tester copy, stores, persistence, public SDK `NimiError`, or production
host behavior.

## T-SIM-008 — Selection Evidence

Tester is selectable only when App-owned tests and app-tools conformance prove:

- canonical factory equality across production, Nimi-host, and Simulator
  inventories;
- graph/style identity and exact mandatory singleton resolution;
- two-instance mutable-state isolation and complete cleanup;
- Adapter lifecycle, deterministic fixture results, and visible readiness;
- absence of real Runtime/Realm/native/network/persistence execution and every
  forbidden effect/import;
- current Manifest/source/report digest agreement.

Simulator integrated qualification separately proves final graph, DOM/CSS,
cross-App behavior, replay, reset, accessibility, visual, performance, and
release evidence. Structural authority checks and App-source conformance cannot
substitute for that integrated evidence.
