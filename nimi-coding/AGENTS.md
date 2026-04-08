# AGENTS.md — nimi-coding

- Think before acting. Read existing files before writing code. Prefer editing over rewriting.
- Be concise in output but thorough in reasoning. No sycophantic openers or closing fluff.
- Test your code before declaring done. User instructions always override this file.

## Scope

Applies to all files under `nimi-coding/**`. This module is the formal execution system for the nimi-coding methodology.

## What This Module Owns

`nimi-coding/**` is the promoted, repo-tracked execution system. It owns:

- **Contracts** (`contracts/`) — methodology, artifact model, staged delivery, finding lifecycle
- **Schemas** (`schema/`) — typed artifact schemas for topic index, explore, baseline, evidence, finding ledger
- **Protocols** (`protocol/`) — dispatch, worker-output, acceptance, phase-lifecycle, reopen-defer
- **Gates** (`gates/`) — gate policy and promotion policy
- **Scripts** (`scripts/`) — module validators, lifecycle helpers, and module-owned repo-wide checks
- **CLI** (`cli/`) — command entrypoint wrapping scripts into a unified interface
- **Samples** (`samples/`) — canonical self-host topic for validation

## What This Module Does NOT Own

- **Product spec authority** — `spec/**` is the only normative product source
- **Repo-wide collaboration hygiene** — checks like `check:agents-freshness`, `check:no-legacy-doc-contracts`, `check:no-absolute-user-paths` live in root `scripts/` because they govern the whole repository
- **Topic workspace content** — `.local/coding/**` is the local-only incubator for methodology research and trial artifacts; this module does not manage or modify topic content
- **Runtime / SDK / Desktop / Web code** — those modules have their own AGENTS and ownership

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

## `.local/coding/**` Boundary

- `.local/coding/**` is the topic workspace for methodology research and trial delivery
- Topics in `.local/coding/**` are validated by this module's scripts but are not part of the module itself
- Topic content is never committed to the repository
- Promotion from `.local/coding/**` into `nimi-coding/**` follows `gates/promotion-policy.yaml`

## Workflow Rules

1. Read contracts before modifying schemas or protocols
2. Run `pnpm nimi-coding:validate-module` after any module change
3. Run `pnpm nimi-coding:validate-topic -- <dir>` after modifying topic structure
4. Do not add new CLI commands, protocols, or schema types without completing the relevant phase in the implementation baseline
5. Do not pull repo-wide hygiene checks into this module unless they are naturally owned by the nimi-coding execution system

## Phase Boundaries

The implementation baseline at `.local/coding/20260409-spec-gated-manager-worker-delivery-methodology/nimi-coding-implementation.baseline.md` defines the phased rollout. Do not mix work across phases:

- **Phase 1** (current): Module hardening — boundaries, ownership, docs
- **Phase 2**: Protocol and artifact completion
- **Phase 3**: Gate and validator expansion
- **Phase 4**: CLI workflow MVP
- **Phase 5**: Search / query / manager assist
- **Phase 6**: Batch frozen-plan delivery

## Verification Commands

- `pnpm nimi-coding:validate-module` — validate the module itself
- `pnpm nimi-coding:check` — alias for validate-module
- `pnpm check:nimi-coding-module` — root wrapper for validate-module
- `pnpm check:ai-context-budget` — repo-wide context budget (module-owned)
- `pnpm check:ai-structure-budget` — repo-wide structure budget (module-owned)
- `pnpm check:high-risk-doc-metadata` — repo-wide doc metadata (module-owned)
