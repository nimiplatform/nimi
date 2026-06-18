# Nimi2D Base Body Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 3 base body authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Authority boundary contract](authority-boundary-contract.md)
> - [Renderability governance contract](renderability-governance-contract.md)
> - [Layer input contract](layer-input-contract.md)
> **Table**: [Slot taxonomy](tables/slot-taxonomy.yaml)

## 0. Purpose

This contract defines the Nimi2D base body as the only owner of the reusable
character topology used by generated Nimi2D assets.

The base body is not a visible naked avatar. It is a non-renderable,
detail-neutral topology and morphology asset that lets outfits, accessories,
props, and scenes bind predictably.

## 1. Base Body Role

### N2D-BODY-001 - Base Body Owns The Main Rig

For a character Nimi2D package, the base body is the only owner of:

- main skeleton identity
- required anchors
- required slots
- morphology profile
- deformation topology
- action topology references
- default outfit binding requirement
- topology version

No outfit, accessory, prop, scene, renderer, product UI, or Avatar backend may
become a second owner of the main rig inside Nimi2D package authority.

### N2D-BODY-002 - Base Body Is Non-Renderable

The base body must not be displayed by itself. It inherits all no-outfit/no-render
rules from `renderability-governance-contract.md`.

The base body may exist as a package asset and validation input because it is
detail-neutral. It must not be used as visible success, preview, thumbnail,
debug pixel view, export, fallback, or Avatar handoff.

### N2D-BODY-003 - Base Body Is Detail-Neutral

The base body must follow `N2D-GOV-010` and `N2D-GOV-011`:

- morphology needed for outfit fit, slot geometry, and motion topology is
  allowed
- display sexual detail is forbidden
- morphology must not be removed just to make governance simpler
- display sexual detail must not be preserved just because morphology is needed

## 2. Topology Identity

### N2D-BODY-010 - Topology Version

Every base body must declare:

- `topology_id`
- `topology_version`
- `slot_taxonomy_ref`
- `skeleton_id`
- `morphology_profile_id`

Wave 3 admits the initial topology family:

- `topology_id: "nimi.nimi2d.base-body.topology"`
- `topology_version: 1`
- `slot_taxonomy_ref: ".nimi/spec/nimi2d/kernel/tables/slot-taxonomy.yaml"`

Changing required anchors, required slots, skeleton ownership, or wardrobe
compatibility semantics requires a topology version bump.

### N2D-BODY-011 - Topology Reuse

The base body topology is generated once for a character package and reused
across all compatible outfits and accessories.

Adding a new outfit must not regenerate or fork the base body skeleton, anchors,
slots, morphology profile, or action topology. It may reference them.

### N2D-BODY-012 - One Body, Many Looks

A Nimi2D character package has one current base body topology and many possible
wardrobe assets.

Outfit variation belongs to wardrobe. Body topology variation belongs to a new
base body topology and requires package re-admission.

## 3. Skeleton And Anchors

### N2D-BODY-020 - Required Skeleton Regions

The base body skeleton must cover these main regions:

- root
- torso
- neck
- head
- face
- jaw
- eyes
- shoulders
- arms
- hands
- hips
- legs
- feet

This is asset topology only. It does not define Avatar runtime bone APIs,
PixiJS APIs, animation frame timing, or live action blend logic.

### N2D-BODY-021 - Required Anchor Families

The base body must resolve at least the required anchor families from
`tables/slot-taxonomy.yaml`:

- `body_root`
- `neck_base`
- `head_center`
- `face_center`
- `left_eye_center`
- `right_eye_center`
- `mouth_center`
- `left_shoulder`
- `right_shoulder`
- `left_hand`
- `right_hand`
- `hip_center`

Layer input anchor hints are source evidence. Base body anchors are solved
package topology. The two must not be conflated.

### N2D-BODY-022 - Required Slots

The base body must expose the required slots recorded in
`tables/slot-taxonomy.yaml`.

Slots define where wardrobe and attachments bind. Slots do not define Avatar
runtime route ids, APML tags, PixiJS display objects, or renderer event names.

## 4. Morphology Profile

### N2D-BODY-030 - Morphology Is Explicit

The morphology profile must record geometry needed for fit:

- height ratio
- head/body proportion
- shoulder width
- torso width
- waist/hip relation
- chest volume and silhouette
- limb length ratios
- hand/foot scale

The morphology profile must not record display sexual detail.

### N2D-BODY-031 - Morphology Drives Wardrobe Fit

Wardrobe generation must reference the base body's topology and morphology
profile. Outfit fit cannot be derived only from a flat rendered image if a
valid base body is available.

## 5. Deformation And Action Topology

### N2D-BODY-040 - Deformation Topology Is Asset-Level

Base body deformation topology records the regions and constraints that make
asset channels solvable. It may describe deformation regions, attachment
influence regions, and local hierarchy needed by later capability tiers.

It must not define runtime frame scheduling, live action stream semantics,
Avatar backend route execution, or renderer-specific parameter APIs.

### N2D-BODY-041 - Action Topology References Are Stable

Action topology references are stable asset-side names for later package
capability claims. They must be bound to the base body topology, not to an
outfit.

Avatar backend contracts decide how runtime projection executes any admitted
action channel.

## 6. Validation Floor

Base body validation is valid only if:

- exactly one main base body topology owns the main rig
- required anchors and required slots are resolved
- topology version and slot taxonomy ref are present
- default outfit binding is required before renderable character success
- base body detail-neutrality is enforced
- wardrobe assets cannot redefine the main skeleton
- no base-body-only render state exists
- no Avatar runtime backend behavior is defined by base body data
