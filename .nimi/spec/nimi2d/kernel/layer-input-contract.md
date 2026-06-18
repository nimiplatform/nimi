# Nimi2D Layer Input Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 1 layer input authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parent**: [Authority boundary contract](authority-boundary-contract.md)
> **Tables**:
> - [Layer input schema](tables/layer-input.schema.yaml)
> - [Reject codes](tables/reject-codes.yaml)

## 0. Purpose

This contract defines the first admissible input to Nimi2D package generation:
a closed, already-layered RGBA asset manifest.

Nimi2D does not decide how an image is selected, segmented, layered, or
occlusion-filled. It accepts only layer input that already satisfies this
contract. Invalid input is rejected with a typed code.

## 1. Input Boundary

### N2D-INPUT-001 - Raw Image Intake Is Forbidden

Nimi2D package generation must not accept a single raw avatar image, prompt,
URL, model output blob, PSD, SVG, or editor document as its direct input.

The only Wave 1 admitted input is a manifest with
`manifest_kind: "nimi.nimi2d.layer-input"` and `schema_version: 1`, validated
against `tables/layer-input.schema.yaml`.

### N2D-INPUT-002 - Upstream Layer Generation Is External Evidence

Layer creation methods are outside Nimi2D. Manual cutting, segmentation models,
occlusion inpainting, identity preservation, and content admission may produce
evidence refs, but those methods are not Nimi2D-owned.

Nimi2D must record source evidence refs and validate their required presence.
It must not reinterpret those refs as proof that Nimi2D performed upstream
segmentation or safety classification.

### N2D-INPUT-003 - Fail Closed, No Guessing

Layer input admission is fail-closed.

The validator must reject invalid or incomplete input. It must not:

- infer missing semantic labels
- infer missing anchors or slots
- repair out-of-bounds coordinates
- reorder layers silently
- rewrite asset refs
- fill occluded pixels
- convert non-RGBA assets
- accept unknown fields as future success

Every rejection must use a code from `tables/reject-codes.yaml`.

## 2. Manifest Identity

### N2D-INPUT-010 - Layer Input Manifest

A valid layer input manifest must include:

- `manifest_kind: "nimi.nimi2d.layer-input"`
- `schema_version: 1`
- `input_id`
- `input_kind`
- `canvas`
- `coordinate_space`
- `source_evidence`
- `layers`
- `draw_order`
- `global_anchor_hints`
- `global_slot_hints`

Unknown top-level fields are invalid.

### N2D-INPUT-011 - Input Kinds

`input_kind` is an admission intent only. Detailed base-body and wardrobe
topology are admitted by later contracts.

Allowed values:

- `character_skin`
- `wardrobe_item`
- `accessory_item`
- `prop_item`
- `scene_item`

`character_skin` is the default path for generating a complete Nimi2D character
asset with base body and default outfit downstream. `wardrobe_item` and
`accessory_item` are additional asset-generation inputs for an existing topology
once wardrobe contracts are admitted.

## 3. Coordinate And Asset Rules

### N2D-INPUT-020 - Coordinate Space

All coordinates are canvas pixel coordinates:

- origin: `top_left`
- unit: `px`
- axis: `x_right_y_down`
- values: integer pixels
- canvas bounds: `[0, 0, width, height]`

Layer placement and anchor/slot hints must be within the canvas unless a future
contract explicitly admits overflow. Wave 1 admits no overflow.

### N2D-INPUT-021 - Asset Refs

Layer asset refs must be normalized relative paths rooted inside the layer input
directory. Absolute paths, parent traversal, URL refs, shell expansions, and
platform-specific user paths are invalid.

### N2D-INPUT-022 - RGBA Layer Assets

Every layer asset must decode to RGBA pixels. Required asset facts:

- format: `png`
- color space: `srgb`
- alpha mode: `straight`
- premultiplied alpha: `false`
- sha256: lowercase hex digest
- width and height: positive integer pixels
- byte size: positive integer

The validator must inspect the decoded asset or trusted local asset probe
evidence. Manifest claims alone are not enough.

### N2D-INPUT-023 - Bounds

Each layer must define:

- `texture_bounds_px`: the asset rectangle in texture coordinates
- `visible_bounds_px`: non-transparent visible content bounds in texture
  coordinates
- `placement_px`: the top-left position of the texture on the canvas

The validator must reject negative width/height, visible bounds outside texture
bounds, texture placement outside the canvas, and visible content that falls
outside the canvas.

## 4. Layer Semantics

### N2D-INPUT-030 - Semantic Labels

Each layer must have at least one closed semantic label.

Allowed labels:

