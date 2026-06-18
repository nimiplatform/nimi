# Nimi2D Renderability Governance Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 2 renderability/governance authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parent**: [Authority boundary contract](authority-boundary-contract.md)
> **Input dependency**: [Layer input contract](layer-input-contract.md)

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
