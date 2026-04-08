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
| `schema/` | Typed artifact schemas: topic index, explore, baseline, evidence, finding ledger |
| `protocol/` | Execution protocols: dispatch, worker-output, acceptance, phase-lifecycle, reopen-defer |
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
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <complete|partial|deferred> --acceptance <rel-path> [--evidence <rel-path>]
```

Batch mode requires a **frozen plan**: topic status=active, baseline status=frozen, valid finding ledger, non-empty protocol_refs. `batch-preflight` checks all preconditions and outputs a structured pass/fail report. `batch-phase-done` validates the acceptance artifact, optionally attaches evidence, and re-validates all batch preconditions.

**Batch mode is not autonomous management.** It enforces the frozen-plan gate and handles mechanical artifact routing. The manager still authors all prompts, acceptance decisions, and finding updates. The worker still executes and produces output. Batch mode prevents under-specified or non-frozen topics from entering the delivery loop.

**Batch delivery loop:**

```
# 0. Freeze baseline (manual: set baseline frontmatter status to frozen)
# 1. Check frozen-plan preconditions
pnpm nimi-coding:batch-preflight -- <topic-dir>

# 2. Generate prompt for this phase
pnpm nimi-coding:prompt-skeleton -- <topic-dir> --phase <name> --goal <text> --output <prompt-path>
# (manager edits prompt, then validates)
pnpm nimi-coding:validate-prompt -- <prompt-path>

# 3. Worker executes, produces output (manual)
pnpm nimi-coding:validate-worker-output -- <worker-output-path>

# 4. Manager writes acceptance (manual or from skeleton)
pnpm nimi-coding:acceptance-skeleton -- --disposition <value> --output <acceptance-path>
# (manager edits acceptance, then validates)
pnpm nimi-coding:validate-acceptance -- <acceptance-path>

# 5. Commit phase completion
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <value> --acceptance <rel-path> --evidence <rel-path>

# 6. Repeat for next phase, or close topic
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

Content authoring (explore, baseline, prompt, worker-output, acceptance, evidence docs) remains manual markdown writing. The CLI handles topic routing, status transitions, and validation.

## Promotion Rules

Only promoted, reusable, decision-complete assets belong in this module:

- Stable contracts
- Reusable schemas and protocol units
- Reusable validators and helpers
- Self-hosting samples

Active research, audit notes, and trial topics stay in `.local/coding/**` until they meet the promotion requirements in `gates/promotion-policy.yaml`.
