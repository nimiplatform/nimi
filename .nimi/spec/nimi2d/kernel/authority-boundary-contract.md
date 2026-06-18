# Nimi2D Authority Boundary Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 0 authority boundary
> **Owner**: Nimi2D generated asset/package contract surface
> **Sibling authority**: `.nimi/spec/avatar/**`, `.nimi/spec/runtime/**`,
> `.nimi/spec/desktop/**`, `.nimi/spec/platform/**`

## 0. Purpose

This contract admits the Nimi2D authority boundary before detailed package,
input, wardrobe, governance, capability, and bench contracts are added.

Nimi2D exists to make AI-generated 2D avatar packages reliable enough for Nimi
agents. It is not a general creator-format replacement for Live2D, VRM, Rive,
or PixiJS.

## 1. Authority Boundary

### N2D-AUTH-001 - Nimi2D Owns Asset Package Truth

Nimi2D owns the contracts for generated Nimi2D asset packages:

- layer input admission
- typed layer reject reasons
- base body topology
- wardrobe, outfit, accessory, and slot topology
- asset capability tiers
- package manifest
- package admission validation
- Generation Bench corpus, replay, metrics, and gates

### N2D-AUTH-002 - Nimi2D Starts From Layer Input

Nimi2D starts from a future layer input contract. It must not accept a raw source
avatar image as its package generation input.

Upstream systems may produce layer input through manual cutting, segmentation,
occlusion inpainting, identity preservation, or future models. Nimi2D treats
those outputs as external source evidence only.

### N2D-AUTH-003 - Avatar Owns Runtime Embodiment

Runtime embodiment execution for Nimi2D packages belongs under Avatar backend
authority, not under `.nimi/spec/nimi2d/**`.

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

Nimi2D may define asset channels and package capability claims, but it must not
define the runtime composer or performance stream that executes those channels.

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

The planned `@nimiplatform/nimi2d` package may implement validators and
generation scripts. It may also expose shared implementation helpers (for
example a renderer-agnostic render plan, composer state machine, or bounded
bench scorer) only when those helpers are admitted and governed by Avatar
authority. Package membership does not make package-local spec truth
authoritative.

Code location is not semantic ownership. A helper under
`@nimiplatform/nimi2d/runtime` remains Avatar-owned runtime behavior when it is
consumed through `.nimi/spec/avatar/**` contracts. It must not create a second
runtime ontology, public APML syntax, or package-local backend authority.

Any future package-local spec root must be admitted through
`.nimi/spec/platform/kernel/package-authority-admission-contract.md` and
`.nimi/spec/platform/kernel/tables/package-authority-admissions.yaml`.

## 2. Non-Goals

Nimi2D does not own:

- raw image selection, canonical skin generation, segmentation, occlusion
  inpainting, identity preservation, or content classification from pixels
- Realm Persona Studio product workflow or editor UX
- Avatar runtime backend execution
- PixiJS renderer API design
- Live2D/VRM compatibility shims
- external creator-tool interchange compatibility
- raw APML syntax or prompt formatting
- Adult-content distribution in v1

Nimi2D may remain open source as part of Nimi. External compatibility is not a
Wave 0 design constraint.

## 3. Initial Decisions

### N2D-AUTH-007 - First-Party Package Direction

The implementation direction is an independent package,
`@nimiplatform/nimi2d`, primarily serving Nimi first-party flows.

Package creation is not admitted by this contract. It is blocked until the
asset authority contracts and Generation Bench contract are admitted.

### N2D-AUTH-008 - Default Asset Target

The initial acceptable generated asset target is tier-1, to be defined by a
future capability-tier contract.

Wave 0 only records this direction. It does not admit tier semantics.

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

- defines a runtime live action stream, composer, scheduler, or blend tree under
  `.nimi/spec/nimi2d/**`
- consumes raw APML or defines public APML syntax
- accepts a raw image as Nimi2D package input
- guesses, repairs, or silently downgrades invalid layer input instead of typed
  rejection
- creates a base-body-only render, preview, thumbnail, export, error fallback,
  debug path, or package artifact as a visible success state
- treats adult outfit support as implemented or distributed in v1
- claims tier-1 true viseme support
- infers package authority from `@nimiplatform/nimi2d` package membership
- treats `@nimiplatform/nimi2d/runtime` helper code as Nimi2D package authority
  instead of Avatar-owned runtime implementation
- lets Realm Persona Studio or another product surface become Nimi2D package
  truth

## 5. Admission Order

Wave 0 admits only this authority boundary.

Later waves must admit contracts in this order unless a new preflight records a
different authority decision:

1. Layer input contract and reject taxonomy.
2. Renderability and content-governance invariants.
3. Base body, wardrobe, and slot topology.
4. Asset capability tiers and package manifest.
5. Generation Bench contract and corpus protocol.
6. Package skeleton and CLI validators.
7. Generation Bench implementation.
8. Avatar Nimi2D backend contract under `.nimi/spec/avatar/**`.
9. Live Action Bench through Avatar acceptance.

## 6. Wave 0 Verification Floor

Wave 0 is valid only if:

- `.nimi/spec/INDEX.md` lists `nimi2d` as an active domain.
- `.nimi/spec/nimi2d/index.md` imports the Nimi2D kernel.
- `.nimi/spec/nimi2d/kernel/index.md` references this contract.
- No `.nimi/spec/nimi2d/**` file defines Avatar runtime backend execution.
- No `.nimi/spec/nimi2d/**` file defines raw image intake.
- No `.nimi/spec/nimi2d/**` file defines raw APML syntax.
