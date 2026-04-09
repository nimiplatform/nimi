# AGENTS.md — nimi-coding

- Think before acting. Read existing files before writing code. Prefer editing over rewriting.
- Be concise in output but thorough in reasoning. No sycophantic openers or closing fluff.
- Test your code before declaring done. User instructions always override this file.

## Scope

Applies to all files under `nimi-coding/**`. This module is the formal execution system for the nimi-coding methodology.

## Hard Boundaries

- `spec/**` remains the only product authority; this module must not create parallel product truth.
- `nimi-coding/.local/**` is local-only working state. Validate it when needed, but do not treat it as promoted module content.
- Keep packet, orchestration, acceptance, evidence, and finding lifecycle as semantic truth; keep leases, logs, notifications, and checkpoints operational only.

## What This Module Owns

`nimi-coding/**` is the promoted, repo-tracked execution system. It owns:

- **Contracts** (`contracts/`) — methodology, artifact model, staged delivery, finding lifecycle
- **Schemas** (`schema/`) — typed artifact schemas for topic index, explore, baseline, execution packet, orchestration state, evidence, finding ledger, and phase-execution markdown requirements
- **Protocols** (`protocol/`) — dispatch, provider-worker-execution, worker-output, worker-runner-signal, acceptance, phase-lifecycle, reopen-defer, and notification transport boundaries
- **Gates** (`gates/`) — gate policy and promotion policy
- **Scripts** (`scripts/`) — module validators, lifecycle helpers, and module-owned repo-wide checks
- **CLI** (`cli/`) — command entrypoint wrapping scripts into a unified interface
- **Samples** (`samples/`) — canonical self-host topic for validation

## What This Module Does NOT Own

- **Product spec authority** — `spec/**` is the only normative product source
- **Repo-wide collaboration hygiene** — checks like `check:agents-freshness`, `check:no-legacy-doc-contracts`, `check:no-absolute-user-paths` live in root `scripts/` because they govern the whole repository
- **Topic workspace content** — `nimi-coding/.local/**` is the local-only incubator for methodology research and trial artifacts; this module does not manage or modify topic content
- **Runtime / SDK / Desktop / Web code** — those modules have their own AGENTS and ownership
- **Semantic authority** — scheduler state, automation bridge state, provider execution logs, notification logs, and transport checkpoints remain operational surfaces only; they do not replace packet, orchestration, acceptance, evidence, or finding ownership

## Script Ownership Tiers

### Tier 1: Module-internal scripts

Located in `nimi-coding/scripts/`, invoked directly or through `nimi-coding/cli/`. These validate and operate on nimi-coding artifacts:

- `validate-topic.mjs` — validate a topic directory
- `validate-doc.mjs` — validate a single typed document
- `validate-prompt.mjs` — validate a prompt artifact
- `validate-finding-ledger.mjs` — validate a finding ledger
- `validate-module.mjs` — validate the nimi-coding module itself
- `init-topic.mjs` — initialize a new topic directory
- `attach-evidence.mjs` — attach evidence to a topic
- `finding-set-status.mjs` — transition a finding status

This tier now also includes the promoted execution-system runtime surfaces:

- packet-bound continuous run commands
- provider-backed foreground loop commands
- foreground scheduler + operational lease commands
- one-topic Codex setup / upsert / bridge commands
- notification handoff / checkpoint / adapter commands

### Tier 2: Module-owned repo-wide checks

Implementation lives in `nimi-coding/scripts/`, but these check repo-wide concerns that the nimi-coding system is the natural authority for. Root `scripts/` has thin wrappers that delegate here:

- `check-high-risk-doc-metadata.mjs` — verify high-risk doc metadata fields
- `check-ai-context-budget.mjs` — enforce AI context file size budgets
- `check-ai-structure-budget.mjs` — enforce directory/file structure budgets
- `report-ai-hotspots.mjs` — report AI context hotspot files
- `report-ai-structure-hotspots.mjs` — report AI structure hotspot directories

