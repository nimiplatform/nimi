# Nimi2D Asset Package - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/nimi2d/asset-package.authority.yaml` 与 `.nimi/spec/nimi2d/generation-supply.authority.yaml`。

---

<!-- source: .nimi/spec/nimi2d/index.md -->

# Nimi2D Guide

> Normative Imports: `.nimi/spec/nimi2d/*`

## Scope

This guide points to Nimi2D authority surfaces for index. It does not define
product rules.

## Reading Path

- `docs/spec/nimi2d-domain-index.md`
- `.nimi/spec/nimi2d/asset-package.authority.yaml`
- `.nimi/spec/nimi2d/generation-supply.authority.yaml`

## Tables

- `.nimi/spec/nimi2d/asset-package.authority.yaml`

---

<!-- source: .nimi/spec/nimi2d/kernel/authority-boundary-contract.md -->

# Nimi2D Authority Boundary Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D authority boundary
> **Owner**: Nimi2D generated asset/package contract surface
> **Sibling authority**: `.nimi/spec/avatar/**`, `.nimi/spec/runtime/**`,
> `.nimi/spec/desktop/**`, `.nimi/spec/platform/**`

## 0. Purpose

This contract defines the active Nimi2D authority boundary across package,
input, wardrobe, governance, capability, provider, reference-player, and
Generation Bench contracts.

Nimi2D exists to make AI-generated 2D avatar packages reliable enough for Nimi
agents. It is not a general creator-format replacement for Live2D, VRM, Rive,
or PixiJS.

## 1. Authority Boundary

### N2D-AUTH-001 - Nimi2D Owns Asset Package Truth

Nimi2D owns the contracts for generated Nimi2D asset packages:

- Codex Image2 image resource provider requests, artifacts, and workflow
  evidence
- layer input admission
- typed layer reject reasons
- base body topology
- wardrobe, outfit, accessory, and slot topology
- asset capability tiers
- package manifest
- package admission validation
- Generation Bench corpus, replay, metrics, and gates

### N2D-AUTH-002 - Nimi2D Package Generation Starts From Layer Input

Nimi2D package generation starts from a layer input contract. It must not accept
a raw source avatar image as its package generation input.

The Nimi2D Codex Image2 provider may produce upstream image resources and
evidence for later layer or atlas workflows. Segmentation, occlusion
inpainting, identity preservation, and content admission may still be performed
by upstream systems. Nimi2D treats those outputs as source evidence until a
contract-conformant layer input or package manifest passes its own gates.

### N2D-AUTH-003 - Avatar Owns Runtime Embodiment

Production runtime embodiment execution for Nimi2D packages belongs under
Avatar backend authority, not under `.nimi/spec/nimi2d/**`.

Avatar owns:

- backend branch runtime execution
- backend-local live action composer
- backend route mapping
- projection-to-channel mapping
- scheduler and smoothing behavior
- hit regions
- backend audio consumer and lipsync driver
- renderer/carrier integration
- visual acceptance evidence

Nimi2D may define asset channels, package capability claims, and bounded
reference-player helpers for package proof. It must not define the production
runtime composer, backend route mapping, or performance stream that executes
those channels in Avatar.

### N2D-AUTH-011 - Nimi2D Owns Reference Package Player And Proof Helpers

Nimi2D may own a reference package player and deterministic proof helpers when
they are used to validate the package format itself.

Admitted Nimi2D-owned reference helper scope:

- parse a Nimi2D package manifest
- build a renderer-independent render plan from package manifest geometry
- render through a first-party reference renderer
- advance deterministic proof frames for fixture, bench, or inspector replay
- apply bounded semantic action fixtures against package-declared asset
  channels
- drive a reference jaw/amplitude mouth helper for tier-1 package proof
- expose snapshots used by visual proof, alpha hit probe, Runtime Proof Matrix,
  and standalone package inspection

These helpers are package proof infrastructure. They do not own:

- Runtime presentation projection truth
- PresentationTimeline identity
- Runtime stream identity or interrupt semantics
- Avatar backend route mapping
- production scheduler, smoothing, latency, or blend policy
- production audio consumer or lipsync driver
- Desktop stream lifecycle
- carrier/window integration
- Avatar visual acceptance authority

If Avatar consumes a Nimi2D reference helper, Avatar authority owns the mapping
from Runtime projection into that helper and owns the production execution
evidence. Nimi2D reference-player success is package readiness evidence, not
Avatar runtime readiness.

### N2D-AUTH-004 - Runtime Owns Projection Truth

Runtime owns typed presentation/state projection, PresentationTimeline identity,
stream identity, interrupt semantics, and voice/lipsync projection boundaries.

Nimi2D must not define raw APML syntax, runtime activity ontology, canonical
timeline offsets, stream identity, or interrupt semantics.

### N2D-AUTH-005 - Desktop Owns Stream Lifecycle Only

Desktop stream layers may consume runtime/avatar projection for UI lifecycle,
buffering, cancellation, retry, and timeout behavior. Desktop must not become
the owner of Nimi2D action semantics, package semantics, backend runtime
execution, or prompt semantics.

### N2D-AUTH-006 - Package Authority Is Not Inferred

The `@nimiplatform/nimi2d` package implements validators, generation scripts,
provider tooling, and reference package-player proof helpers. It may also
expose renderer-agnostic render plans and bounded bench scorers when those
helpers stay inside the N2D-AUTH-011 proof boundary. Package membership does
not make package-local spec truth authoritative.

Code location is not semantic ownership. The release-facing package proof API is
`@nimiplatform/nimi2d/reference-player`; lower-level helper code may still live
under `@nimiplatform/nimi2d/runtime` while it is being thinned. Both are
Nimi2D-owned only for reference package proof. When Avatar consumes a helper for
production embodiment, the Avatar contract owns projection mapping, backend
route semantics, carrier behavior, and runtime evidence. The helper must not
create a second Runtime ontology, public APML syntax, or package-local Avatar
backend authority.

Package metadata and package-local documentation never become Nimi product
authority. Product semantics remain in the existing `.nimi/spec/**` owner
containers.

## 2. Non-Goals

Nimi2D does not own:

- segmentation, occlusion inpainting, identity preservation, or content
  classification from pixels outside the Codex Image2 provider evidence surface
