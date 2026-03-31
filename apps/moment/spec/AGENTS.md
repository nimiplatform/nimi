# Moment Spec AGENTS

## Authoritative Structure

- `moment.md`: app-level product overview, positioning, non-goals, and cross-repo boundaries
- `INDEX.md`: reading order
- `kernel/*.md`: normative app contracts
- `kernel/tables/*.yaml`: authoritative fact sources for routes, surface hierarchy, feature scope, and object shape

## Rule ID Namespace

- `MM-SHELL-*` - app shell, empty state, surface hierarchy, and home-screen behavior
- `MM-GEN-*` - moment generation contract
- `MM-PLAY-*` - short interaction loop and continuation behavior
- `MM-LIB-*` - local shelf and saved-threshold behavior
- `MM-BND-*` - app/runtime/realm/mod boundary rules

## Fact Sources

- `kernel/tables/routes.yaml` - app routes and default landing surface
- `kernel/tables/surface-map.yaml` - home-screen surface order and prominence
- `kernel/tables/feature-matrix.yaml` - feature scope, phase, and dependency posture
- `kernel/tables/moment-model.yaml` - app-owned object model and required threshold fields
- `kernel/tables/relation-state-machine.yaml` - dynamic user-to-story relation states and allowed transitions

## Editing Rules

1. Tables in `kernel/tables/*.yaml` win over prose when enumerations, field lists, route lists, or surface ordering are involved.
2. Rule IDs are append-only. Never renumber or reuse a retired rule ID.
3. Cross-references must use rule IDs, not section headings.
4. `Moment` is a standalone app spec, not a mod spec and not a desktop-tab spec.
5. `Moment` must not redefine Realm truth, world state, world history, asset, bundle, or chat semantics. Upstream Realm contracts stay authoritative.
6. `Moment` owns app-local story-opening threshold/session/library objects only. Do not quietly promote those objects into canonical Realm objects inside this spec tree.
7. The front-door principle is mandatory: the generated story-opening moment is the home-screen protagonist. Do not let sample walls, shelf surfaces, timeline panels, or explanatory copy take over the primary stage.
8. Future integrations with `scene-atlas`, `agent-capture`, `textplay`, `local-chat`, or `world-studio` must remain explicit downstream or upstream hooks. They must not collapse `Moment` into a wrapper around another product.
9. User relation to the unfolding story is dynamic state, not a fixed mode chosen up front. Do not rewrite Moment as a binary "observer vs involved" selector product.

## Relation to Existing Specs

`Moment` sits in the app layer and inherits boundaries rather than redefining them:

- Platform architecture and app/runtime/realm split: `spec/platform/kernel/architecture-contract.md` (`P-ARCH-*`)
- Kit-first UI reuse and app-local composition rules: `spec/platform/kernel/kit-contract.md` (`P-KIT-*`)
- SDK instance and transport boundaries: `spec/sdk/kernel/boundary-contract.md`, `spec/sdk/kernel/realm-contract.md`
- Realm truth/state/history boundaries: `nimi-realm/spec/realm/kernel/truth-contract.md`, `nimi-realm/spec/realm/kernel/world-state-contract.md`, `nimi-realm/spec/realm/kernel/world-history-contract.md`
- Mods as upstream/downstream neighboring products only: `nimi-mods/**`
