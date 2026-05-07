# CLI Commands

Field-level reference for the `nimicoding` CLI. For concept-level
overview see [CLI Surface](/nimicoding/cli).

## Bootstrap Commands

### `nimicoding start`

| Property | Value |
| --- | --- |
| Purpose | Bootstrap or resume project state |
| Mode | Interactive; `--yes` runs the non-interactive path |
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

## Topic Lifecycle

### `nimicoding topic create <slug> --justification <text> [--title <text>] [--json]`

Creates a proposal topic with an explicit entry justification.

### `nimicoding topic wave add <topic-id> <wave-id> <slug> --goal <text> --owner-domain <text> [--dep <wave-id>] [--json]`

Adds a wave entry. Use a `wave-N-<slug>` id that is unique inside the
topic.

### `nimicoding topic packet freeze <topic-id> --from <draft-path> [--json]`

Validates and freezes a packet artifact. Packet ids should include the
wave identity, for example `wave-1-add-reference-field`; short ids such
as `smoke-1` can produce ambiguous `packet-*.md` lifecycle names later
in the same topic.

### `nimicoding topic worker dispatch <topic-id> --packet <packet-id> [--json]`

Dispatches a frozen packet to the worker path and moves the packet into
the dispatched lifecycle state.

### `nimicoding topic result record <topic-id> --kind <worker|implementation|audit|preflight|judgement> --verdict <PASS|NEEDS_REVISION|FAIL|OVERFLOW> --from <path> --verified-at <iso8601> [--json]`

Records a typed result. The topic result timestamp uses UTC seconds
precision, for example `2026-05-06T16:47:20Z`.

### `nimicoding topic run-next-step <topic-id> [--json]`

Computes the next lifecycle decision. For repeated mechanical stepping,
use `nimicoding topic-runner step` or `nimicoding topic-runner run` with
an explicit `--run-id` and adapter.

### `nimicoding topic closeout wave <topic-id> <wave-id> ... [--json]`

Records wave closure across authority, semantic, consumer, and
drift-resistance dimensions.

### `nimicoding topic true-close-audit <topic-id> --judgement <text> [--json]`

Runs the topic-level true-close gate before final topic closeout.

## Sweep Audit

### `nimicoding sweep audit plan --root <dir> [--criteria <csv>] [--exclude <csv>] [--max-files <n>] [--sweep-id <id>] [--json]`

Builds an audit plan and materializes chunk files under
`.nimi/local/audit/chunks/<sweep-id>/`. JSON output reports chunk refs;
read the chunk files for `chunk_id` values such as `chunk-001`.

### `nimicoding sweep audit chunk dispatch --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> [--auditor <id>] [--json]`

Dispatches one chunk. Sweep-audit timestamps use full JavaScript ISO
UTC shape with milliseconds, for example
`2026-05-06T16:47:20.705Z`.

### `nimicoding sweep audit chunk audit-codex --sweep-id <id> --chunk-id <chunk-id> --dispatched-at <iso8601> --verified-at <iso8601> --reviewed-at <iso8601> [--from-raw-output <ref>] [--timeout-ms <ms>] [--json]`

Runs a Codex-backed chunk audit path when the active host supports it.

### `nimicoding sweep audit chunk ingest --sweep-id <id> --chunk-id <chunk-id> --from <json> --verified-at <iso8601> [--json]`

Ingests auditor evidence for the chunk.

### `nimicoding sweep audit chunk review --sweep-id <id> --chunk-id <chunk-id> --verdict <pass|fail> --reviewed-at <iso8601> [--summary <text>] [--json]`

Records manager review for ingested evidence.

### `nimicoding sweep audit chunk skip --sweep-id <id> --chunk-id <chunk-id> --reason <text> --skipped-at <iso8601> [--json]`

Skips a chunk with an explicit reason.

### `nimicoding sweep audit ledger build --sweep-id <id> [--verified-at <iso8601>] [--json]`

Builds an immutable audit ledger snapshot.

### `nimicoding sweep audit remediation-map build --sweep-id <id> [--max-findings <n>] [--verified-at <iso8601>] [--json]`

Builds a candidate remediation map from the ledger. Findings that need
authority alignment or user judgement should go through `sweep design`
before implementation.

### `nimicoding sweep audit finding resolve --sweep-id <id> --finding-id <id> --disposition <remediated|accepted-risk|false-positive|deferred-backlog> --from <json> --verified-at <iso8601> [--json]`

Records resolution evidence for one audit finding.

### `nimicoding sweep audit closeout summary --sweep-id <id> --verified-at <iso8601> [--json]`

Builds the local-only sweep closeout summary.

### `nimicoding sweep audit status --sweep-id <id> [--json]`

Reports the current sweep state.

The removed top-level `nimicoding audit-sweep ...` entrypoint is not a
canonical CLI command.

## Sweep Design

### `nimicoding sweep design intake --sweep-id <id> [--run-id <id>] [--json]`

Reads `.nimi/local/audit/evidence/<sweep-id>/findings.yaml`, records
the source hash, and writes an inventory under
`.nimi/local/sweep-design/<run-id>/`.

### `nimicoding sweep design packet-build --run-id <id> --packet-id <id> (--finding-id <id>|--finding-ids <csv>) [--explicit-question <text>] [--prior-design-state-refs <csv>] [--prior-design-state-marker <state>] [--current-cluster-refs <csv>] [--current-wave-refs <csv>] [--authority-only] [--json]`

Builds a bounded design-auditor packet for one or more findings.
Packets cite source findings, related evidence, authority refs, prior
design state, explicit questions, expected result shape, evidence-gap
policy, and stop conditions.

### `nimicoding sweep design packet-build-batch --run-id <id> --batch-size <n> [--finding-ids <csv>] [--packet-prefix <id>] [--manifest-id <id>] [--explicit-question <text>] [--json]`

Builds a manifest of design-auditor packets from the inventory.

### `nimicoding sweep design auditor-prompt --run-id <id> --packet-id <id> [--json]`

Emits the host prompt for a design-auditor packet, including the
required result origin and provenance fields.

### `nimicoding sweep design result-ingest --run-id <id> --from <yaml> [--mode <focused|all>] [--json]`

Ingests a typed design-auditor result, updates finding outcomes,
cluster and wave changes, decision requests, extra-audit requests, and
revision entries. Synthetic-trial results are allowed only with the
explicit load-test flag and do not satisfy true LLM closeout.

### `nimicoding sweep design ledger-validate --run-id <id> [--json]`

Validates revision-ledger integrity and final-outcome provenance before
planning.

### `nimicoding sweep design finalize --run-id <id> [--json]`

Emits the local-only final state report from the validated design
ledger.

### `nimicoding sweep design wave-plan --run-id <id> --topic-id <id> [--json]`

Emits candidate `topic wave add` / `topic wave admit` command refs for
implementation-ready clusters. It does not mutate topic state.

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
| `--verified-at` | yes | ISO8601 UTC timestamp accepted by the closeout command |
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
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/audit-chunk.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-chunk.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
