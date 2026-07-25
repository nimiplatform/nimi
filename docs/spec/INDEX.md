# Nimi Spec Index

Nimi product authority lives ONLY in canonical authority containers under `.nimi/spec/**/*.authority.yaml`. Legacy domain trees are migrated-domain indexes plus explicitly frozen adjacency material; they carry no product semantics.

## Canonical Authority (the only normative source)

- `.nimi/spec/platform/` — admission, testing-discipline, core-protocol, app-ecosystem, ui-design-system, product-lifecycle, authority-admission, governance-release, simulator
- `.nimi/spec/runtime/` — security-core, rpc-foundations, service-operations, ai-provider, model-catalog, local-compute, delegation, agent-participation, memory-world, app-surface, protected-session, agent-service
- `.nimi/spec/desktop/` — command-execution, bridge-ipc, agent-projection, shell-runtime, shell-ui, ai-consumption, product-surfaces
- `.nimi/spec/sdks/` — client-core, feature-clients, realm-consumer
- `.nimi/spec/avatar/` — embodiment-surface
- `.nimi/spec/zhiyu/` — local-partner-surface
- `.nimi/spec/cognition/` — standalone-services, runtime-bridge
- `.nimi/spec/nimi2d/` — asset-package, generation-supply

Scope bindings: `.nimi/config/authority-scope-bindings.yaml`. Archived prose: `docs/authority/*-rationale.md`(非规范). Machine rows: `config/*.yaml` with non-authority headers.

## Migrated Domain Trees (non-normative)

Each `<domain>/kernel/index.md` is a migrated-domain index pointing at its canonical containers and documenting any frozen adjacency files (realm-frozen tables and the protected-local family; dispositions belong to the realm merge / dev-kernel packages). Nothing under a legacy domain tree may be treated as authority.

## External Authority Anchors

- `realm` is an external Realm authority projection anchor. Realm server/domain product rules are not redefined in this repository; Nimi consumes them through SDK and Runtime/Desktop consumer contracts. The `realm` legacy tree awaits the realm merge package.

## Non Product Surfaces

- `.nimi/contracts/**`, `.nimi/methodology/**`, and `.nimi/config/**` are host-local nimicoding projections created by CLI initialization or synchronization.
- Non-authoritative execution evidence and durable decision dossiers, when needed, belong to external-host-managed context, explicitly admitted local evidence surfaces, or Git history. No repository task-lifecycle directory is product authority.
- Generated views are rendered on demand by nimicoding commands and are not tracked as product authority.
