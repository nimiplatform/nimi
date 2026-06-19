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

Any future package-local spec root must be admitted through
`.nimi/spec/platform/kernel/package-authority-admission-contract.md` and
`.nimi/spec/platform/kernel/tables/package-authority-admissions.yaml`.

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

- `.nimi/spec/INDEX.md` lists `nimi2d` as an active domain.
- `.nimi/spec/nimi2d/index.md` imports the Nimi2D kernel.
- `.nimi/spec/nimi2d/kernel/index.md` references this contract.
- `.nimi/spec/nimi2d/kernel/index.md` references the Codex Image2 provider
  contract when Image2 is used for Nimi2D image resources.
- No `.nimi/spec/nimi2d/**` file defines production Avatar runtime backend
  execution or Runtime projection truth.
- No `.nimi/spec/nimi2d/**` file defines raw image intake.
- No `.nimi/spec/nimi2d/**` file defines raw APML syntax.