Root wrappers (e.g., `scripts/check-ai-context-budget.mjs`) simply import and call `main()` from the corresponding `nimi-coding/scripts/` file.

### Tier 3: Repo-wide, not module-owned

These live only in root `scripts/` and have no counterpart in `nimi-coding/scripts/`:

- `check-agents-freshness` — AGENTS.md structure checks
- `check-no-legacy-doc-contracts` — legacy doc contract cleanup
- `check-no-absolute-user-paths` — hardcoded user path detection
- All runtime, SDK, desktop, web, and mod-specific checks

## `nimi-coding/.local/**` Boundary

- `nimi-coding/.local/**` is the topic workspace for methodology research and trial delivery
- Topics in `nimi-coding/.local/**` are validated by this module's scripts but are not part of the module itself
- Topic content is never committed to the repository
- Promotion from `nimi-coding/.local/**` into `nimi-coding/**` follows `gates/promotion-policy.yaml`

## Retrieval Defaults

- Start with `README.md`, `contracts/`, `schema/`, `protocol/`, `gates/`, then `scripts/` or `cli/` as needed.
- Skip `archive/**`, `docs/_archive/**`, `.cache/**`, and `.iterate/**` when traversing from the workspace root; they are historical or operational noise, not active module authority.
- Skip `.local/**` unless the task explicitly needs active local topics or validation targets.
- `nimi-coding/.local/**` is the only active local execution workspace; do not substitute `.iterate/**` or `.cache/**` as planning or progress state.

## Current Execution-System Surface

`nimi-coding/**` is no longer a staged prototype or CLI MVP. Align changes to the current promoted surface:

- packet-bound continuous loop with strict mechanical closeout
- provider-backed foreground loop with Codex backend binding
- stable validator CLI result surface for the promoted validators
- foreground scheduler with operational single-flight lease
- one-topic Codex automation setup / upsert / bridge flow
- notification payload / log / handoff / checkpoint substrate
- narrow file-sink, webhook, and Telegram adapters

These are already promoted module capabilities. Do not describe the module as if protocol completion, CLI workflow MVP, or notification transport are still future-only work.

## Alignment Rules

1. Keep `spec/**` as the only product authority.
2. Keep packet, orchestration state, acceptance, evidence, and finding-ledger as the semantic execution truth.
3. Keep provider execution logs, scheduler leases, automation bridge results, notification logs, and transport checkpoints as operational state only.
4. Treat validator CLI JSON output as a stable machine-readable result surface, not a semantic judge.
5. Treat Codex backend binding and one-topic automation setup/upsert/bridge as admitted execution-system surfaces, but not as new owners of scheduling, acceptance, or finding semantics.
6. Do not reintroduce phased-rollout prose that understates the current promoted surface.
7. Do not claim phase-2 semantic automation, generalized automation orchestration, or transport-manager behavior is complete when it is not.

## Workflow Rules

1. Read contracts before modifying schemas or protocols
2. Run `pnpm nimi-coding:validate-module` after any module change
3. Run `pnpm nimi-coding:validate-topic -- <dir>` after modifying topic structure
4. Align AGENTS, README, docs, CLI help, and validator expectations to the current promoted module surface when they drift
5. Do not add new CLI commands, protocols, or schema types unless they fit the current promoted execution-system authority and do not create parallel truth
6. Do not pull repo-wide hygiene checks into this module unless they are naturally owned by the nimi-coding execution system
7. Treat the current module state as execution-system core closure: operational looping, scheduling, transport handoff, and Codex automation binding exist, but semantic automation and generalized orchestration do not

## Verification Commands

- `pnpm nimi-coding:validate-module` — validate the module itself
- `pnpm nimi-coding:check` — alias for validate-module
- `pnpm check:nimi-coding-module` — root wrapper for validate-module
- `pnpm check:ai-context-budget` — repo-wide context budget (module-owned)
- `pnpm check:ai-structure-budget` — repo-wide structure budget (module-owned)
- `pnpm check:high-risk-doc-metadata` — repo-wide doc metadata (module-owned)
