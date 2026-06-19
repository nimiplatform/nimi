# Nimi2D Generation Bench Contract

> **Authority**: `.nimi/spec/nimi2d`
> **Status**: Active Nimi2D Wave 5 Generation Bench authority
> **Owner**: Nimi2D generated asset/package contract surface
> **Parents**:
> - [Layer input contract](layer-input-contract.md)
> - [Base body contract](base-body-contract.md)
> - [Wardrobe and slot contract](wardrobe-slot-contract.md)
> - [Capability tier contract](capability-tier-contract.md)
> - [Package manifest contract](package-manifest-contract.md)
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

It must not be positioned as the default automatic RealmPersona skin generation
layer until Generation Bench passes.

## 3. Gates

### N2D-BENCH-020 - Gate Classes Are Separate

Generation Bench has three gate classes:

- hard gates
- quality gates
- tracking metrics

Hard gates are binary and block success. Quality gates are numeric thresholds
for the certified-good tier-1 corpus. Tracking metrics are recorded but do not
decide go/no-go unless a later contract promotes them.

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

It must represent the real RealmPersona layer input distribution that Nimi2D aims
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
- certified-good distribution tags covering representative RealmPersona shape,
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
