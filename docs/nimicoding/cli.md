# CLI Surface

The `nimicoding` CLI is a small, bounded set of commands. The
package is intentionally **boundary-complete, not run-complete**:
the CLI bootstraps, validates, and projects, but it does not
autonomously execute packets.

For per-command field-level reference see
[Reference → CLI Commands](/nimicoding/reference/cli-commands).

## Command Categories

The CLI's verbs fall into a small number of categories:

| Category | Commands |
| --- | --- |
| Bootstrap | `start`, `clear`, `doctor` |
| Skill handoff | `handoff`, `closeout` |
| High-risk execution | `admit-high-risk-decision`, `ingest-high-risk-execution`, `review-high-risk-execution`, `decide-high-risk-execution` |
| Mechanical validators | per-artifact validators for `execution-packet`, `orchestration-state`, `prompt`, `worker-output`, `acceptance` |
| Spec audit | `validate-spec-tree`, `validate-spec-audit`, `blueprint-audit` |
| Repo gates | `pnpm check:spec-authority-cutover-readiness` (via the host repo's tooling) |

Each is bounded; new verbs require admitted contract extensions.

## Bootstrap

### `nimicoding start`

Detect project state, project package source into host paths,
seed `.nimi/**`, prepare one authoritative JSON AI task package,
print a paste-ready prompt.

| Property | Value |
| --- | --- |
| Mode | Interactive: explain → confirm → apply, one step at a time |
| Failure | Fail closed on unknown CLI options |
| Preserves | Existing truth files (does not overwrite) |
| Refuses | Unsupported bootstrap contract versions |

### `nimicoding clear`

Remove only managed AI blocks in `AGENTS.md` and `CLAUDE.md`,
remove only package-owned bootstrap files when they exactly
match the seed.

| Property | Value |
| --- | --- |
| Preserves | Project-owned truth, locally modified bootstrap files, `.nimi/spec/**`, `.nimi/local/**`, `.nimi/cache/**` |
| Refuses | Implicit deletion of project-owned truth or local artifacts |

### `nimicoding doctor`

Validate `.nimi/**` bootstrap seed presence, contract
compatibility, lifecycle markers, cross-contract reference
alignment, host-adapter boundary truth, named-overlay status,
admitted package-owned adapter profile overlays, and more.

| Output | Human-readable or `--json` |
| Failure | Fail closed when lifecycle, canonical tree, and auditability drift apart |

## Skill Handoff

### `nimicoding handoff --skill <skill-id> --json`

Export a machine-readable external-handoff payload. With
`--prompt`, also print a human-readable host briefing.

| Property | Value |
| --- | --- |
| Skill | Required (`spec_reconstruction` / `doc_spec_audit` / `audit_sweep` / `high_risk_execution`) |
| Output | Authoritative JSON payload |
| Host posture | Vendor-neutral; supports any admitted host (Claude, Codex, Gemini, OMX, etc.) |
| Refuses | `doc_spec_audit` and `high_risk_execution` until canonical tree is ready |

### `nimicoding closeout --skill --outcome --verified-at`

Project external skill results into a local-only closeout
payload. Optionally `--write-local` under
`.nimi/local/handoff-results/`.

| Property | Value |
| --- | --- |
| Validation | Closeout result must pass typed contract |
| Failure | Fail closed if outcome contradicts canonical-tree state, if refs escape declared local artifact roots, etc. |
| Local-only | Never promotes to project semantic truth |

## High-Risk Execution

### `nimicoding admit-high-risk-decision --from <json> --admitted-at <iso8601>`

Accept only `nimicoding.high-risk-decision.v1` payloads with
`decisionStatus: manager_decision_recorded`. Project canonical
admission preview. Write tracked semantic truth only with
explicit `--write-spec`.

### `nimicoding ingest-high-risk-execution --from <json>`

Accept only `high_risk_execution` closeout artifacts with
`outcome: completed` and `summary.status: candidate_ready`.
Mechanically validate referenced artifacts; project local-only
ingest payload.

### `nimicoding review-high-risk-execution --from <json>`

Accept ingest payloads with `ok: true`. Project review-ready
attachment for manager-owned review. Carry attachment refs and
ingest validation evidence.

### `nimicoding decide-high-risk-execution --from <json> --acceptance <path> --verified-at <iso8601>`

Accept review payloads with `ok: true` and
`reviewStatus: ready_for_manager_review`. Mechanically validate
acceptance artifact. Require `Disposition:` line. Project
local-only manager decision.

## Mechanical Validators

Per-artifact validators emit machine-readable
`validator-cli-result.v1` JSON.

| Validator | Validates |
| --- | --- |
| `execution-packet` | Frozen packet shape |
| `orchestration-state` | Orchestration state record |
| `prompt` | Prompt payload |
| `worker-output` | Worker output shape |
| `acceptance` | Acceptance evidence |

| Property | Value |
| --- | --- |
| Path required | Yes |
| Output | JSON on success or refusal |
| Failure | Fail closed on missing required sections, malformed YAML, or seed-contract drift |

## Spec Audit

### `nimicoding validate-spec-tree`

Validate canonical tree structure under `.nimi/spec`.

### `nimicoding validate-spec-audit`

Validate per-file grounding, inference, and unresolved-gap
tracking under `.nimi/spec/_meta/spec-generation-audit.yaml`.

### `nimicoding blueprint-audit`

Compare a repo-local blueprint root with the candidate canonical
tree under `.nimi/spec`. Explicit equivalence audit; does not
perform routing changes.

## Reader Scenario: A First-Run Bootstrap

You install Nimi Coding in a project for the first time.

```
nimicoding start
```

The CLI walks you through:

1. Detect project state.
2. Confirm or accept managed AI entrypoints (`AGENTS.md`,
   `CLAUDE.md` blocks).
3. Seed `.nimi/**` with package-owned source.
4. Prepare one authoritative JSON AI task package for
   `spec_reconstruction`.
5. Print a paste-ready prompt for the AI host of your choice.

You hand the prompt to your AI host; the host runs
reconstruction; you return the result via `nimicoding closeout`.

## Reader Scenario: A High-Risk Execution Cycle

You have a mature project with canonical spec; you want to run
substantive AI-coding work.

| Step | Command |
| --- | --- |
| 1. Manager admits a packet | (manual; topic.yaml + packet artifact) |
| 2. Pre-implementation audit (if needed) | (host runs audit; result recorded) |
| 3. Hand off to host | `nimicoding handoff --skill high_risk_execution --json` |
| 4. Host executes; returns result | (host-side) |
| 5. Ingest result | `nimicoding ingest-high-risk-execution --from result.json` |
| 6. Review | `nimicoding review-high-risk-execution --from ingest.json` |
| 7. Manager decision | `nimicoding decide-high-risk-execution --from review.json --acceptance accept.md --verified-at ...` |
| 8. Closeout | (manual; closeout artifact) |

Each step is bounded by the CLI's typed validation. Skipping a
step or smuggling fields through means the CLI refuses.

## What The CLI Does Not Do

| Concern | Why not |
| --- | --- |
| Autonomous packet execution | Host AI owns execution |
| Provider invocation | Package does not call AI providers |
| Scheduler | Scheduling is a host concern |
| Notification | UX is host concern |
| Self-update | Out of standalone scope |

These are explicitly deferred surfaces.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md) (CLI section)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/) (CLI implementation)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
- [`nimi-coding/methodology/skill-installer-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-installer-result.yaml)
- [`nimi-coding/contracts/execution-packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/execution-packet.schema.yaml)
- [`nimi-coding/contracts/orchestration-state.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/orchestration-state.schema.yaml)
- [`nimi-coding/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/prompt.schema.yaml)
- [`nimi-coding/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/worker-output.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/acceptance.schema.yaml)
