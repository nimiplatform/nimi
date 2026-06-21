# Nimi2D Kernel Authority Map

This document defines the contract surface that governs Nimi2D generated 2D
avatar asset packages. It is admitted as Nimi2D normative authority.

## Authority Scope

Nimi2D is a first-party Nimi asset/package/generation authority for AI-generated
2D avatar skins. It governs the shape of a Nimi2D package before that package is
consumed by an Avatar backend.

Nimi2D does not own production Avatar runtime embodiment, Avatar renderer
backend execution, Runtime presentation timeline truth, Desktop stream
lifecycle, Realm Agent Studio product workflow, or upstream image segmentation
and occlusion inpainting. Nimi2D does own bounded reference package-player,
renderer, and proof helpers when they are used to validate Nimi2D package
readiness. Nimi2D also owns the standard Codex Image2 image resource provider
workflow that produces upstream evidence for later source-image gates and
diagnostic atlas gates.

## Rule ID Format

`N2D-<DOMAIN>-NNN`

| Domain | Meaning |
|---|---|
| `AUTH` | Authority boundary, imports, non-goals, and stop rules |
| `IMG2` | Codex Image2 image resource provider workflows and evidence |
| `INPUT` | Layer input admission and typed rejects |
| `BODY` | Base body topology and non-renderable rig ownership |
| `WARD` | Wardrobe, outfit, accessory, slot, and attachment rules |
| `GOV` | Renderability and content-governance invariants |
| `TIER` | Asset capability tier claims |
| `PKG` | Package manifest and package admission |
| `BENCH` | Generation Bench corpus, replay, metrics, and gates |

## Contracts

### [`authority-boundary-contract.md`](authority-boundary-contract.md)

Nimi2D authority boundary:

- Nimi2D owns generated asset/package contracts
- Nimi2D owns bounded reference package-player, renderer, and proof helpers for
  package readiness
- Avatar owns production runtime embodiment backend execution
- Runtime owns typed projection and PresentationTimeline truth
- Desktop owns stream lifecycle/UI consumption only
- upstream segmentation and occlusion inpainting are outside Nimi2D
- Codex Image2 image resource provider workflow is Nimi2D-owned upstream
  evidence production
- package-local authority requires Platform package admission
- shared implementation helpers under `@nimiplatform/nimi2d/runtime` do not
  move production Avatar runtime authority into `.nimi/spec/nimi2d/**`
- stop rules for drift into production runtime, product UI, raw images, raw
  APML, or false capability claims

### [`codex-image2-provider-contract.md`](codex-image2-provider-contract.md)

Nimi2D Codex Image2 provider authority:

- Codex Image2 is the standard first-party Nimi2D image resource provider
- provider output is upstream evidence, not formal package input
- product-facing workflow families are prompt to source image, image plus
  prompt to improved source image, and companion asset image; image to layer
  atlas remains diagnostic/research until separately admitted
- provider requests and artifacts use closed Nimi2D manifest kinds
- automation must route through provider commands and Codex CLI response
  contracts instead of manual session-only prompts

### [`layer-input-contract.md`](layer-input-contract.md)

Nimi2D layer input authority:

- manifest identity for contract-conformant layer input
- relative asset refs, sha256, RGBA, color space, alpha mode, and pixel bounds
- top-left pixel coordinate space and draw order
- semantic layer labels, anchor hints, and slot hints
- upstream evidence refs for layer generation, occlusion completion, identity
  preservation, and content admission
- fail-closed typed rejection for invalid, incomplete, guessed, repaired, raw
  image, or out-of-root input

### [`renderability-governance-contract.md`](renderability-governance-contract.md)

Nimi2D renderability and governance invariants:

- no-outfit/no-render as a protocol-level state constraint
- base-body-only render, preview, thumbnail, export, error fallback, debug
  pixel view, and bench success are forbidden
- outfit switching is atomic; no naked intermediate frame is admitted
- base body is anatomically-informed and detail-neutral
- adult-oriented outfit capability is reserved, not implemented or distributed
  in v1
- upstream content-admission evidence is required, while Nimi2D does not own
  pixel classification

### [`base-body-contract.md`](base-body-contract.md)

Nimi2D base body authority:

- base body is the sole owner of main skeleton, anchors, slots, deformation
  topology, morphology profile, and action topology references
- base body is non-renderable without an outfit
- base body is anatomically-informed and detail-neutral
- topology is versioned and reused across all outfits
- base body must not define Avatar runtime execution

### [`wardrobe-slot-contract.md`](wardrobe-slot-contract.md)

Nimi2D wardrobe and slot authority:

- wardrobe, outfit, accessory, prop, and scene assets bind to base-body slots
- wardrobe inherits base-body skeleton deformation and cannot own the main rig
- local attachment rigs are allowed only for subordinate cloth, hair,
  accessory, prop, and secondary motion
