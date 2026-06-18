# Nimi2D Capability Tier Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 4 capability tier authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Base body contract](base-body-contract.md)
> - [Wardrobe and slot contract](wardrobe-slot-contract.md)
> - [Renderability governance contract](renderability-governance-contract.md)
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

Wave 4 admits:

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
