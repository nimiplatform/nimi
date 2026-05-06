# CLI Commands

Field-level reference for the `nimicoding` CLI. For concept-level
overview see [CLI Surface](/nimicoding/cli).

## Bootstrap Commands

### `nimicoding start`

| Property | Value |
| --- | --- |
| Purpose | Bootstrap or resume project state |
| Mode | Interactive |
| Failure | Fail closed on unknown CLI options |
| Preserves | Existing truth files |
| Side effects | Creates `.nimi/**`, updates managed `AGENTS.md` / `CLAUDE.md` blocks, updates `.gitignore` |

### `nimicoding clear`

| Property | Value |
| --- | --- |
| Purpose | Remove managed AI blocks and package-owned bootstrap files |
| Preserves | `.nimi/spec/**`, `.nimi/local/**`, `.nimi/cache/**`, locally modified bootstrap files |
| Refuses | Implicit deletion of project-owned truth |

### `nimicoding doctor`

| Flag | Purpose |
| --- | --- |
| `--json` | Machine-readable output |

| Validates | What it checks |
| --- | --- |
| Bootstrap seed | `.nimi/**` files present |
| Local state | `.nimi/local/`, `.nimi/cache/` exist and ignored |
| Contract version | Bootstrap contract compatibility |
| Cross-contract refs | Manifest, handoff, runtime, installer, host-profile alignment |
| Host-adapter | Boundary truth |
| Skill result contracts | Reconstruction, doc-spec-audit, high-risk-execution result contracts |
| High-risk schemas | Packet, orchestration-state, prompt, worker-output, acceptance |
| External host posture | Compatibility contract validation |

| Exit codes | Meaning |
| --- | --- |
| 0 | Healthy |
| Non-zero | One or more named drift |

## Skill Handoff

### `nimicoding handoff --skill <skill-id> [--json] [--prompt]`

| Flag | Required | Purpose |
| --- | --- | --- |
| `--skill <skill-id>` | yes | One of `spec_reconstruction`, `doc_spec_audit`, `audit_sweep`, `high_risk_execution` |
| `--json` | no | Authoritative payload |
| `--prompt` | no | Human-readable host briefing |

| Refuses | When |
| --- | --- |
| `doc_spec_audit` handoff | Canonical tree under `.nimi/spec/` not ready |
| `high_risk_execution` handoff | Canonical tree not ready |

### `nimicoding closeout --skill <skill-id> --outcome <outcome> --verified-at <iso8601>`

| Flag | Required | Purpose |
| --- | --- | --- |
| `--skill` | yes | Which skill |
| `--outcome` | yes | `completed`, `failed`, etc. |
| `--verified-at` | yes | ISO8601 UTC timestamp |
| `--from <json>` | no | Import skill result from JSON |
| `--write-local` | no | Write payload under `.nimi/local/handoff-results/` |

| Fails closed | When |
| --- | --- |
| Outcome contradicts canonical-tree state | Yes |
| Refs escape declared local artifact roots | Yes |
| Imported summary violates declared skill result contract | Yes |

## High-Risk Execution

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

| Flag | Purpose |
| --- | --- |
| `--from <json>` | Path to high-risk decision payload |
| `--admitted-at <iso8601>` | When admitted |
| `--write-spec` | Write tracked semantic truth |

| Accepts only | `nimicoding.high-risk-decision.v1` payloads with `decisionStatus: manager_decision_recorded` |

### `nimicoding ingest-high-risk-execution --from <json>`

| Accepts only | `high_risk_execution` closeout artifacts with `outcome: completed` and `summary.status: candidate_ready` |
| Validates | Referenced packet, orchestration-state, prompt, worker-output |
| Output | Local-only ingest payload |

### `nimicoding review-high-risk-execution --from <json>`

| Accepts only | `nimicoding.high-risk-ingest.v1` payloads with `ok: true` |
| Output | Review-ready attachment payload |

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

| Accepts only | `nimicoding.high-risk-review.v1` payloads with `ok: true` and `reviewStatus: ready_for_manager_review` |
| Validates | Acceptance artifact requires explicit `Disposition:` line |
| Output | Local-only manager decision payload |

## Mechanical Validators

| Command | Validates |
| --- | --- |
| `nimicoding validate-execution-packet <path>` | Frozen packet shape |
| `nimicoding validate-orchestration-state <path>` | Orchestration state record |
| `nimicoding validate-prompt <path>` | Prompt payload |
| `nimicoding validate-worker-output <path>` | Worker output shape |
| `nimicoding validate-acceptance <path>` | Acceptance evidence |

| Common output | `validator-cli-result.v1` JSON |
| Failure | Fail closed on missing required sections, malformed YAML, or seed-contract drift |

## Spec Audit

### `nimicoding validate-spec-tree`

Validates canonical tree structure under `.nimi/spec`.

### `nimicoding validate-spec-audit`

Validates per-file grounding, inference, and unresolved-gap
tracking under `.nimi/spec/_meta/spec-generation-audit.yaml`.

### `nimicoding blueprint-audit`

Compare repo-local blueprint root with candidate canonical tree
under `.nimi/spec`. Explicit equivalence audit; does not perform
routing changes.

## Source Basis

- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md) (CLI section)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