- Realm Persona Studio product workflow or editor UX
- production Avatar runtime backend execution
- production Avatar carrier/PixiJS integration API design
- Live2D/VRM compatibility shims
- external creator-tool interchange compatibility
- raw APML syntax or prompt formatting
- Adult-content distribution in v1

Nimi2D may remain open source as part of Nimi. External compatibility is not a
v1 authority constraint.

## 3. Current Decisions

### N2D-AUTH-007 - First-Party Package Direction

The active implementation surface is the independent
`@nimiplatform/nimi2d` package, primarily serving Nimi first-party flows.

Package code is admitted as implementation surface only. Semantic authority
continues to live under `.nimi/spec/nimi2d/**` and admitted sibling Avatar,
Runtime, Desktop, and Platform contracts.

### N2D-AUTH-008 - Default Asset Target

The default acceptable generated asset target is `tier-1_agent_basic`, as
defined by `capability-tier-contract.md`.

Tier semantics are owned by the capability-tier contract and its closed matrix,
not by package-local claims or runtime playback success.

### N2D-AUTH-009 - Tier-1 Speech Boundary

Tier-1 speech must not claim typed AEIOU viseme. Current runtime lipsync
projection supports jaw/amplitude-style mouth movement (`mouth_open_y` and
`audio_level`).

True viseme may only be admitted as tier-2+ asset capability or as an
Avatar-local audio consumer capability after separate Avatar admission.

### N2D-AUTH-010 - Adult Capability Posture

Adult-oriented outfit capability is structurally reserved but not implemented,
distributed, fixture-loaded, or included in default corpora in v1.

The default Nimi2D posture is compliant SFW content.

## 4. Stop Rules

Nimi2D work must stop and return to authority alignment if any proposed change:

- defines production Avatar runtime live action, scheduler, route mapping, or
  blend-tree truth under `.nimi/spec/nimi2d/**`
- treats Nimi2D reference-player replay as Runtime projection truth or Avatar
  runtime readiness
- consumes raw APML or defines public APML syntax
- accepts a raw image as Nimi2D package input
- treats a Codex Image2 provider artifact as formal Nimi2D admission without
  layer-input, package, and bench gates
- guesses, repairs, or silently downgrades invalid layer input instead of typed
  rejection
- creates a base-body-only render, preview, thumbnail, export, error fallback,
  debug path, or package artifact as a visible success state
- treats adult outfit support as implemented or distributed in v1
- claims tier-1 true viseme support
- infers package authority from `@nimiplatform/nimi2d` package membership
- treats `@nimiplatform/nimi2d/reference-player` or
  `@nimiplatform/nimi2d/runtime` helper code as production Avatar runtime
  authority instead of bounded Nimi2D reference package-player proof
  infrastructure
- lets Realm Persona Studio or another product surface become Nimi2D package
  truth

## 5. Active Contract Set

The active Nimi2D authority surface includes:

1. Layer input contract and reject taxonomy.
2. Renderability and content-governance invariants.
3. Base body, wardrobe, and slot topology.
4. Asset capability tiers and package manifest.
5. Codex Image2 provider contract.
6. Generation Bench contract, corpus protocol, gates, and result schema.
7. Bounded reference package-player and proof helpers.
8. Avatar-owned Nimi2D backend and Live Action Bench contracts under
   `.nimi/spec/avatar/**`.

This list records current authority surfaces. Historical admission order lives
in Git history and must not be used as active truth.

## 6. Boundary Verification Floor

The Nimi2D boundary is valid only if:

- `docs/spec/INDEX.md` lists `nimi2d` as an active domain.
- `.nimi/spec/nimi2d/asset-package.authority.yaml` imports the Nimi2D kernel.
- `docs/spec/nimi2d-domain-index.md` references this contract.
- `docs/spec/nimi2d-domain-index.md` references the Codex Image2 provider
  contract when Image2 is used for Nimi2D image resources.
- No `.nimi/spec/nimi2d/**` file defines production Avatar runtime backend
  execution or Runtime projection truth.
- No `.nimi/spec/nimi2d/**` file defines raw image intake.
- No `.nimi/spec/nimi2d/**` file defines raw APML syntax.

---

<!-- source: .nimi/spec/nimi2d/kernel/base-body-contract.md -->