- `head`
- `face`
- `eye`
- `brow`
- `mouth`
- `nose`
- `ear`
- `hair`
- `neck`
- `torso`
- `arm`
- `hand`
- `leg`
- `foot`
- `body`
- `outfit`
- `accessory`
- `prop`
- `scene`
- `shadow`
- `effect`

Unknown labels are invalid. More detailed topology names belong to later
contracts and must not be smuggled into arbitrary strings.

### N2D-INPUT-031 - Minimum Semantic Coverage

`character_skin` input must include enough explicit semantics for downstream
anchor/slot solving:

- at least one `body` or `torso` layer
- at least one `head` or `face` layer
- at least one `eye` layer
- at least one `mouth` layer
- at least one `outfit` layer

`wardrobe_item`, `accessory_item`, `prop_item`, and `scene_item` must include at
least one layer matching their input kind.

The validator must reject missing coverage. It must not infer a mouth, eye,
body, outfit, or scene from pixel shape.

### N2D-INPUT-032 - Side And Part Hints

Layer side hints are optional but closed when present:

- `left`
- `right`
- `center`
- `bilateral`
- `none`

Part hints may only use closed values admitted by
`tables/layer-input.schema.yaml`. They are hints for downstream solving, not
rig topology authority.

## 5. Draw Order

### N2D-INPUT-040 - Draw Order Is Explicit

`draw_order` is a top-level ordered list of layer ids. Lower index draws first.

The list must contain every layer id exactly once. Unknown ids, missing ids, and
duplicates are invalid.

Nimi2D must not reorder layers by filename, semantic label, bbox position, or
asset timestamp.

## 6. Anchor And Slot Hints

### N2D-INPUT-050 - Global Anchor Hints

Layer input must carry global anchor hints in canvas coordinates.

`character_skin` requires:

- `body_root`
- `neck_base`
- `head_center`
- `face_center`
- `left_eye_center`
- `right_eye_center`
- `mouth_center`

Other input kinds must carry at least one anchor hint that names the intended
attachment or placement point.

Anchor hints are evidence for downstream solving. They are not final rig
anchors and do not own Avatar runtime channel semantics.

### N2D-INPUT-051 - Global Slot Hints

Layer input must carry slot hints that identify intended attachment regions.

Wave 1 admits only provisional slot hint kinds:

- `head`
- `face`
- `hair`
- `neck`
- `torso`
- `hip`
- `left_arm`
- `right_arm`
- `left_hand`
- `right_hand`
- `left_leg`
- `right_leg`
- `left_foot`
- `right_foot`
- `outfit_upper`
- `outfit_lower`
- `outfit_full`
- `accessory_head`
- `accessory_face`
- `accessory_hand`
- `prop_hand`
- `scene_back`
- `scene_front`

The future wardrobe/slot contract owns final slot topology. Wave 1 slot hints
only define admissible input vocabulary.

## 7. Occlusion And Evidence

### N2D-INPUT-060 - Occlusion Fill Is Upstream-Complete

Every layer must declare one of:

- `not_applicable`
- `filled_by_upstream`

`missing`, `partial`, `unknown`, or absent occlusion state is invalid.

When a layer declares `filled_by_upstream`, it must reference upstream occlusion
evidence. Nimi2D must not inpaint or hide missing occlusion fill during layer
input admission.

### N2D-INPUT-061 - Source Evidence

The manifest must include source evidence refs:

- `layer_generation_ref`
- `identity_preservation_ref`
- `content_admission_ref`

`occlusion_completion_ref` is required when any layer declares
`filled_by_upstream`.

Evidence refs are opaque strings owned by the upstream product/process that
created the layer input. Nimi2D validates presence and shape only. For
`prop_item` and `scene_item`, identity preservation may point to an upstream
non-applicability evidence record; absence is still invalid.

## 8. Fixture Families

Wave 1 admits fixture families only as validation targets, not as package
success proof:

- valid minimal `character_skin`
- valid minimal `wardrobe_item`
- invalid raw image intake
- invalid missing semantic coverage
- invalid non-RGBA asset
- invalid asset hash mismatch
- invalid draw order mismatch
- invalid missing occlusion evidence
- invalid missing required anchor
- invalid out-of-root asset ref

Generation Bench success is not admitted by this contract.

## 9. Validation Floor

Layer input admission is valid only if:

- valid fixtures pass without warnings
- invalid fixtures fail with specific `NIMI2D_LAYER_INPUT_*` codes
- no invalid input can be marked as package-admission-ready
- no raw image path exists
- no missing evidence is silently accepted
- no layer asset is mutated during validation
- no generated rig, renderer, runtime backend, or Avatar channel is produced by
  the layer input validator
