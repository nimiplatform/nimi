# Nimi2D Wardrobe And Slot Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D wardrobe/slot authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Base body contract](base-body-contract.md)
> - [Renderability governance contract](renderability-governance-contract.md)
> - [Layer input contract](layer-input-contract.md)
> **Table**: [Slot taxonomy](tables/slot-taxonomy.yaml)

## 0. Purpose

This contract defines wardrobe, outfit, accessory, prop, and scene assets as
bindable appearance layers downstream of the base body topology.

The rule is simple: the base body owns the main rig; wardrobe hangs from it.

## 1. Wardrobe Role

### N2D-WARD-001 - Wardrobe Does Not Own The Main Rig

Wardrobe assets must not own or redefine:

- main skeleton
- required base anchors
- required base slots
- action topology
- posture truth
- runtime channel semantics
- Avatar backend routes

Wardrobe assets bind to slots exposed by the base body and inherit base-body
deformation.

### N2D-WARD-002 - Outfit Assets Are Generated Once

An outfit, accessory, prop, or scene asset is generated once for a compatible
base body topology and then reused.

Switching outfits at runtime must not trigger Nimi2D generation. Runtime may
select among already admitted assets only.

### N2D-WARD-003 - Wardrobe Switch Is Atomic

Wardrobe switching inherits `N2D-GOV-003`: the old outfit remains active until
the new outfit is validated, bound, and ready.

If validation or binding fails, the package falls back to the previous valid
outfit or `no_render`. It must not reveal the base body.

### N2D-WARD-004 - Default Outfit Is Mandatory

Every renderable character package must include a valid default outfit bound to
the base body.

The default outfit must be available before first renderable character success.
Missing default outfit is a package admission failure, not a lower-quality
success state.

## 2. Binding Model

### N2D-WARD-010 - Compatibility Binding

Every wardrobe asset must declare:

- `wardrobe_asset_id`
- `wardrobe_kind`
- `compatible_topology_id`
- `compatible_topology_version`
- `slot_bindings`
- `coverage`
- `source_evidence_ref`

`compatible_topology_id` and `compatible_topology_version` must match the base
body topology unless a future compatibility-range contract is admitted.

### N2D-WARD-011 - Slot Bindings Are Closed

Wardrobe assets may bind only to slot ids admitted by
`tables/slot-taxonomy.yaml` and exposed by the package base body.

Unknown slot ids, duplicate exclusive slot bindings, and missing required slots
fail closed.

### N2D-WARD-012 - Coverage Is Explicit

Outfit coverage must be explicit:

- `upper`
- `lower`
- `full`
- `hands`
- `feet`
- `head`
- `face`
- `hair`
- `prop`
- `scene`

Coverage affects renderability, draw-order validation, and conflict resolution.
Coverage does not grant permission to hide governance violations.

## 3. Wardrobe Kinds

### N2D-WARD-020 - Admitted Wardrobe Kinds

Current v1 admits these wardrobe asset kinds:

- `default_outfit`
- `outfit`
- `accessory`
- `hair_variant`
- `held_prop`
- `scene_layer`

`default_outfit` and `outfit` may satisfy no-outfit/no-render requirements when
bound and valid. `accessory`, `hair_variant`, `held_prop`, and `scene_layer`
cannot satisfy outfit requirement by themselves.

### N2D-WARD-021 - Scene Layers Are Not Body Rig Owners

Scene layers may be part of a Nimi2D package, but they do not own character
rig, base body topology, outfit requirement, or Avatar runtime scene execution.

## 4. Local Attachment Rig

### N2D-WARD-030 - Local Attachment Rig Is Subordinate

Wardrobe may include local attachment rig data for:

- cloth sway
- hair secondary motion
- accessory jiggle or follow-through
- prop follow behavior
- scene parallax attachment

Local attachment rig data must be subordinate to a base-body slot or anchor. It
must not become a second posture skeleton, action graph, or runtime composer.

### N2D-WARD-031 - Local Motion Is Asset Capability, Not Runtime Truth

Local attachment rig data may support later asset capability tiers, but it does
not define Avatar runtime frame scheduling, live action stream semantics,
physics engine selection, or PixiJS implementation.

## 5. Conflict And Layering Rules

### N2D-WARD-040 - Slot Exclusivity

Slots may be exclusive or stackable according to `tables/slot-taxonomy.yaml`.

Exclusive slots allow one active wardrobe binding at a time. Stackable slots may
allow multiple active bindings if draw order and coverage are explicit.

### N2D-WARD-041 - Draw Order Remains Explicit

Wardrobe draw order must be explicit in package manifest authority. No renderer
or product surface may infer wardrobe draw order from file names, timestamps,
or slot names.

### N2D-WARD-042 - Outfit Cannot Hide Invalid Base Body

Outfit binding cannot convert an invalid base body into a valid package. The
base body must validate first, and outfit binding validates after that.

## 6. Validation Floor

Wardrobe validation is valid only if:

- default outfit exists for character packages
- wardrobe assets reference the current base body topology
- wardrobe assets bind only admitted slots
- wardrobe assets do not redefine the main skeleton or action topology
- local attachment rig is subordinate to base-body slots
- outfit switching is atomic
- no wardrobe state exposes base body pixels without outfit
- runtime generation is not required for outfit switching
