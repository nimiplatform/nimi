# Skills

The Nimi Coding package admits four **declared skills**. Each
skill is a typed surface that an admitted external AI host can
fulfill. Skills are the formal contract through which the host
performs Nimi-Coding-governed work.

## The Four Skills

| Skill | Required | Purpose |
| --- | --- | --- |
| `spec_reconstruction` | yes | Reconstruct project canonical tree into `.nimi/spec/**` |
| `doc_spec_audit` | yes | Compare human-authored docs against `.nimi/spec/**` |
| `audit_sweep` | no | Perform full-coverage audit sweep and emit a frozen findings ledger |
| `high_risk_execution` | no | Packetized execution after project truth matures |

## `spec_reconstruction` (required)

The first skill any new project runs. Converts whatever a project
currently has — mixed code, scattered docs, ADRs, README files —
into a canonical authority tree under `.nimi/spec/**`.

| Input | Output |
| --- | --- |
| Mixed inputs (code, docs, structure, human notes) | Canonical tree under `.nimi/spec/**` plus `.nimi/spec/_meta/spec-generation-audit.yaml` |

| Property | Value |
| --- | --- |
| Trigger | `bootstrap_only` |
| Output rule | "every generated canonical file requires explicit source basis and unresolved gap tracking" |
| Hard constraint | "no human-friendly parallel truth" |

Reconstruction does not invent. Every generated rule has either
explicit source basis or explicit unresolved-gap tracking.

## `doc_spec_audit` (required)

After reconstruction, this skill checks human-authored docs
against the canonical spec tree. Drift detection.

| Input | Output |
| --- | --- |
| Human docs + canonical spec tree | Drift findings ledger |

A doc that drifts from spec is a finding. A doc that re-states
spec is OK. A doc that contradicts spec is a critical finding.

## `audit_sweep` (optional)

Full-coverage audit sweep over the project. Emits a frozen
findings ledger.

| Input | Output |
| --- | --- |
| Project corpus | Findings ledger (frozen) |

The "frozen" property is what makes the ledger usable as evidence.
A sweep result is recorded; it does not get edited later.

## `high_risk_execution` (optional)

Packetized execution after project truth matures. This is the
skill the methodology was actually designed for: high-risk work
that needs the four-closure framework.

| Input | Output |
| --- | --- |
| Frozen execution packet | Worker output + evidence |

A `high_risk_execution` skill run consumes a frozen packet and
produces output that the closeout step can verify.

| Property | Value |
| --- | --- |
| Trigger | After `.nimi/spec/**` is canonical-tree-ready |
| Owner | Manager (admits the run) |
| Auditor | Independent (per role separation) |

## How Skills Are Dispatched

The package's `nimicoding handoff` command emits an authoritative
machine-readable handoff payload.

| Field | Value |
| --- | --- |
| `--skill <skill-id>` | Required |
| `--json` | Authoritative payload |
| `--prompt` | Optional human-readable host briefing |

The host consumes the JSON, runs the skill, returns a result.
The package's `nimicoding closeout` admits the result under
typed contract validation.

## Skill Result Contracts

Each skill admits results under a typed contract.

| Skill | Result contract |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |
| `high_risk_execution` | `.nimi/contracts/high-risk-execution-result.yaml` |

A result that does not conform to its contract fails closed
during admission. There is no soft acceptance.

## Reader Scenario: A New Project Runs `spec_reconstruction`

A team adopting Nimi Coding has a project with mixed inputs and
no canonical spec yet.

1. **Run `nimicoding start`.** Bootstrap admits.
2. **Project chooses host.** Adapter overlay selected (e.g.,
   Codex, Claude, oh-my-codex).
3. **Run `nimicoding handoff --skill spec_reconstruction --json`.**
   Package emits handoff payload.
4. **Host consumes payload.** Reconstructs canonical tree under
   admitted contract.
5. **Host returns result.** Package admits via `nimicoding
   closeout`.
6. **Validation.** Every generated rule has source basis or
   gap-tracking; otherwise reject.
7. **Canonical tree ready.** Project can now adopt the
   methodology for high-risk work.

The reconstruction is **vendor-neutral** — it works with any
admitted host that satisfies the host-class capabilities.

## Reader Scenario: An `audit_sweep` Returns A Findings Ledger

A team wants a comprehensive audit of their project under the
methodology.

1. **Run `nimicoding handoff --skill audit_sweep --json`.**
2. **Host runs the sweep.** Reads the project under admitted
   read scope; emits typed findings.
3. **Findings ledger frozen.** Result is recorded; cannot be
   edited later.
4. **Manager reviews.** Typed findings inform the next
   wave-admission decisions.

The ledger is evidence. Future audits can compare against it.

## Reader Scenario: A `high_risk_execution` Run

A team wants to run substantive AI-coding work under the
methodology.

1. **Manager admits a packet.** Frozen with all required
   fields.
2. **Pre-implementation audit.** If `authority_convergence`
   gate fires, run the audit; record PASS.
3. **Run `nimicoding handoff --skill high_risk_execution
   --json`.** Hands off the packet to the host.
4. **Host executes.** Bound by the packet; produces output.
5. **Result returned.** Package validates result contract.
6. **Post-implementation judgement.** Independent loop reviews;
   record judgement.
7. **Closeout.** Four-closure dimensions evaluated.
8. **Wave closes.** Or returns to revision.

This is the full execution flow. Each step is admitted; nothing
is implicit.

## What Skills Do Not Do

| Skill operation | Forbidden |
| --- | --- |
| Run AI inference inside the package | Yes — host owns runtime |
| Mutate project canonical truth without admission | Yes |
| Generate output without source basis | Yes (`spec_reconstruction` requires source basis or gap tracking) |
| Continue if host capability check fails | Yes (fail closed) |

## Source Basis

- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skill-manifest.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
