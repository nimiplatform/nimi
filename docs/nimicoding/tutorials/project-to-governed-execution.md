# Tutorial: Run A Governed Codex Project

This tutorial connects Nimi Coding to Codex without creating a second
execution system. Codex owns the task, plan, subagents, retries, waits,
resume behavior, and completion state. Nimi Coding supplies the project
truth surface, methodology, deterministic gates, and evidence contracts.

By the end, the repository's `.nimi/spec/**` tree and host boundary are
validated, and Codex changes have a repeatable acceptance path without
mirroring task state into project files.

## Ownership Boundary

| Concern | Owner |
| --- | --- |
| Task planning and progress | Codex |
| Parallel work and subagents | Codex |
| Retry, wait, resume, and completion | Codex |
| Product and architecture authority | `.nimi/spec/**` |
| Change classification and preflight | Nimi Coding methodology |
| Deterministic validation | Project scripts and Nimi Coding validators |
| Local verification evidence | Contract-shaped artifacts under `.nimi/local/**` |

The repository does not maintain a second task lifecycle. A Codex task
may reference spec paths and evidence artifacts, but its runtime state
stays in Codex.

## 1. Verify The Truth Surface

Install the workspace and run the Nimi compatibility checks:

```bash
pnpm install
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

The checks verify package-managed projections and declared host overrides.
Repository instructions keep execution ownership with the external host;
neither check creates product authority or host task state.

## 2. Reconstruct Product Authority

When authority authoring is required, the active Codex task reads the affected
authority containers and `.nimi/methodology/authority-authoring.yaml`, updates
the existing `.nimi/spec/**` owner container, and validates the result:

```bash
pnpm spec:authority:check
pnpm spec:authority:compile
```

A green validator result means the authority corpus satisfies the declared
format and relationship contracts. It does not replace product review of
authority decisions.

## 3. Classify The Change Before Editing

For authority-bearing or cross-layer work, the Codex task records a
bounded preflight:

- `Spec Status`: whether active authority is present and sufficient
- `Authority Owner`: the canonical spec surface that decides the change
- `Work Type`: alignment, redesign, refactor, or another admitted class
- `Parallel Truth`: whether the proposed change would create a second
  source of truth

If authority is missing or contradictory, Codex stops implementation and
updates the canonical spec through the admitted process. It does not
paper over the gap with an application-local rule.

## 4. Let Codex Execute The Work

Describe the desired outcome in the Codex task and link the relevant
spec paths. Codex chooses the plan, delegates bounded parallel work when
useful, edits the repository, and tests the result. Nimi Coding does not
select Codex's next step or launch another Codex session.

During implementation:

- keep reads and writes within the authority owner named in preflight;
- reuse shared SDK and Kit surfaces before adding app-local machinery;
- fail closed on contract violations;
- update canonical spec first when an admitted redesign changes truth;
- preserve unrelated work already present in the workspace.

These are project constraints, not an alternate scheduler.

## 5. Run Scoped Gates

Run the validators and project checks that cover the changed surfaces.
The exact commands come from the repository's current instructions and
package scripts. Start with the narrowest affected scope, then run broad
governance checks when the change crosses authority boundaries.

Evidence must come from real commands and, for app or UI work, from the
real application shell. A passing unit test cannot substitute for a
broken runtime, inaccessible control, console error, or failed SDK/auth
connection.

Store contract-required local evidence under `.nimi/local/**`. Those
artifacts support review; they do not become semantic authority and do
not duplicate Codex progress state.

## 6. Close In Codex

Codex marks the task complete only after the requested outcome and its
required validation are real. The final handoff names:

- changed authority and implementation surfaces;
- checks that actually ran and their results;
- runtime or visual evidence when applicable;
- unresolved risks or decisions, if any.

There is no repository-side execution close ceremony. Durable product
truth belongs in `.nimi/spec/**`; durable validation logic belongs in
scripts and contracts; task completion belongs to Codex.

## Failure Handling

| Failure | Required response |
| --- | --- |
| Authority is missing | Stop the edit and resolve canonical authority |
| A deterministic gate fails | Fix the cause and rerun the real gate |
| Runtime behavior contradicts tests | Treat runtime behavior as the failure and add regression coverage |
| External host is unavailable | Report the block; do not manufacture output or evidence |
| Work would create parallel truth | Move ownership to the canonical layer before implementation |

## Source Basis

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
