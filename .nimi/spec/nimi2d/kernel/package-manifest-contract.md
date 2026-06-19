# Nimi2D Package Manifest Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D package manifest authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Capability tier contract](capability-tier-contract.md)
> - [Base body contract](base-body-contract.md)
> - [Wardrobe and slot contract](wardrobe-slot-contract.md)
> - [Renderability governance contract](renderability-governance-contract.md)
> - [Layer input contract](layer-input-contract.md)
> **Table**: [Package manifest schema](tables/package-manifest.schema.yaml)

## 0. Purpose

This contract defines the closed Nimi2D package manifest. The manifest records
asset topology, wardrobe binding, governance posture, tier claims, and evidence
needed for package admission.

It is not a runtime backend manifest. It must not define Avatar execution,
PixiJS behavior, Runtime projection semantics, APML syntax, or live action
stream composition.

## 1. Manifest Identity

### N2D-PKG-001 - Package Manifest

A Nimi2D package manifest must include:

- `manifest_kind: "nimi.nimi2d.package"`
- `schema_version: 1`
- `package_id`
- `package_version`
- `package_kind`
- `canvas`
- `source`
- `integrity`
- `governance`
- `capability`
- `base_body`
- `wardrobe`
- `render_layers`
- `assets`

Unknown top-level fields are invalid.

### N2D-PKG-002 - Package Kinds

Current v1 admits:

- `character_package`
- `wardrobe_asset_package`
- `prop_package`
- `scene_package`

Only `character_package` may contain a non-null base body. Other package kinds
must set `base_body: null`, reference a compatible external base topology where
needed, and must not define a new main rig.

## 2. Base Body And Wardrobe Structure

### N2D-PKG-010 - Base Body Section Owns Rig

For `character_package`, the manifest `base_body` section is the only manifest
section that may declare:

- `topology_id`
- `topology_version`
- `skeleton_id`
- `anchor_set_id`
- `slot_set_id`
- `anchors`
- `slots`
- `morphology_profile_id`
- `deformation_topology_id`
- `action_topology_ref`

It must also declare:

- `owns_main_rig: true`
- `renderable: false`
- `detail_neutral: true`

Resolved `anchors` and `slots` are package topology evidence used by validators
and Generation Bench scoring. They are not Avatar runtime route ids or renderer
objects.

For `wardrobe_asset_package`, `prop_package`, and `scene_package`, `base_body`
must be `null`.

### N2D-PKG-011 - Wardrobe Section Binds Slots

The manifest `wardrobe` section declares wardrobe assets and slot bindings.

Every wardrobe asset must declare:

- `wardrobe_asset_id`
- `wardrobe_kind`
- `compatible_topology_id`
- `compatible_topology_version`
- `owns_main_rig: false`
- `slot_bindings`
- `coverage`
- `draw_order_group`

Wardrobe assets must not declare main skeleton, action topology owner, Avatar
backend route ids, runtime channels, or raw APML.

### N2D-PKG-012 - Default Outfit Is Required

`character_package` manifests must include `wardrobe.default_outfit_ref`.

The referenced wardrobe asset must be kind `default_outfit`, satisfy the outfit
requirement, bind valid outfit slots, and pass governance checks.

### N2D-PKG-013 - Layers Are Classified By Ownership

Manifest layer refs must be classified as:

- `base_body_layer`
- `wardrobe_layer`
- `accessory_layer`
- `prop_layer`
- `scene_layer`

`base_body_layer` refs belong to non-renderable base-body topology. They are
not visible success states. `wardrobe_layer`, `accessory_layer`, `prop_layer`,
and `scene_layer` are display assets when validly bound.

### N2D-PKG-014 - Render Layers Carry Runtime Geometry

The manifest must include self-contained `render_layers` derived from the
admitted layer input. Each render layer declares:

- `layer_ref`
- `asset_id`
- `layer_kind`
- `draw_order_index`
- `placement_px`
- `texture_bounds_px`
- `visible_bounds_px`

`canvas` defines the package coordinate space for `placement_px`.
`texture_bounds_px` and `visible_bounds_px` are in layer texture coordinates.
`texture_bounds_px` is the source texture frame that renderers must crop to;
pixels outside this rectangle must not be visible through rectangular sprite
rendering.

Render layers may optionally declare:

- `mask`

When present, `mask` is a package-level alpha mask asset binding. It must use:

- `mask_kind: "alpha_mask_asset"`
- `asset_id`
- `channel: "alpha"`
- `texture_bounds_px`

The referenced mask asset must exist in `assets`, must use
`asset_kind: "alpha_mask_layer"`, and must pass the same PNG RGBA asset
admission metadata as other package assets. `mask.texture_bounds_px` is in the
mask asset texture coordinate space, must fit inside the mask asset dimensions,
and must have the same width and height as the owning render layer
`texture_bounds_px`.

