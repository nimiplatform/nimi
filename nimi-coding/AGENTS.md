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
- Keep `nimi-coding` continuity-agnostic. Durable artifacts and recoverable governance are core; persistent manager presence or harness continuity is not.

## Core Usage

- Use `nimi-coding` for high-risk, authority-bearing, cross-layer, or
  multi-phase work.
- Do not use `nimi-coding` for every small fix. If the authority boundary is
  already clear and the change is narrow and low-risk, work can stay outside a
  topic.
- Do not recursively decompose one capability chain into repeated `preflight`,
  `boundary`, and `seed` topics when owner, lifecycle, and consumer boundaries
  have not actually changed. After the first bounded chain, the next step must
  be collapse/audit or implementation.
- Treat `README.md` and the promoted contracts under `contracts/` as the module
  authority for detailed methodology and runtime surface behavior.
- Treat `.local/**` as the active topic workspace only. It is validated by the
  module, but it is not promoted module content.

## What This Module Owns

- methodology and staged-delivery contracts
- typed execution artifacts and validators
- local topic workflow under `.local/**`
- execution-system checks naturally owned by `nimi-coding`

## What This Module Does NOT Own

- product spec authority
- repo-wide collaboration policy outside natural nimi-coding ownership
- runtime, SDK, desktop, or web product code
- scheduler, automation, notification, or provider logs as semantic truth

## Retrieval Defaults

- Start with `README.md`, `contracts/`, `schema/`, `protocol/`, `gates/`, then `scripts/` or `cli/` as needed.
- Skip `archive/**`, `docs/_archive/**`, `.cache/**`, and `.iterate/**` when traversing from the workspace root; they are historical or operational noise, not active module authority.
- Skip `.local/**` unless the task explicitly needs active local topics or validation targets.
- `nimi-coding/.local/**` is the only active local execution workspace; do not substitute `.iterate/**` or `.cache/**` as planning or progress state.

## Current Execution-System Surface

`nimi-coding/**` is a promoted execution system, not a planning prototype.

- inline manager-worker is the default posture
- provider-backed and scheduler-backed paths are optional operational surfaces
- packet, orchestration, acceptance, evidence, and finding-ledger remain the
  semantic execution truth
- continuity engineering may extend the system from outside, but is not part of
  the core methodology contract

## Alignment Rules

1. Keep `spec/**` as the only product authority.
2. Keep packet, orchestration state, acceptance, evidence, and finding-ledger as the semantic execution truth.
3. Keep provider execution logs, scheduler leases, automation bridge results, notification logs, and transport checkpoints as operational state only.
4. Treat validator CLI JSON output as a stable machine-readable result surface, not a semantic judge.
5. Treat Codex backend binding and one-topic automation setup/upsert/bridge as admitted execution-system surfaces, but not as new owners of scheduling, acceptance, or finding semantics.
6. Describe provider-backed worker and scheduler surfaces as optional operational paths unless the task explicitly needs them; do not present them as the default methodology posture.
7. Topic entry is risk-shaped: use `nimi-coding` for authority-bearing, high-risk, or multi-phase work rather than every small change.
8. Token-cost discussion belongs to methodology audit only; do not turn it into routine execution bookkeeping.
9. Keep continuity-agnostic explicit: harnesses, automation, or host runtimes may extend continuity, but they do not define core `nimi-coding` methodology.
10. Do not reintroduce phased-rollout prose that understates the current promoted surface.
11. Do not claim phase-2 semantic automation, generalized automation orchestration, or transport-manager behavior is complete when it is not.
12. Treat same-family packet proliferation as an execution-system bug. If a capability chain starts repeating `preflight`, `boundary`, or `seed` slices, stop and open a collapse/audit repair rather than continuing the chain.

## Workflow Rules

1. Read contracts before modifying schemas or protocols
2. Run `pnpm nimi-coding:validate-module` after any module change
3. Run `pnpm nimi-coding:validate-topic -- <dir>` after modifying topic structure
4. Align AGENTS, README, docs, CLI help, and validator expectations to the current promoted module surface when they drift
5. Do not add new CLI commands, protocols, or schema types unless they fit the current promoted execution-system authority and do not create parallel truth
6. Do not pull repo-wide hygiene checks into this module unless they are naturally owned by the nimi-coding execution system
7. Prefer principle-first guidance in instruction docs; leave detailed operational behavior to README and contracts
8. Prefer inline manager-worker guidance in promoted examples unless the change explicitly targets provider-backed or scheduler-backed execution
9. Do not turn continuity engineering concerns into core methodology requirements unless the module is explicitly being redesigned to own them
10. If `validate-topic` reports same-family fragmentation, do not open another decomposition packet. Repair the chain or open a collapse/audit topic first.

## Verification Commands

- `pnpm nimi-coding:validate-module` — validate the module itself
- `pnpm nimi-coding:check` — alias for validate-module
- `pnpm check:nimi-coding-module` — root wrapper for validate-module
- `pnpm check:ai-context-budget` — repo-wide context budget (module-owned)
- `pnpm check:ai-structure-budget` — repo-wide structure budget (module-owned)
- `pnpm check:high-risk-doc-metadata` — repo-wide doc metadata (module-owned)