- outfit switching is atomic and zero generation cost after the wardrobe asset
  exists
- slot taxonomy is closed by `tables/slot-taxonomy.yaml`

### [`capability-tier-contract.md`](capability-tier-contract.md)

Nimi2D asset capability tier authority:

- tier-0 through tier-3 are admitted
- tier-N is a reserved future deformation extension point
- default acceptable generated asset target is tier-1
- tier-1 speech is jaw/amplitude mouth support, not AEIOU true viseme
- tier claims are asset/package claims only, not runtime execution truth
- overclaimed capability fails closed

### [`package-manifest-contract.md`](package-manifest-contract.md)

Nimi2D package manifest authority:

- closed `manifest_kind: "nimi.nimi2d.package"` schema
- base body owns rig and is non-renderable
- wardrobe assets bind slots and cannot own main rig
- default outfit is required for renderable character packages
- `canvas` and `render_layers` make runtime layer geometry self-contained in
  the package manifest
- evidence records upstream layer generation, occlusion, identity, and content
  admission as external refs
- runtime blend/composer/Avatar route fields are forbidden

### [`generation-bench-contract.md`](generation-bench-contract.md)

Nimi2D Generation Bench authority:

- bench input is contract-conformant layer input, not raw images
- upstream segmentation/occlusion quality is outside Nimi2D bench authority
- Generation Bench is the go/no-go gate for default generated Nimi2D assets
- release-candidate audit may aggregate provider distribution, certified
  corpus, Generation Bench, Runtime Proof Matrix, visual proof, and reference
  action proof without becoming product release approval
- manual correction and product review reports are explicit product-readiness
  evidence and must not be inferred from technical pass results
- product-readiness evidence may be validated independently before aggregation
- release review packets are local evidence collection aids and do not count as
  product approval by themselves
- release review packets may be independently validated for self-contained
  assets and pending templates
- hard gates, quality gates, and tracking metrics are separated
- corpus and result schemas require content hashes, deterministic replay,
  complete case reporting, failure attribution, and anti-cherry-pick rules
- Live Action Bench is Avatar value-ceiling proof, not Generation Bench closure

## Tables

### [`tables/layer-input.schema.yaml`](tables/layer-input.schema.yaml)

Closed v1 machine-readable schema authority for Nimi2D layer input manifests.

### [`tables/reject-codes.yaml`](tables/reject-codes.yaml)

Closed `NIMI2D_LAYER_INPUT_*` typed reject registry for layer input admission.

### [`tables/slot-taxonomy.yaml`](tables/slot-taxonomy.yaml)

Closed v1 Nimi2D anchor, slot, and wardrobe compatibility taxonomy.

### [`tables/capability-channel-matrix.yaml`](tables/capability-channel-matrix.yaml)

Closed tier-to-channel requirement matrix for Nimi2D asset capability claims.

### [`tables/package-manifest.schema.yaml`](tables/package-manifest.schema.yaml)

Closed v1 machine-readable schema authority for Nimi2D package manifests.

### [`tables/generation-bench-gates.yaml`](tables/generation-bench-gates.yaml)

Closed hard gate, quality gate, and tracking metric table for Generation Bench.

### [`tables/generation-bench-corpus.schema.yaml`](tables/generation-bench-corpus.schema.yaml)

Closed corpus manifest schema for Generation Bench case sets.

### [`tables/generation-bench-result.schema.yaml`](tables/generation-bench-result.schema.yaml)

Closed deterministic result schema for Generation Bench runs.

## Planned Contracts

No Nimi2D kernel contract is planned-only in the current admitted surface.
Avatar runtime backend contracts live under `.nimi/spec/avatar/**`, not here.
Nimi2D reference package-player/proof helpers are admitted in
`authority-boundary-contract.md` and must not be treated as production Avatar
runtime contracts.

## Upstream Authority References

Nimi2D consumes, but does not redefine:

- `.nimi/spec/avatar/kernel/embodiment-projection-contract.md`
- `.nimi/spec/avatar/kernel/backend-branch-contract.md`
- `.nimi/spec/avatar/kernel/nimi2d-backend-contract.md`
- `.nimi/spec/avatar/kernel/generated-motion-provider-contract.md`
- `.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`
- `.nimi/spec/avatar/kernel/tables/backend-capability-profile.schema.yaml`
- `.nimi/spec/avatar/kernel/tables/nimi2d-backend-capability-profile.schema.yaml`
- `.nimi/spec/avatar/kernel/tables/nimi2d-live-action-routes.yaml`
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md`
- `.nimi/spec/platform/kernel/tables/package-authority-admissions.yaml`

## Derived Views

No Nimi2D derived view is currently admitted as independent authority.
