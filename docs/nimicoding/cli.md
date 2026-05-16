# CLI Surface

The `nimicoding` CLI is the package boundary for Nimi Coding. It
bootstraps package-owned methodology into a project, validates the
resulting `.nimi/**` surface, emits handoff payloads for external AI
hosts, records local closeout evidence, and enforces topic / wave /
packet gates for high-risk work.

It does not write product code, call AI providers as the package
runtime, own scheduling, or run an autonomous agent loop. Execution
belongs to the admitted host; the CLI owns the contract boundary.

For per-command field-level reference see
[Reference → CLI Commands](/nimicoding/reference/cli-commands).

## Command Categories

| Category | Commands |
| --- | --- |
| Bootstrap and seed sync | `start`, `start --host <host>`, `clear`, `sync`, `doctor` |
| Skill handoff and closeout | `handoff --skill ...`, `closeout --skill ...`, `closeout --from ...` |
| Topic lifecycle | `topic create`, `topic status`, `topic validate`, `topic wave ...`, `topic packet freeze`, `topic worker dispatch`, `topic audit dispatch`, `topic result record`, `topic remediation open`, `topic overflow continue`, `topic hold`, `topic resume`, `topic closeout ...`, `topic true-close-audit`, `topic decision-review` |
| Topic runner | `topic run-next-step`, `topic run-ledger ...`, `topic-runner step`, `topic-runner run` |
| Sweep audit | `sweep audit plan`, `sweep audit chunk ...`, `sweep audit ledger build`, `sweep audit remediation-map build`, `sweep audit finding resolve`, `sweep audit closeout summary`, `sweep audit status` |
| Sweep design | `sweep design intake`, `packet-build`, `packet-build-batch`, `auditor-prompt`, `result-ingest`, `ledger-validate`, `finalize`, `wave-plan`, `fix-topic` |
| High-risk execution gates | `admit-high-risk-decision`, `ingest-high-risk-execution`, `review-high-risk-execution`, `decide-high-risk-execution` |
| Mechanical artifact validators | `validate-execution-packet`, `validate-orchestration-state`, `validate-prompt`, `validate-worker-output`, `validate-acceptance` |
| Spec and placement validators | `validate-spec-tree`, `validate-spec-audit`, `validate-spec-governance`, `classify-spec-tree`, `generate-spec-migration-plan`, `validate-placement`, `validate-table-family`, `validate-projection-edges`, `validate-guidance-bodies`, `validate-domain-admission`, `validate-tracked-output-admission`, `generate-spec-derived-docs`, `validate-ai-governance`, `blueprint-audit` |

Each category is bounded by typed contracts. New command families are
package authority changes, not convenience aliases.

## Bootstrap

### `nimicoding start`

`start` creates or resumes the project-local `.nimi/**` surface. It
seeds package-owned config, contracts, methodology, and bootstrap spec
material, updates managed AI entrypoint blocks when accepted, and
prepares the next external handoff.

| Mode | Command |
| --- | --- |
| Interactive | `nimicoding start` |
| Non-interactive | `nimicoding start --yes` |
| Host-targeted prompt | `nimicoding start --host <host>` |

`start` preserves project-owned truth: `.nimi/spec/**`,
`.nimi/local/**`, `.nimi/cache/**`, and locally modified bootstrap files
are not silently overwritten.

### `nimicoding sync`

`sync` is the package-owned seed projection contract.

| Mode | Meaning |
| --- | --- |
| `--check` | Fail non-zero when package-canonical seed files drift or are missing |
| `--apply` | Rewrite drifted package-canonical files and seed missing entries |
| `--dry-run` | Report what would change |

Host-owned seed entries are seeded once and are not overwritten by
`sync`.

### `nimicoding doctor`

`doctor` validates bootstrap health, local state roots, cross-contract
references, host adapter posture, skill result contracts, high-risk
schemas, and canonical-tree readiness. Use `--json` for machine output
and `--verbose` for internal contract detail.

## Minimal Adoption Path

The first path for a new project is:

```bash
nimicoding start
nimicoding doctor --json
nimicoding handoff --skill spec_reconstruction --json
nimicoding validate-spec-tree .nimi/spec
nimicoding validate-spec-audit
```

`handoff` exports a payload. The external AI host consumes it and
materializes `.nimi/spec/**`; local validators check the result.

## Topic Lifecycle

Topics are for authority-bearing, high-risk, cross-module, or
multi-wave work. The CLI records durable state under
`.nimi/topics/{proposal,ongoing,pending,closed}/`.

```bash
nimicoding topic create <slug> --justification <text>
nimicoding topic wave add <topic-id> <wave-id> <slug> \
  --goal <text> --owner-domain <domain>
nimicoding topic wave select <topic-id> <wave-id>
nimicoding topic wave admit <topic-id> <wave-id>
nimicoding topic packet freeze <topic-id> --from <draft-path>
nimicoding topic run-next-step <topic-id> --json
```

`run-next-step` computes the next typed decision. For repeated stepping,
use `topic-runner step` or `topic-runner run` with an explicit run id
and adapter. Do not replace the runner with ad hoc `topic run-ledger`
primitive chains.

## Sweep Audit And Design

`sweep audit` splits a target root into chunks, records auditor
evidence, builds ledgers, maps remediation candidates, and records
finding resolution.

`sweep design` starts from sweep findings. It builds bounded
design-auditor packets, ingests typed results, validates revision
provenance, produces final local design state, and emits candidate topic
waves. `sweep design wave-plan` is non-mutating; `sweep design
fix-topic` can apply a validated wave plan to a topic.

## Host-Specific Paths

Commands such as `sweep audit chunk audit-codex` and
`start --host codex` are adapter-specific surfaces. They do not change
the package boundary: Nimi Coding remains host-agnostic, and provider
runtime ownership stays outside the package.

## What The CLI Does Not Do

| Concern | Boundary |
| --- | --- |
| Product implementation | The admitted AI host or human worker changes product code |
| Provider invocation as package runtime | The package does not own AI provider execution |
| Scheduling | Host or surrounding workflow concern |
| Notification | Host or product UX concern |
| Autonomous packet execution | The package gates packet execution; it does not become the worker |

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/CHANGELOG.md`](https://github.com/nimiplatform/nimi-coding/blob/main/CHANGELOG.md)
- [`nimi-coding/cli/help.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/help.mjs)
- [`nimi-coding/cli/index.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/index.mjs)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/skill-handoff.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
