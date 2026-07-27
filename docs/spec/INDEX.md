# Nimi Spec Index

Nimi product authority lives only in canonical authority containers
under `.nimi/spec/**/*.authority.yaml`. These indexes are navigation
aids and carry no product semantics.

## Canonical Authority (the only normative source)

- `.nimi/spec/platform/` — core-protocol, app-ecosystem, ui-design-system, product-lifecycle, governance-release, simulator
- `.nimi/spec/runtime/` — security-core, rpc-foundations, service-operations, ai-provider, model-catalog, local-compute, delegation, agent-participation, memory-world, app-surface, protected-session, agent-service
- `.nimi/spec/desktop/` — command-execution, bridge-ipc, agent-projection, shell-runtime, shell-ui, ai-consumption, product-surfaces
- `.nimi/spec/sdks/` — client-core, feature-clients, realm-consumer
- `.nimi/spec/avatar/` — embodiment-surface
- `.nimi/spec/zhiyu/` — local-partner-surface
- `.nimi/spec/cognition/` — optional runtime-bridge only; it does not own Runtime Memory or Knowledge
- `.nimi/spec/nimi2d/` — asset-package, generation-supply

Scope bindings: `.nimi/config/authority-scope-bindings.yaml`. Historical
rationale under `docs/authority/**` is non-normative. Machine rows under
`config/**` are projections and must declare their non-authoritative status.

## External Authority Anchors

- `realm` is an external Realm authority projection anchor. Realm server/domain product rules are not redefined in this repository; Nimi consumes them through SDK and Runtime/Desktop consumer contracts. The `realm` legacy tree awaits the realm merge package.

## Non Product Surfaces

- `.nimi/contracts/**`, `.nimi/methodology/**`, and `.nimi/config/**` are host-local nimicoding projections created by CLI initialization or synchronization.
- Non-authoritative execution evidence belongs to external-host-managed
  context or Git history. No repository task-lifecycle directory is
  product authority.
- Generated views are rendered on demand by nimicoding commands and are not tracked as product authority.
