# Schemas

Nimi consumes Nimi Coding contracts for truth reconstruction,
authority review, deterministic evidence, and spec structure. These
contracts describe what a host must produce and what a gate must verify;
they do not model host task progress.

## Spec Reconstruction Result

Path: `.nimi/contracts/spec-reconstruction-result.yaml`

| Field group | Requirement |
| --- | --- |
| Required summary | generated paths, audit reference, placement report, coverage, unresolved and inferred counts, status, summary, verification time |
| Status | `reconstructed`, `partial`, or `blocked` |
| Completion | canonical tree ready, required files valid, placement valid, audit entries complete, unresolved gaps explicit |
| Locality | local-only result; never product authority |

## Documentation Audit Result

Path: `.nimi/contracts/doc-spec-audit-result.yaml`

| Field | Requirement |
| --- | --- |
| `compared_paths` | Paths actually compared |
| `finding_count` | Number of findings produced |
| `status` | `aligned`, `drift_detected`, or `blocked` |
| `summary` | Evidence-based result summary |
| `verified_at` | Verification timestamp |

## High-Risk Admission Evidence

Path: `.nimi/contracts/high-risk-admission.schema.yaml`

Every admission names a change, disposition, timestamp, authority
review owner, summary, and source decision contract. Admission records
are local evidence: they cannot create host progress, advance host
state, or become product authority.

## Prompt Contract

Path: `.nimi/contracts/prompt.schema.yaml`

A governed handoff declares the task goal, authority reads, confirmed
state, hard constraints, required outcome, non-goals, checks, final
output format, and blocker escalation rule. The external host decides
how to execute that bounded request.

## Host Result Contract

Path: `.nimi/contracts/worker-output.schema.yaml`

The result reports findings, implementation summary, changed files,
checks that actually ran, and remaining gaps or risks. Optional blocks
carry authority impact, selected decisions, guard behavior, and
remaining blockers.

## Acceptance Contract

Path: `.nimi/contracts/acceptance.schema.yaml`

Acceptance is ordered as authority alignment, evidence sufficiency,
then disposition. Disposition is one of `complete`, `partial`, or
`deferred`; a missing required result cannot be converted into success.

## Spec Structure Contracts

| Contract | Purpose |
| --- | --- |
| `table-family.schema.yaml` | Defines admitted semantic families and forbidden workflow fields in authority tables |
| `placement-contract.schema.yaml` | Validates canonical placement |
| `projection-edge.schema.yaml` | Validates authority-to-projection edges |
| `domain-admission.schema.yaml` | Validates domain admission records |
| `tracked-output-admission.schema.yaml` | Validates tracked generated outputs |
| `surface-taxonomy.schema.yaml` | Classifies canonical and support surfaces |

## Forbidden Shortcuts

Path: `.nimi/contracts/forbidden-shortcuts.catalog.yaml`

The catalog rejects minimum-subset truth, legacy aliases, compatibility
shims, dual reads and writes, placeholder success, happy-path-only
closure, time-phased layering, app-local shadow truth, and silent owner
reopening.

## Source Basis

- [`.nimi/contracts/spec-reconstruction-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-reconstruction-result.yaml)
- [`.nimi/contracts/doc-spec-audit-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/doc-spec-audit-result.yaml)
- [`.nimi/contracts/high-risk-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/high-risk-admission.schema.yaml)
- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/table-family.schema.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