Mask binding is package truth. Avatar renderers may implement it through PixiJS
or another renderer substrate, but must not introduce renderer-local mask tables
or hardcoded layer masks outside the package manifest.

`render_layers` must cover every `base_body.layer_refs` and every
`wardrobe.assets[].layer_refs` entry exactly once. `draw_order_index` must be
unique and contiguous from zero. `visible_bounds_px` must fit inside
`texture_bounds_px`.

Avatar renderers must consume `render_layers` from the package manifest. They
must not recover placement, bounds, or draw order by reading upstream layer
input manifests at runtime.

### N2D-PKG-015 - Package Assets Are Self-Describing Admission Units

Every package asset must carry the same immutable PNG admission metadata that
was validated at layer-input admission:

- `asset_id`
- `asset_kind`
- `ref`
- `sha256`
- `format`
- `width_px`
- `height_px`
- `byte_size`
- `color_space`
- `alpha_mode`
- `premultiplied_alpha`

`format` must be `png`, `color_space` must be `srgb`, `alpha_mode` must be
`straight`, and `premultiplied_alpha` must be `false`.

Package admission must verify asset bytes against this metadata when the
package is materialized on disk:

- asset ref is package-root-relative and cannot escape the package directory
- asset file exists
- SHA-256 digest matches `sha256`
- decoded PNG dimensions match `width_px` and `height_px`
- decoded byte length matches `byte_size`
- decoded PNG is 8-bit RGBA

`render_layers[].texture_bounds_px` must fit inside the referenced asset
dimensions. Renderer-side bounds rejection is a final fail-closed defense, not
the primary admission mechanism.

`render_layers[].mask.texture_bounds_px`, when present, must fit inside the
referenced alpha mask asset dimensions and match the owning render layer texture
bounds size. Renderer-side mask bounds rejection is a final fail-closed defense,
not the primary admission mechanism.

## 3. Evidence

### N2D-PKG-020 - Upstream Evidence Is Source Evidence Only

The manifest must preserve source evidence refs for:

- layer generation
- occlusion completion when applicable
- identity preservation or upstream non-applicability
- content admission

These refs are evidence lineage. They do not transfer segmentation, occlusion
inpainting, or content classification ownership to Nimi2D.

### N2D-PKG-021 - Generation Evidence

The manifest may record Nimi2D package-generation evidence:

- anchor solving evidence
- slot solving evidence
- wardrobe binding evidence
- capability validation evidence
- package validator evidence

Generation Bench evidence is separate release-gate evidence governed by
`generation-bench-contract.md`. It is not required for package manifest
validity and must not be claimed as package-manifest authority.

## 4. Capability Claims

### N2D-PKG-030 - Requested Tier And Proven Tier Are Separate

The manifest may include `capability.requested_tier`.

Package admission records `capability.proven_tier` only after validation against
`tables/capability-channel-matrix.yaml`.

Self-declared tier success is invalid.

### N2D-PKG-031 - Tier-1 Mouth Boundary

If `proven_tier` is `tier-1_agent_basic`, the manifest may include
jaw/amplitude mouth channel evidence. It must not claim AEIOU true viseme.

### N2D-PKG-032 - Runtime Fields Are Forbidden

The manifest must not include:

- `blend_tree`
- `runtime_composer`
- `performance_stream`
- `avatar_route_id`
- `backend_kind`
- `pixi_runtime`
- `raw_apml`
- `apml`
- `runtime_timeline`
- `audio_consumer`
- `hit_region_runtime`

Any such field is an authority-boundary violation.

## 5. Governance

### N2D-PKG-040 - Governance Section Is Mandatory

The manifest must record:

- `base_body_renderable: false`
- `default_outfit_required: true` for character packages
- `adult_capability: unavailable_v1`
- `content_admission_ref`
- `underage_body_content: rejected_or_not_present`

Missing or ambiguous governance evidence fails closed.

### N2D-PKG-041 - Adult Capability Cannot Be Claimed

No v1 package manifest may claim adult capability support. Adult-oriented
content is structurally reserved but unavailable until separate admission.

## 6. Validation Floor

Package manifest validation is valid only if:

- unknown fields fail closed
- base body is the only main rig owner
- base body is non-renderable and detail-neutral
- default outfit exists for character packages
- wardrobe assets bind admitted slots and cannot own main rig
- render layers cover package layer refs with admitted geometry
- requested tier and proven tier are distinct
- tier overclaims fail closed
- upstream segmentation/occlusion evidence remains source evidence only
- runtime blend/composer/APML/Avatar route fields are absent
