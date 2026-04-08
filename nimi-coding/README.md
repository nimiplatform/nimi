# Nimi Coding Module

`nimi-coding/**` is the formal execution system for the nimi-coding methodology.

It is the promoted, repo-tracked layer that owns methodology contracts, execution protocols, typed artifact schemas, gate policies, validators, CLI, and canonical samples.

## Authority Model

- `spec/**` is the only normative product authority. This module does not redefine product truth.
- `nimi-coding/**` is the promoted execution system. Only stable, reusable, decision-complete assets belong here.
- `.local/coding/**` is the local-only topic workspace for methodology research and trial artifacts. It is never committed. Promotion into this module follows `gates/promotion-policy.yaml`.

## What This Module Owns

| Directory | Responsibility |
|-----------|---------------|
| `contracts/` | System contracts: methodology, artifact model, staged delivery, finding lifecycle |
| `schema/` | Typed artifact schemas: topic index, explore, baseline, execution packet, orchestration state, evidence, finding ledger |
| `protocol/` | Execution protocols: execution packet, orchestration state, dispatch, worker-output, acceptance, phase-lifecycle, reopen-defer |
| `gates/` | Gate policy (hard/soft/advisory gates) and promotion policy (incubator → promoted) |
| `samples/` | Canonical self-host topic for validation |
| `scripts/` | Module validators, lifecycle helpers, and module-owned repo-wide checks |
| `cli/` | Unified command entrypoint wrapping scripts |

## What This Module Does NOT Own

- Product spec authority (`spec/**`)
- Repo-wide collaboration hygiene (e.g., `check:agents-freshness`, `check:no-legacy-doc-contracts`)
- Topic workspace content (`.local/coding/**`)
- Runtime, SDK, desktop, web, or mod code

See `AGENTS.md` for the full script ownership tier breakdown.

## Script Ownership

Scripts fall into two categories:

**Module-internal**: validate and operate on nimi-coding artifacts (topics, docs, findings, the module itself). Invoked via CLI or directly.

**Module-owned repo-wide**: implementation in `nimi-coding/scripts/`, thin root wrappers in `scripts/`. These check repo-wide concerns where nimi-coding is the natural authority (AI context budgets, doc metadata, structure budgets).

Repo-wide checks that are not nimi-coding concerns stay in root `scripts/` with no counterpart here.

## Entry Points

- Module docs: this file
- Public overview: [`docs/nimi-coding.md`](../docs/nimi-coding.md)
- Module AGENTS: [`AGENTS.md`](./AGENTS.md)
- CLI: [`cli/cli.mjs`](./cli/cli.mjs)
- Sample topic: [`samples/minimum-topic/topic.index.yaml`](./samples/minimum-topic/topic.index.yaml)

## Root Commands

### Lifecycle

```
pnpm nimi-coding:init-topic -- <topic-dir> [--title <title>] [--owner <owner>]
pnpm nimi-coding:set-topic-status -- <topic-dir> <status> --reason <text>
pnpm nimi-coding:set-baseline -- <topic-dir> <baseline-rel-path>
pnpm nimi-coding:set-baseline -- <topic-dir> --clear
pnpm nimi-coding:attach-evidence -- <topic-dir> <evidence-rel-path> [--final]
pnpm nimi-coding:finding-set-status -- <topic-dir> <finding-id> <next-status> --reason <text>
```

### Validate

```
pnpm nimi-coding:validate-topic -- <topic-dir>
pnpm nimi-coding:validate-doc -- <doc-path>
pnpm nimi-coding:validate-execution-packet -- <packet-path>
pnpm nimi-coding:validate-orchestration-state -- <state-path>
pnpm nimi-coding:validate-prompt -- <prompt-path>
pnpm nimi-coding:validate-worker-output -- <worker-output-path>
pnpm nimi-coding:validate-acceptance -- <acceptance-path>
pnpm nimi-coding:validate-finding-ledger -- <ledger-path>
pnpm nimi-coding:validate-module
pnpm nimi-coding:check
```

### Assist (Manager)

```
pnpm nimi-coding:topic-summary -- <topic-dir>
pnpm nimi-coding:unresolved-findings -- <topic-dir>
pnpm nimi-coding:prompt-skeleton -- <topic-dir> --phase <name> --goal <text> [--output <path>]
pnpm nimi-coding:acceptance-skeleton -- --disposition <complete|partial|deferred> [--output <path>]
```

These commands are **assist**, not automation. They reduce manager token cost by consolidating topic state, listing unresolved findings, and generating skeletons with all required blocks pre-filled. The manager still makes all semantic decisions (what to dispatch, whether to accept, what disposition to assign).

Skeleton outputs align with `prompt.schema.yaml` and `acceptance.schema.yaml` required blocks. They are starting points, not final artifacts.

### Batch Delivery

```
pnpm nimi-coding:batch-preflight -- <topic-dir>
pnpm nimi-coding:batch-next-phase -- <topic-dir> [--after <phase-id>]
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <complete|partial|deferred> --acceptance <rel-path> [--evidence <rel-path>]
```

Batch mode now requires a **packet-driven frozen plan**: topic status=active, baseline status=frozen, valid finding ledger, non-empty protocol_refs including `execution-packet.v1`, and a valid `execution_packet_ref` whose packet route is linear and inspectable. `batch-preflight` checks those preconditions and outputs a structured pass/fail report. `batch-next-phase` prints the packet-declared entry phase or the next phase after a completed phase. `batch-phase-done` validates the acceptance artifact, optionally attaches evidence, re-validates the packet-driven preconditions, and reports the next packet phase or terminal human handoff.

