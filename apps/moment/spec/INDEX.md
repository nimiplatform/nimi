# Moment Spec Index

Read in this order:

1. `moment.md`
2. `kernel/boundary-contract.md`
3. `kernel/app-shell-contract.md`
4. `kernel/moment-generation-contract.md`
5. `kernel/moment-play-contract.md`
6. `kernel/library-contract.md`
7. `kernel/tables/routes.yaml`
8. `kernel/tables/surface-map.yaml`
9. `kernel/tables/feature-matrix.yaml`
10. `kernel/tables/moment-model.yaml`
11. `kernel/tables/relation-state-machine.yaml`

Primary cross-repo context:

- `spec/platform/kernel/architecture-contract.md` defines app/runtime/realm/mod boundaries
- `spec/platform/kernel/kit-contract.md` defines kit-first reuse and app-local composition rules
- `nimi-realm/spec/realm/kernel/truth-contract.md` defines Realm truth ownership
- `nimi-realm/spec/realm/kernel/world-state-contract.md` defines durable shared-state writes
- `nimi-realm/spec/realm/kernel/world-history-contract.md` defines canonical happened-fact storage
- `nimi-mods/runtime/scene-atlas/spec/scene-atlas.md` and `nimi-mods/runtime/agent-capture/spec/agent-capture.md` are neighboring seed-source products, not Moment internals
- `nimi-mods/runtime/textplay/spec/textplay.md` is a neighboring deeper-play product, not Moment's primary identity