# Nimi2D Base Body Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D base body authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Authority boundary contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Renderability governance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)
> - [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
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

Current v1 admits the topology family:

- `topology_id: "nimi.nimi2d.base-body.topology"`
- `topology_version: 1`
- `slot_taxonomy_ref: ".nimi/spec/nimi2d/asset-package.authority.yaml"`

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

---

<!-- source: .nimi/spec/nimi2d/kernel/capability-tier-contract.md -->

# Nimi2D Capability Tier Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D capability tier authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Base body contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Wardrobe and slot contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Renderability governance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)
> **Table**: [Capability channel matrix](tables/capability-channel-matrix.yaml)

## 0. Purpose

This contract defines Nimi2D asset capability tiers. Tiers describe what a
package asset can support. They do not define Avatar runtime execution, live
action stream composition, Runtime projection semantics, or renderer APIs.

## 1. Tier Model

### N2D-TIER-001 - Tiers Are Asset Capability Claims

A Nimi2D tier is a package capability claim proven by package validation.

Tiers must not be used as:

- Live2D parity claims
- Avatar backend readiness claims
- production Runtime live action stream claims
- PixiJS renderer feature claims
- product UI readiness claims
- external creator-format compatibility claims

### N2D-TIER-002 - Admitted Tiers

Current v1 admits:

- `tier-0_static_layered`
- `tier-1_agent_basic`
- `tier-2_viseme_gesture`
- `tier-3_full_body_semantic`

`tier-N_reserved_deformation_extension` is a reserved future extension point,
not a current target.

### N2D-TIER-003 - Default Acceptable Generated Target

The default acceptable generated Nimi2D asset target is
`tier-1_agent_basic`.

Tier-0 may be valid for constrained fixtures, debug, or non-default fallback,
but it does not prove the default generated Nimi2D asset thesis.

### N2D-TIER-004 - Tier-1 Speech Is Jaw/Amplitude

Tier-1 speech means jaw/amplitude mouth support:

- mouth open/close channel
- amplitude-driven mouth movement
- safe closed-mouth reset
- no typed AEIOU viseme requirement

Tier-1 must not claim true AEIOU viseme.

### N2D-TIER-005 - True Viseme Starts At Tier-2

True viseme support requires distinct viseme shape channels and validation.

It may be tier-2+ asset capability or Avatar-local audio consumer capability
after separate Avatar admission. It is not a tier-1 claim.

### N2D-TIER-006 - No Live2D Parity Goal

No Nimi2D tier may be described as Live2D-equivalent, Cubism-equivalent, or
professional creator-rig-equivalent.

Nimi2D targets automatic, agent-aware embodiment assets. It does not target
hand-authored Live2D quality as the success definition.

## 2. Tier Definitions

### N2D-TIER-010 - Tier 0 Static Layered

Tier 0 proves a renderable layered asset package:

- layer input lineage is valid
- base body topology exists and is non-renderable
- default outfit exists and is bound
- wardrobe slot binding is valid
- static draw order is valid
- governance invariants pass

Tier 0 does not prove expressive speech, gestures, gaze, or local motion.

### N2D-TIER-011 - Tier 1 Agent Basic

Tier 1 proves the default generated asset floor:

- all tier-0 requirements
- discrete expression set
- blink and eye open/close channels
- jaw/amplitude mouth channel
- basic gaze anchor channels
- idle/listen/speak/think/greet motion primitive references
- safe motion bounds
- default outfit and wardrobe reuse
- no true AEIOU viseme claim

Tier 1 is sufficient for first-pass agent-aware embodiment when executed by a
future Avatar backend.

### N2D-TIER-012 - Tier 2 Viseme Gesture

Tier 2 proves a richer asset:

- all tier-1 requirements
- true viseme shape channels
- expression interpolation channels
- gesture overlay channels
- local attachment secondary motion channels
- stronger gaze and head-follow channel support

Tier 2 still does not define runtime composition. Avatar backend authority
decides how streams execute these channels.

### N2D-TIER-013 - Tier 3 Full Body Semantic

Tier 3 proves full-body semantic asset support:

- all tier-2 requirements
- full-body pose families
- full-body gesture primitive set
- coordinated limb/torso/head deformation regions
- wardrobe-aware deformation masks
- richer local attachment motion
- safety clamps for broad posture changes

Tier 3 is the highest admitted current tier.

### N2D-TIER-014 - Tier-N Reserved Extension

Tier-N is a reserved extension point for future deformation capability.

It does not create a current target, benchmark, success claim, or Live2D parity
goal. A future tier-N admission must define exact channels, validation, and
compatibility rules before use.

## 3. Channel Matrix

### N2D-TIER-020 - Channel Matrix Is Closed

`tables/capability-channel-matrix.yaml` is the closed tier-to-channel matrix.

Each channel has one disposition per tier:

- `mandatory`
- `optional`
- `unsupported`
- `out_of_scope`
- `forbidden`

Unknown channels cannot be counted toward a tier.

### N2D-TIER-021 - Overclaim Fails Closed

Package manifests may request a tier, but the validator computes the proven
tier from channel evidence.

If the manifest claims a tier or channel that validation cannot prove, package
admission fails closed or records the lower proven tier. It must not count a
partial or unverified channel as success.

### N2D-TIER-022 - Production Runtime Channels Are Out Of Scope

Production Runtime stream composition, blend trees, Avatar backend scheduling,
hit testing, audio consumers, and renderer-specific APIs are out of Nimi2D tier
scope.

Nimi2D tiers may name asset channels that a future Avatar backend can consume,
but they do not define runtime behavior.

Nimi2D reference package-player helpers may exercise tier channels for package
proof, deterministic replay, and inspection. That proof can show that the
package has usable channel evidence; it must not be reported as production
Avatar runtime readiness.

## 4. Validation Floor

Tier validation is valid only if:

- tier-1 does not claim AEIOU true viseme
- no tier claims Live2D parity
- production runtime live action/composer behavior is out of scope
- reference package-player replay is package proof only
- channel evidence is checked against the closed matrix
- requested tier and proven tier are distinct
- overclaimed channels fail closed
- tier-N is not used as a current success target

---

<!-- source: .nimi/spec/nimi2d/kernel/codex-image2-provider-contract.md -->

# Nimi2D Codex Image2 Provider Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Codex Image2 provider authority
> **Owner**: Nimi2D image resource provider surface
> **Parents**:
> - [Authority boundary contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Wardrobe and slot contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Generation Bench contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)

## 0. Purpose

This contract admits Codex Image2 as the standard first-party provider for
Nimi2D image resource generation.

The provider produces upstream image resources and evidence. It does not make a
raw image a Nimi2D package input, and it does not replace layer-input,
atlas-quality, package, Generation Bench, or runtime proof gates.

## 1. Provider Boundary

### N2D-IMG2-001 - Standard Provider

All new first-party Nimi2D image resource generation must route through the
Codex Image2 provider command surface.

Admitted standard commands are:

- `nimi2d image2-provider-plan`
- `nimi2d image2-provider-run`
- `nimi2d image2-register-output`
- `nimi2d image2-compare-pixels`
- `nimi2d image2-postprocess`
- `nimi2d image2-layer-workflow`
- `nimi2d image2-distribution-report`
- `nimi2d image2-demo-suite`

Ad hoc session-only prompts, manually pasted image paths without artifact
registration, and unrecorded Codex CLI invocations are not admitted provider
evidence.

`image2-demo-suite` is admitted only as local deterministic fixture evidence for
workflow validation and distribution-gate regression tests. It must label
artifacts as `demo_fixture`, and it must not be represented as live Codex Image2
generation evidence.

### N2D-IMG2-002 - Provider Output Is Evidence

Codex Image2 provider output is upstream image resource evidence.

It may be consumed by:

- source-image quality review
- image repair and enhancement review
- atlas generation and normalization
- companion asset source workflows
- future segmentation or layer extraction providers

It must not be consumed directly by Nimi2D package generation, package
admission, or Generation Bench.

### N2D-IMG2-003 - Fail Closed

The provider must fail closed when:

- no PNG artifact exists
- the artifact cannot decode as PNG/RGBA
- persistence route is not recorded
- pixel-identity evidence is required but mismatches
- Codex CLI execution fails
- a provider response claims success without a real file path
- workflow kind, target kind, companion kind, or slot kind is not admitted

The provider must not fabricate image paths, semantic success, policy
admission, or downstream Nimi2D admission.

### N2D-IMG2-004 - LLM Prompt Optimization Boundary

LLM/chat prompt optimization may be used only as external planning evidence or
local research input before a standard provider request is authored. It is not
an admitted Nimi2D provider command surface, provider evidence, image evidence,
or Nimi2D admission evidence.

The only admitted live generation surface for optimized prompts is the existing
provider run surface:

```text
image2-provider-plan -> image2-provider-run --adapter codex_cli -> image2-register-output
```

Live image generation must not depend on an OpenAI API key, direct image API
invocation, or any non-Codex CLI adapter.

## 2. Workflow Families

### N2D-IMG2-010 - Prompt To Source Image

`prompt_to_image` turns a description into a Nimi2D source image for later layer
or atlas work.

Required properties:

- SFW fully clothed character when human-form content is requested
- full subject visible with margin
- plain removable background
- crisp eyes, mouth, hands, hair, shoes, and outfit boundaries
- no text, watermark, border, labels, or transparency-preview checkerboard

Output is an image resource artifact only.

### N2D-IMG2-011 - Image Plus Prompt To Improved Source Image

`image_prompt_to_image` uses an input image and description to repair or improve
a Nimi2D source image.

It must preserve identity and design intent from the source image while
improving downstream layer extraction quality. It may not silently change the
character, age posture, outfit coverage, or content-admission posture.

Output is an image resource artifact only.

### N2D-IMG2-012 - Image To Layer Atlas

`image_to_layer_atlas` is a diagnostic/research provider workflow that attempts
to produce a Nimi2D machine-cut layer atlas from a high-quality generated source
image. It is not the release-facing production strategy for layer generation
until separately admitted by distribution evidence.

The diagnostic atlas contract is:

- `1536 x 1024` PNG
- `3 columns x 2 rows`
- one continuous exact `#00ff00` chroma-key background
- no visible grid, gutter, border, label, or separator
- cells: registration body, head/face, hair, eyes/brows, mouth, default outfit
- identical registration and scale in every cell

The diagnostic atlas workflow must still pass:

- atlas spec validation
- upstream raw atlas quality recording as diagnostic and failure-attribution
  evidence
- deterministic normalization
- transparent atlas conversion
- atlas quality gate
- layer-input validation
- image-input workflow bench

Raw atlas quality is a false-positive control for this workflow, not proof that
single-shot atlas generation is the product generation strategy. Codex/Image Gen
output is expected to need deterministic repair and normalization. The repair
path may be used for diagnostic evidence when provenance, repair artifacts, and
downstream gates are recorded instead of hidden.

### N2D-IMG2-013 - Companion Asset Image

`companion_asset` turns a description and optional image into a source image for
a wardrobe, accessory, hair variant, held prop, or scene companion asset.

The request must name:

- target input kind
- companion kind
- slot kind when slot-bound

Companion assets must not redefine the main rig or satisfy outfit requirements
unless admitted as `default_outfit` or `outfit` through wardrobe/package gates.

## 3. Artifact Protocol

### N2D-IMG2-020 - Provider Request Manifest

Every provider run starts from:

```yaml
manifest_kind: "nimi.nimi2d.codex-image2.request"
schema_version: 1
```

The request records workflow kind, target kind, optional contained source image
ref, source image hash, prompt ref, output schema ref, expected image ref, and
authority boundary.

All artifact refs in the request manifest (`prompt_ref`, `output_schema_ref`,
`expected_image_ref`, `response_ref`, and `artifact_manifest_ref`) must be
relative refs contained by the provider request directory. A provider run must
reject absolute artifact refs and parent-directory escape refs before invoking
Codex or consuming any response.

When a workflow needs a source image, the source image must be copied into the
provider request directory and referenced through a contained relative
`inputs.source_image_ref`. Absolute refs and parent-directory escapes are not
admitted. The request must record `inputs.source_image_sha256`.

### N2D-IMG2-021 - Provider Artifact Manifest

Every admitted provider image artifact is recorded as:

```yaml
manifest_kind: "nimi.nimi2d.codex-image2.artifact"
schema_version: 1
```

The artifact manifest records producer family, model hint, actual selected
model only when known, execution surface, request/prompt refs, PNG facts,
decoded pixel hash, and pixel-identity evidence.

`model_hint` is not an actual producer fact. If a provider run supplies a
concrete model selection such as `--model`, that value must be recorded as
selected model evidence separately from the hint. Unknown model selection must
remain unknown.

Producer admission requires decoded pixel identity evidence. Artifacts without
pixel identity evidence are recorded-only trace evidence and must not be counted
as admitted producer evidence for formal Nimi2D admission.

### N2D-IMG2-022 - Codex CLI Execution

Automation must call Codex through the provider command surface, not by
session-local manual commands.

Experiment scripts must not call `@openai/codex-sdk` or any other direct SDK
path as a parallel live execution route. Repair prompt construction may remain
as a dry planning helper, but live execution must flow through the provider
command surface.

The provider may call:

```text
codex exec --output-schema <schema> -o <response> -
```

The provider response must identify the generated PNG path, and that path must
match the request manifest `artifacts.expected_image_ref` after path
resolution. `evidence_image_path` may point to separate official output
evidence, but `image_path` is the provider-owned persisted artifact path.

The response file must conform to the provider output schema even when supplied
through `--response-file` for local evidence replay. Invalid response status,
missing summary, malformed image path fields, or malformed failure reason must
fail closed before artifact registration.

If Codex cannot generate or persist the image at the expected path, it must
return failure instead of a guessed path.

## 4. Admission Boundary

### N2D-IMG2-030 - Raw Plus Repaired Source-To-Layer Admission

Successful provider output does not imply Nimi2D package admission.

Codex Image2 source-to-layer results may be reported only as diagnostic
evidence under the `raw_plus_repaired_evidence` model. That model requires:

- admitted producer evidence with decoded pixel identity for the raw provider
  artifact
- immutable raw artifact refs and content hashes
- deterministic repair/normalization artifacts with input and output hashes
- upstream raw Image2 atlas quality recorded as diagnostic evidence
- deterministic normalization pass
- shared avatar registration pass: deterministic repair must reject atlas cells
  that were independently centered or scaled instead of sharing one avatar
  registration frame, and must reject oversized facial feature cells that carry
  non-feature regions instead of isolated eyes/brows or mouth geometry
- transparent atlas conversion pass
- atlas quality gate pass on the repaired layer source
- image-input workflow bench pass, including layer input validation for
  `manifest_kind: "nimi.nimi2d.layer-input"`

The raw provider artifact must never be treated as a raw package input.
Package manifest validation, Generation Bench, reference-player proof, and any
Avatar runtime proof remain separate downstream gates.

`raw_provider_atlas_admission` may be reported as a strict diagnostic gate for
raw-only prompt quality. It is not a live provider distribution gate, because AI
image generation is not expected to produce contract-ready atlas pixels without
repair in every case.

`repaired_workflow` success alone is not sufficient for source-to-layer
admission. It must be paired with admitted producer evidence and the downstream
quality/workflow gates listed above. Artifacts without pixel identity remain
recorded-only evidence and must not satisfy source-to-layer admission.

Missing formal admission fields in older local manifests must not be inferred
from a generic workflow verdict.

### N2D-IMG2-031 - Distribution Evidence

Provider stability is measured by distribution reports over unique source image
hashes. The report must keep atlas/source artifact uniqueness separate from
underlying source character/image uniqueness. Duplicate source samples do not
count as distribution coverage.

When provider request evidence records `inputs.source_image_sha256`, release
audits may require a minimum count of unique underlying source images. Multiple
unique atlas outputs derived from the same underlying source image must remain
visible as duplicate underlying-source coverage, not silently counted as full
source diversity.

Live Codex Image2 distribution reports must filter to `source_surface:
"codex_cli"` or an explicitly admitted live provider surface. Runs marked
`demo_fixture` must not count toward live distribution coverage.

The diagnostic provider distribution gate for this research path is
`source_to_layer_pipeline`. It counts unique live provider samples that pass
admitted producer evidence, deterministic repair, atlas quality, and layer-input
workflow gates. Diagnostic reports may still request `raw_provider_atlas` to
measure raw prompt quality.

Distribution reports may additionally require layer-input full-chain package
proof for release audits. That stricter gate is separate from source-to-layer
admission: package validation, visual proof, reference-player proof, and Avatar
runtime readiness must not be silently folded into provider admission semantics.

Distribution pass does not replace case-level package, Generation Bench,
reference-player proof, or Avatar-owned runtime gates.

## 5. Validation Floor

Provider closure is valid only if:

- product-facing workflow families and the diagnostic atlas workflow can produce
  provider request plans
- provider run automation exposes the exact Codex CLI command and fails closed
  without a response or image file
- provider artifact registration inspects real PNG bytes
- pixel comparison works on decoded RGBA pixels
- diagnostic atlas workflow still reaches layer-input and bench gates before
  success
- documentation and AGENTS.md tell AI agents to use provider commands instead
  of manual session prompts
- live provider invariant checks reject Nimi2D Image2 authority or
  implementation paths that bind live generation to direct image API keys or
  non-Codex CLI adapters
- the local demo suite can exercise product-facing workflows and the diagnostic
  atlas workflow, and fail closed on insufficient unique source hashes
- distribution reports can fail closed on insufficient unique underlying source
  image hashes when that strict release-audit gate is requested
- distribution reports can fail closed when layer-input full-chain package proof
  is missing or failing and that strict release-audit gate is requested

---

<!-- source: .nimi/spec/nimi2d/kernel/generation-bench-contract.md -->

# Nimi2D Generation Bench Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Generation Bench authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Base body contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Wardrobe and slot contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Capability tier contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Package manifest contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> **Tables**:
> - [Generation Bench gates](tables/generation-bench-gates.yaml)
> - [Generation Bench corpus schema](tables/generation-bench-corpus.schema.yaml)
> - [Generation Bench result schema](tables/generation-bench-result.schema.yaml)

## 0. Purpose

Generation Bench tests whether Nimi2D can reliably generate an admissible
package from already-conformant layer input.

It is the go/no-go gate for making Nimi2D the default generated avatar asset
layer. It is not an upstream segmentation or occlusion benchmark, and it is not
the Avatar Live Action Bench.

## 1. Bench Boundary

### N2D-BENCH-001 - Input Is Layer Input

Generation Bench input must be contract-conformant
`manifest_kind: "nimi.nimi2d.layer-input"` data.

Bench runs must not accept raw images, prompts, URLs, PSDs, editor documents,
or single unlayered avatar images.

### N2D-BENCH-002 - Upstream Layer Generation Is Out Of Scope

Generation Bench does not measure Codex Image2 provider quality, segmentation,
occlusion inpainting, source image choice, identity preservation model quality,
or content classification quality.

Those may be measured by upstream product benches. Nimi2D Generation Bench only
records their evidence refs and failure attribution when input evidence is
missing or invalid.

### N2D-BENCH-003 - Production Live Action Bench Is Separate

Production Live Action Bench validates Avatar backend value ceiling for runtime
multi-stream composition. It is not a Generation Bench gate and cannot prove
the default generated Nimi2D asset thesis.

Generation Bench may record Live Action references as non-gating related
evidence only after Avatar authority admits that bench.

Nimi2D may run a reference package-player proof matrix or deterministic
live-action stress harness to validate package readability, renderability, and
basic channel exercise. That evidence is Nimi2D package proof evidence only; it
does not replace Avatar-owned production Live Action Bench or Runtime
projection evidence.

## 2. Decision Semantics

### N2D-BENCH-010 - Go/No-Go Gate

Generation Bench returns one decision:

- `go`
- `conditional_go`
- `no_go`

`go` requires all hard gates and all quality gates to pass on the certified-good
tier-1 corpus.

`conditional_go` may be used only when hard gates pass and a recorded
acceptance waiver names exact failed quality gates, owner, and re-run deadline.

`no_go` means Nimi2D must not be claimed as the default generated avatar asset
layer.

### N2D-BENCH-011 - Failure Consequence

If Generation Bench returns `no_go`, Nimi2D may still continue as:

- hand-authored or semi-automatic package format
- research generator target
- Avatar backend runtime target after separate proof

It must not be positioned as the default automatic PersonaCharacter skin generation
layer until Generation Bench passes.

## 3. Gates

### N2D-BENCH-020 - Gate Classes Are Separate

Generation Bench has three gate classes:

- hard gates
- quality gates
- tracking metrics

Hard gates are binary and block success. Quality gates are numeric thresholds
for the certified-good tier-1 corpus. Tracking metrics are recorded but do not
decide go/no-go unless a separate admitted contract promotes them.

### N2D-BENCH-021 - Gate Table Is Closed

`tables/generation-bench-gates.yaml` is the closed gate source.

Unknown gates or metrics must not be counted as closure.

### N2D-BENCH-022 - Manual Correction Minutes Are Tracking

Manual correction minutes are tracking only. They cannot be used as a quality
gate until a separate correction protocol defines who may edit, what counts as
correction, and how corrections are replayed.

## 4. Corpus Protocol

### N2D-BENCH-030 - Corpus Manifest Is Mandatory

Every bench run must reference a corpus manifest conforming to
`tables/generation-bench-corpus.schema.yaml`.

The corpus manifest must include:

- corpus id and version
- immutable case ids
- content hashes
- case split
- expected valid/invalid outcome
- layer input manifest refs
- package target tier
- source evidence refs

### N2D-BENCH-031 - Certified-Good Tier-1 Split

The certified-good tier-1 split is the quality gate split.

It must represent the real PersonaCharacter layer input distribution that Nimi2D aims
to serve, after upstream layer input has already satisfied the layer input
contract.

### N2D-BENCH-032 - Invalid Fixture Split

Invalid fixture split cases must fail with exact typed reject codes. They do
not contribute to quality rates, but they do close hard fail-closed behavior.

### N2D-BENCH-033 - Anti-Cherry-Pick

Bench reports must include every case in the selected corpus manifest.

A bench run must fail audit if it:

- omits failed cases
- changes corpus rows after execution
- reports only successful examples
- reclassifies invalid fixtures as out of scope
- changes expected outcomes without corpus version bump
- uses unrecorded manual corrections
- changes generator settings without recording configuration

### N2D-BENCH-034 - Certified Corpus Certification

`validate-bench-corpus` only proves that a corpus manifest is structurally
usable by the bench runner. Release-gate use requires an additional certified
corpus report.

The certified corpus report must fail closed unless the corpus has:

- enough certified-good tier-1 cases for the release gate
- enough invalid contract cases to preserve fail-closed coverage
- unique content hashes across certified-good tier-1 cases
- certified-good source evidence refs that are not fixture, demo, generated, or
  synthetic refs
- certified-good distribution tags covering representative PersonaCharacter shape,
  expression stress, wardrobe stress, and anchor stress

Certification does not replace Generation Bench execution. It only decides
whether a corpus is eligible to be used as release-gate input.

### N2D-BENCH-035 - Release Candidate Audit Aggregates Evidence

A release-candidate audit may aggregate:

- Codex Image2/provider distribution report
- certified corpus report
- Generation Bench result
- Runtime Proof Matrix result
- manual correction report when one exists
- product review report when one exists

The audit must keep T1-T4 technical gates separate:

- T1 provider/source-to-layer distribution
- T2 corpus certification
- T3 Generation Bench
- T4 package visual proof plus reference action response proof

The audit must fail closed when any T1-T4 technical gate fails. If T1-T4 pass
but manual correction metrics, provider reliability metrics, or product review
evidence are not recorded, the audit may return a candidate-pass/product-blocked
decision. That decision is not public product release approval and does not
close production Avatar embodiment readiness.

### N2D-BENCH-036 - Product Readiness Evidence Is Explicit

Manual correction and product review evidence must be explicit reports. Nimi2D
may validate and aggregate those reports, but it must not infer or fabricate
them from technical pass results.

Manual correction reports must record:

- release-candidate measurement scope
- per-case correction minutes
- measured case count
- p50, p90, and max correction minutes
- whether prompt repair was required per case when known

Manual correction remains tracking evidence unless a later authority promotes a
threshold into a gate.

Product review reports must record:

- release-candidate review scope
- reviewer id and role
- review timestamp
- identity preservation result
- layer alignment result
- expression readability result
- wardrobe readiness result
- product fit result
- final pass/fail decision

Missing, malformed, or failing product readiness evidence must keep the
release-candidate audit in product-blocked state even when T1-T4 technical gates
pass.

Product-readiness evidence may be validated independently before it is supplied
to a release-candidate audit. Independent validation must use the same
manual-correction and product-review semantics as the aggregate audit.

### N2D-BENCH-037 - Review Packets Are Evidence Collection Aids

Nimi2D may generate local release review packets that copy certified-good layer
assets, render a static review surface, optionally copy source-reference
thumbnails from a release-review sidecar, and provide pending manual correction
and product review templates.

A review packet does not close manual correction, product review, public
release, or production Avatar readiness. It only packages the candidate evidence
so humans can record the explicit reports required by
`N2D-BENCH-036`.

Review packets may be validated independently. Packet validation must check that
the packet manifest, static HTML surface, pending templates, and referenced
layer assets are present and self-contained. If a packet includes
source-reference thumbnails, those copied refs must also be present and
self-contained. Source-reference sidecars are review-packet operational
evidence only and must not add raw image refs to certified corpus or layer-input
admission contracts. Packet validation must not treat filled product evidence
reports as part of packet validation; those reports are validated by the
product-readiness evidence gate.

## 5. Result Protocol

### N2D-BENCH-040 - Deterministic Result Schema

Every bench run must emit a result conforming to
`tables/generation-bench-result.schema.yaml`.

The result must include:

- run id
- corpus digest
- generator version
- validator version
- deterministic seed/config
- all per-case results
- hard gate outcomes
- quality metric values
- tracking metric values
- failure attribution
- final decision

### N2D-BENCH-041 - No Partial Success

Partial, skipped, unverified, fixture-only, or hand-picked results must not be
reported as bench success.

If a case cannot be evaluated, it counts as failure unless the corpus manifest
marks it as explicitly non-gating tracking input.

### N2D-BENCH-042 - Failure Attribution

Failures must be attributed to one of:

- `nimi2d_layer_input_admission`
- `nimi2d_anchor_slot_solving`
- `nimi2d_base_body_topology`
- `nimi2d_wardrobe_binding`
- `nimi2d_capability_validation`
- `nimi2d_package_manifest`
- `upstream_layer_generation`
- `upstream_content_admission`
- `test_harness`
- `unknown`

Attributing a failure to upstream does not make it a Nimi2D success. It records
the boundary for triage.

## 6. Validation Floor

Generation Bench closure is valid only if:

- input is conformant layer input, not raw images
- hard gates all pass
- quality gates pass on certified-good tier-1 corpus
- invalid fixtures produce exact typed rejects
- no adult v1 fixtures or corpora are loaded
- no true viseme is scored as tier-1
- occlusion pass rate is not reported as Nimi2D-owned
- every selected case appears in the result
- deterministic replay metadata is present
- final decision follows `tables/generation-bench-gates.yaml`

---

<!-- source: .nimi/spec/nimi2d/kernel/index.md -->

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

### [`authority-boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

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

### [`codex-image2-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)

Nimi2D Codex Image2 provider authority:

- Codex Image2 is the standard first-party Nimi2D image resource provider
- provider output is upstream evidence, not formal package input
- product-facing workflow families are prompt to source image, image plus
  prompt to improved source image, and companion asset image; image to layer
  atlas remains diagnostic/research until separately admitted
- provider requests and artifacts use closed Nimi2D manifest kinds
- automation must route through provider commands and Codex CLI response
  contracts instead of manual session-only prompts

### [`layer-input-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

Nimi2D layer input authority:

- manifest identity for contract-conformant layer input
- relative asset refs, sha256, RGBA, color space, alpha mode, and pixel bounds
- top-left pixel coordinate space and draw order
- semantic layer labels, anchor hints, and slot hints
- upstream evidence refs for layer generation, occlusion completion, identity
  preservation, and content admission
- fail-closed typed rejection for invalid, incomplete, guessed, repaired, raw
  image, or out-of-root input

### [`renderability-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)

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

### [`base-body-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

Nimi2D base body authority:

- base body is the sole owner of main skeleton, anchors, slots, deformation
  topology, morphology profile, and action topology references
- base body is non-renderable without an outfit
- base body is anatomically-informed and detail-neutral
- topology is versioned and reused across all outfits
- base body must not define Avatar runtime execution

### [`wardrobe-slot-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

Nimi2D wardrobe and slot authority:

- wardrobe, outfit, accessory, prop, and scene assets bind to base-body slots
- wardrobe inherits base-body skeleton deformation and cannot own the main rig
- local attachment rigs are allowed only for subordinate cloth, hair,
  accessory, prop, and secondary motion
- outfit switching is atomic and zero generation cost after the wardrobe asset
  exists
- slot taxonomy is closed by `tables/slot-taxonomy.yaml`

### [`capability-tier-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

Nimi2D asset capability tier authority:

- tier-0 through tier-3 are admitted
- tier-N is a reserved future deformation extension point
- default acceptable generated asset target is tier-1
- tier-1 speech is jaw/amplitude mouth support, not AEIOU true viseme
- tier claims are asset/package claims only, not runtime execution truth
- overclaimed capability fails closed

### [`package-manifest-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

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

### [`generation-bench-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)

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

- `.nimi/spec/avatar/embodiment-surface.authority.yaml`
- `config/avatar-backend-capability-profile.schema.yaml`
- `config/avatar-nimi2d-backend-capability-profile.schema.yaml`
- `config/avatar-nimi2d-live-action-routes.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/desktop/ai-consumption.authority.yaml`

## Derived Views

No Nimi2D derived view is currently admitted as independent authority.

---

<!-- source: .nimi/spec/nimi2d/kernel/layer-input-contract.md -->

# Nimi2D Layer Input Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D layer input authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parent**: [Authority boundary contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
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

The active v1 admitted input is a manifest with
`manifest_kind: "nimi.nimi2d.layer-input"` and `schema_version: 1`, validated
against `tables/layer-input.schema.yaml`.

### N2D-INPUT-002 - Upstream Layer Generation Is External Evidence

Layer creation methods are outside layer-input admission. Codex Image2 provider
workflows may be Nimi2D-owned upstream image resource production, while manual
cutting, segmentation models, occlusion inpainting, identity preservation, and
content admission may produce evidence refs from other upstream systems.

Nimi2D must record source evidence refs and validate their required presence.
It must not reinterpret those refs as proof that Nimi2D performed upstream
segmentation, occlusion inpainting, or safety classification.

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
topology are owned by the base-body, wardrobe/slot, and package-manifest
contracts.

Allowed values:

- `character_skin`
- `wardrobe_item`
- `accessory_item`
- `prop_item`
- `scene_item`

`character_skin` is the default path for generating a complete Nimi2D character
asset with base body and default outfit downstream. `wardrobe_item` and
`accessory_item` are additional asset-generation inputs for an existing
admitted topology.

## 3. Coordinate And Asset Rules

### N2D-INPUT-020 - Coordinate Space

All coordinates are canvas pixel coordinates:

- origin: `top_left`
- unit: `px`
- axis: `x_right_y_down`
- values: integer pixels
- canvas bounds: `[0, 0, width, height]`

Layer placement and anchor/slot hints must be within the canvas unless a
separate admitted contract explicitly admits overflow. Current v1 layer input
admits no overflow.

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

Unknown labels are invalid. More detailed topology names belong to base-body,
wardrobe/slot, and package-manifest authority and must not be smuggled into
arbitrary strings.

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

Current v1 admits these slot hint kinds:

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

The wardrobe/slot contract owns final slot topology. Layer input slot hints
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

Current v1 admits fixture families only as validation targets, not as package
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

---

<!-- source: .nimi/spec/nimi2d/kernel/package-manifest-contract.md -->

# Nimi2D Package Manifest Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D package manifest authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Capability tier contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Base body contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Wardrobe and slot contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Renderability governance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)
> - [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
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

---

<!-- source: .nimi/spec/nimi2d/kernel/renderability-governance-contract.md -->

# Nimi2D Renderability Governance Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D renderability/governance authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parent**: [Authority boundary contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> **Input dependency**: [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)

## 0. Purpose

This contract makes invalid visual states unrepresentable inside Nimi2D package
contracts. The goal is not to rely on runtime policy checks for states that the
asset protocol should never admit.

Nimi2D is not a content classifier and does not own platform adult-content
policy. It owns only the package-level renderability and asset-governance
invariants needed for Nimi2D packages.

## 1. Renderability State Model

### N2D-GOV-001 - No Outfit, No Render

A character Nimi2D package is renderable only when an outfit is bound.

Valid visible character states:

- `renderable_with_default_outfit`
- `renderable_with_selected_outfit`

Valid non-character visual states:

- `renderable_scene`
- `renderable_prop`

Valid non-visible or diagnostic states:

- `admission_rejected`
- `non_renderable_incomplete`
- `redacted_non_pixel_topology`
- `no_render`

There is no `renderable_base_body` state.

### N2D-GOV-002 - Base Body Is Never A Display Fallback

The base body must not be used as a visible fallback in any path:

- renderer
- debug viewer
- package inspector
- package validator
- bench harness
- thumbnail generator
- export command
- import preview
- error surface
- loading surface
- degraded surface
- CLI report
- fixture viewer
- Avatar adapter handoff

If no outfit is available, the only valid outcomes are:

- keep rendering the previously bound outfit if it remains valid
- bind a valid default outfit before first visible frame
- show a redacted non-pixel topology diagram for debug-only evidence
- show nothing
- reject admission

Base-body pixels are not a fallback.

### N2D-GOV-003 - Outfit Switching Is Atomic

Outfit switching must be atomic from the package contract perspective. The old
outfit remains active until the new outfit is validated, bound, and ready for
display.

There must be no intermediate frame, thumbnail, exported artifact, debug view,
or bench frame where the base body is visible without an outfit.

If the new outfit fails validation or binding, the operation fails closed to the
previous valid outfit or `no_render`.

### N2D-GOV-004 - Debug Does Not Bypass Renderability

Debug and bench tooling must obey the same renderability invariants as user
surfaces.

Debug may display a redacted topology diagram only if it is not composed from
base-body pixels, outfit-hidden body pixels, or adult outfit pixels. The diagram
is evidence of topology structure, not a render of the character.

## 2. Base Body Governance Floor

### N2D-GOV-010 - Base Body Is Anatomically-Informed And Detail-Neutral

The base body may carry morphology needed for outfit fit, slot geometry, and
motion plausibility:

- body proportions
- shoulder width
- waist/hip relation
- chest volume, position, and silhouette
- limb length and joint placement
- head/face placement needed for anchors

The base body must not carry pure display sexual details that do not improve
outfit fit or slot geometry:

- nipples
- nipple color/texture
- genital detail
- pubic detail
- erotic surface markings

The governing test is:

Does this information materially improve outfit fit, slot geometry, or motion
topology?

If yes, it may belong in base body morphology. If no, it must not be encoded in
the base body.

### N2D-GOV-011 - Base Body Detail Neutrality Is Not A Quality Sacrifice

Morphology and display detail are separate dimensions. Nimi2D must not remove
morphology needed for good outfit fit merely to satisfy governance, and it must
not preserve display sexual detail merely because morphology is needed.

The base body target is complete morphology with zero display sexual detail.

## 3. Content Admission Boundary

### N2D-GOV-020 - Upstream Content Evidence Is Required

Layer input already requires `content_admission_ref`. Nimi2D package admission
must preserve that evidence chain and fail closed when required evidence is
missing.

Nimi2D validates evidence presence and package-state implications. It does not
classify age, identity, or sexual content from RGBA pixels.

### N2D-GOV-021 - Underage Body Content Is A Hard Reject

Any input, package, outfit, fixture, corpus item, or generated artifact that is
identified by upstream content-admission evidence as involving an
underage-looking character in body-content generation scope is prohibited.

Nimi2D must reject this state. It must not downgrade, hide, crop, blur, outfit,
or reclassify it into an accepted package.

If upstream evidence is missing, ambiguous, or says review is required, Nimi2D
must fail closed.

### N2D-GOV-022 - Nimi2D Does Not Own Age Or Identity Classification

Nimi2D must not infer age or identity from pixels, filename, prompt text,
layer labels, or outfit names.

The upstream content-admission system owns those decisions. Nimi2D owns only the
requirement that accepted packages carry admissible evidence and that prohibited
states cannot become renderable package success.

## 4. Adult Capability Posture

### N2D-GOV-030 - Adult Outfit Capability Is Reserved, Not Implemented

Adult-oriented outfit capability is structurally reserved but not implemented in
v1.

v1 must not:

- distribute adult outfit assets
- include adult fixtures
- include adult corpus rows
- test adult rendering as success
- expose adult outfit toggles
- define adult package admission
- define adult marketplace or regional distribution policy
- treat adult support as a package capability

### N2D-GOV-031 - Adult Content Is Never A Base Body Mode

If adult-oriented capability is ever admitted by a future contract, it must be a
self-contained outfit capability bound to the same base-body topology.

It must not be modeled as:

- removing outfit opacity to reveal base body
- switching to a naked base-body mode
- exporting base body pixels
- using base body as adult display content

SFW outfit and any future adult outfit would both be display layers bound to
topology. The base body remains detail-neutral.

### N2D-GOV-032 - Adult Closure Requires Separate Admission

Any future adult-oriented capability requires a separate authority admission
that defines content admission, distribution, region, age-gate, fixture,
corpus, UI, and package capability semantics.

Until that admission exists, adult-oriented capability is unavailable.

## 5. Product And Runtime Non-Ownership

### N2D-GOV-040 - Realm Persona Studio Is Not Package Truth

Realm Persona Studio or any product UI may help produce upstream layer input or
display Nimi2D validation diagnostics. It must not become the owner of Nimi2D
package truth.

### N2D-GOV-041 - Avatar Runtime Remains Separate

Nimi2D renderability invariants define which package states can be admitted.
They do not define Avatar runtime rendering, runtime live action composition,
production PixiJS carrier behavior, backend scheduling, hit testing, or lipsync
execution.

Avatar backend contracts must consume these package invariants before any
Avatar Nimi2D runtime backend can display a package. Nimi2D reference renderers
and proof helpers may exercise admitted package states for package readiness
only.

## 6. Validation Floor

Governance validation is valid only if:

- base-body-only render paths are rejected or unreachable
- package admission requires a default outfit for character packages
- outfit switching cannot emit a naked intermediate frame
- debug/bench/thumbnail/export/error/loading/degraded paths do not display base
  body pixels without outfit
- adult-oriented assets are absent from v1 fixtures, corpora, package examples,
  and distribution
- upstream content-admission evidence is required and missing/ambiguous
  evidence fails closed
- no package success state can claim adult capability in v1

---

<!-- source: .nimi/spec/nimi2d/kernel/wardrobe-slot-contract.md -->

# Nimi2D Wardrobe And Slot Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D wardrobe/slot authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Base body contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
> - [Renderability governance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/generation-supply.authority.yaml)
> - [Layer input contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
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

---