**Packet-driven orchestration skeleton is not an autonomous runner.** It only validates the packet, inspects the phase graph, selects the next packet-declared phase, and checks artifact-routing consistency. The manager still authors prompts and acceptance. The worker still executes. Final confirmation, semantic acceptance, notification transport, and finding lifecycle judgment all remain outside this cut.

## Orchestration State Formalization

`*.orchestration-state.yaml` is now a formal topic lifecycle artifact.

- It persists the minimum packet-bound mutable run position needed for future resumable autonomous mode.
- It is routed from `topic.index.yaml` by `orchestration_state_ref` when present.
- It is not runner implementation, notification transport, or resume runtime.
- It does not carry semantic acceptance, final confirmation, or finding lifecycle judgment.

Stateless batch mode remains valid. Current `batch-preflight`, `batch-next-phase`, and `batch-phase-done` do not require orchestration state and continue to operate packet-only. The orchestration-state artifact exists so later resumable autonomous mode can be formalized without mutating execution packets or overloading evidence/acceptance artifacts.

## Execution Packet Formalization

`*.execution-packet.yaml` is now a formal topic lifecycle artifact.

- It freezes the minimum post-convergence execution surface for bounded autonomous continuation.
- It is routed from `topic.index.yaml` by `execution_packet_ref` when present.
- It is not the autonomous runner itself.
- It does not contain notification transport configuration, runtime state, semantic acceptance outcomes, or finding inference.

Runner and notification transport implementation are still intentionally out of scope. This module now formalizes packet and orchestration-state artifacts, their protocol surfaces, validator coverage, and sample coverage needed for later bounded implementation cuts.

**Batch delivery loop:**

```
# 0. Freeze baseline (manual: set baseline frontmatter status to frozen)
# 1. Check frozen-plan preconditions
pnpm nimi-coding:batch-preflight -- <topic-dir>

# 2. Inspect the next packet-declared phase
pnpm nimi-coding:batch-next-phase -- <topic-dir>

# 3. Generate prompt for this phase
pnpm nimi-coding:prompt-skeleton -- <topic-dir> --phase <name> --goal <text> --output <prompt-path>
# (manager edits prompt, then validates)
pnpm nimi-coding:validate-prompt -- <prompt-path>

# 4. Worker executes, produces output (manual)
pnpm nimi-coding:validate-worker-output -- <worker-output-path>

# 5. Manager writes acceptance (manual or from skeleton)
pnpm nimi-coding:acceptance-skeleton -- --disposition <value> --output <acceptance-path>
# (manager edits acceptance, then validates)
pnpm nimi-coding:validate-acceptance -- <acceptance-path>

# 6. Commit phase completion and inspect next phase / terminal handoff
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <value> --acceptance <rel-path> --evidence <rel-path>

# 7. Repeat via batch-next-phase, or stop for final human confirmation
```

### Reports

```
pnpm nimi-coding:report-hotspots
pnpm nimi-coding:report-structure-hotspots
```

## Minimum Staged-Delivery Loop

A single topic can be driven through a complete lifecycle using CLI commands:

```
# 1. Initialize topic
pnpm nimi-coding:init-topic -- .local/coding/my-topic

# 2. Author explore doc (manual), then validate
pnpm nimi-coding:validate-doc -- .local/coding/my-topic/overview.explore.md

# 3. Author baseline doc (manual), set it as active, promote topic
pnpm nimi-coding:set-baseline -- .local/coding/my-topic methodology.baseline.md
pnpm nimi-coding:set-topic-status -- .local/coding/my-topic active --reason "Baseline ready"

# 4. Author prompt (manual), validate, dispatch to worker
pnpm nimi-coding:validate-prompt -- .local/coding/my-topic/phase-1.prompt.md

# 5. Worker executes, produces output (manual), validate
pnpm nimi-coding:validate-worker-output -- .local/coding/my-topic/phase-1.worker-output.md

# 6. Manager writes acceptance (manual), validate
pnpm nimi-coding:validate-acceptance -- .local/coding/my-topic/phase-1.acceptance.md

# 7. Record evidence, update findings
pnpm nimi-coding:attach-evidence -- .local/coding/my-topic phase-1.evidence.md
pnpm nimi-coding:finding-set-status -- .local/coding/my-topic F-001 fixed --reason "Resolved" --evidence-ref phase-1.evidence.md

# 8. Close topic with final evidence
pnpm nimi-coding:attach-evidence -- .local/coding/my-topic final.evidence.md --final
pnpm nimi-coding:set-topic-status -- .local/coding/my-topic closed --reason "All phases complete"
```

Content authoring remains manual. Markdown docs cover explore/baseline/evidence/prompt/worker-output/acceptance; execution packets are typed YAML artifacts. The CLI handles topic routing, status transitions, and validation.

## Promotion Rules

Only promoted, reusable, decision-complete assets belong in this module:

- Stable contracts
- Reusable schemas and protocol units
- Reusable validators and helpers
- Self-hosting samples

Active research, audit notes, and trial topics stay in `.local/coding/**` until they meet the promotion requirements in `gates/promotion-policy.yaml`.
