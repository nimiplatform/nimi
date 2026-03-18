# Nimi Coding

> Status: Active
> Version: 1.0
> Maintainer: @snowzane
> Created: 2026-03-03
> Last Updated: 2026-03-12
> Scope: Nimi public methodology
> Language: English
> Legacy Alias: Oriented-AI Spec Coding

---

## Part A — Method Definition & Design Goals

### A1. Definition

**Nimi Coding** is software development against an AI-readable, enforceable, layered, cross-checked source of truth.  
It treats source-of-truth artifacts as an executable governance system for AI-first executors, with one default lifecycle:

`Rule -> Table -> Generate -> Check -> Evidence`

Where:

1. `Rule`: Defines invariants and cross-domain contracts.
2. `Table`: Stores structured facts in machine-verifiable form.
3. `Generate`: Produces readable projections from source facts.
4. `Check`: Enforces consistency and drift via deterministic guards.
5. `Evidence`: Closes the loop through command outputs and audit records.

### A2. Applicability

This methodology is designed for:

1. Systems with complex rules and strong cross-module coupling.
2. Multi-team environments requiring stable semantic boundaries.
3. Workflows where AI agents are primary implementers or collaborators.
4. Delivery chains requiring traceability, consistency, and regression resistance.

### A3. Out of Scope

This methodology does not directly solve:

1. Business strategy correctness.
2. Legal conclusions (engineering governance only, not legal advice).
3. Organizational politics or role conflicts.
4. One-off prototypes where formal governance is intentionally unnecessary.

### A4. Design Goals

1. **Decision Complete**: No hidden decisions are pushed to implementers.
2. **Machine Verifiable**: Core rules can be checked deterministically.
3. **Traceable**: Every change maps to Rule IDs and evidence.
4. **Regress-resistant**: Fixes can be hardened into long-term guards.
5. **Portable**: The method can migrate across repositories and stacks.

---

## Part B — Core Axioms

### B1. One Fact One Home

A fact has exactly one authoritative source.  
Projections, tutorials, and comments are not authoritative fact stores.

### B2. Contract-first / Table-first / Projection-last

1. Define contracts first.
2. Maintain structured facts second.
3. Generate readable projections last.

Never edit projections first and backfill sources later.

### B3. Deterministic Guard First

Any rule that can be machine-checked must be enforced in CI/scripts, not in human memory.

### B4. Evidence over Assertion

"I think this is done" is not completion.  
Each change requires reproducible evidence:

1. Executed commands.
2. Command outputs.
3. Not-run items with reasons.

### B5. Stable Anchors

Rules must have stable anchors (for example, Rule IDs).  
Cross-doc, cross-table, and cross-check references should depend on anchors, not paragraph positions.

### B6. No Execution-State Pollution in Spec

Normative source-of-truth documents define contracts, not run snapshots.  
Execution state belongs in reports/plans, not in normative sections.

### B7. Gate-based Enforcement Language

This methodology uses Gate semantics instead of MUST/SHOULD distinctions:

1. **Hard Gate**: If it fails, merge is blocked.
2. **Soft Gate**: If it fails, merge is allowed only with explicit risk and owner.
3. **Advisory**: Recommendation only, tracked for trend and optimization.

---

## Part C — Artifact Architecture

### C1. Layer Model (Policy / Kernel / Domain / Tables / Generated / Report)

| Layer | Purpose | Artifact Characteristics | Manual Edit |
|---|---|---|---|
| Policy | Governance principles and red lines | Gate classes and execution boundaries (Hard/Soft/Advisory) | Yes |
| Kernel | Cross-domain core contracts | Rule IDs and invariants | Yes |
| Domain | Domain increments | References Kernel without duplicating core contracts | Yes |
| Tables | Structured fact source | YAML/JSON/Schema data | Yes |
| Generated | Machine-generated projections | Read-only views | No |
| Report/Plan | Execution evidence and process | Audit, plan, and result records | Yes |

### C2. Inputs, Outputs, and Boundaries

1. `Policy -> Kernel`: Governance defines Gate classes and writing rules.
2. `Kernel -> Domain`: Domain adds local increments and references.
3. `Kernel + Tables -> Generated`: Generators produce projections from source facts.
4. `Check -> Report`: Check outputs are recorded as audit evidence.

Boundary rules:

1. Domain must not define cross-domain core facts.
2. Generated artifacts are not editing entry points.
3. Reports must not mutate normative source facts.

### C3. Traceability Chain

Standard traceability chain:

`Rule ID -> Table row -> Generated view -> Check rule -> Evidence record`

Any broken link is a governance defect.

---

## Part D — Rule & Fact System Design

### D1. Rule ID Naming and Numbering

Use the fixed format:

`<PREFIX>-<AREA>-NNN`

Rules:

1. `<PREFIX>`: 1-6 uppercase letters, project-defined namespace (default: `AISC`).
2. `<AREA>`: 2-12 uppercase letters (for example `CORE`, `FLOW`, `AUDIT`).
3. `NNN`: Three-digit sequence, never reused.
4. Validation regex: `^[A-Z]{1,6}-[A-Z]{2,12}-[0-9]{3}$`.
5. Projects must declare their prefix-to-domain mapping in a project-level configuration.

Suggested number bands:

1. `001-009`: Core invariants.
2. `010-099`: Incremental rules.
3. `100+`: Extension/migration-reserved rules.

Examples (default AISC namespace):

1. `AISC-CORE-001`
2. `AISC-FLOW-023`
3. `AISC-AUDIT-110`

Examples (domain-prefix namespace):

1. `K-RPC-001` (Runtime)
2. `D-BOOT-001` (Desktop)
3. `S-ERROR-001` (SDK)

### D2. Structured Fact Table Design

Recommended fields (adaptable by organization):

| Field | Description |
|---|---|
| `id` | Row-level unique identifier |
| `name` | Semantic name |
| `value` | Enum/config value |
| `source_rule` | Source Rule ID |
| `status` | `active` / `deprecated` / `draft` |
| `version` | Semantic version |
| `owner` | Responsible person or team |
| `updated_at` | Last update timestamp |

Hard constraints:

1. Every structured fact row must include `source_rule`.
2. `source_rule` must resolve to an existing Rule ID matching the project's declared Rule ID format.
3. Missing/invalid `source_rule` is a **Hard Gate** failure.
4. Cross-table references must be verifiable (existence, uniqueness, type validity).
5. Table schema changes must be paired with guard upgrades.

### D3. Generated Projection Constraints

1. Generated files must include "DO NOT EDIT".
2. Generation must be deterministic and repeatable.
3. Drift-check commands must detect source/projection mismatch.
4. Generation failures block merge; "merge now, fix later" is not allowed.

---

## Part E — Execution Protocol (Change Lifecycle)

### E1. Change Classification

Classify each change as one or more of:

1. `Rule Change`: Contract clauses changed.
2. `Fact Change`: Structured facts changed.
3. `Projection Change`: Generator logic or projection outputs changed.
4. `Guard Change`: Check scripts/rules changed.

### E2. Mandatory Order

The standard sequence is fixed:

1. Update Rule.
2. Update Table.
3. Run Generate.
4. Run Check.
5. Publish Evidence.

Any skipped step requires an explicit exemption note.

### E3. Failure Handling

Recommended severity classes:

1. **Blocking**: Core invariant break, unresolvable rule, or drift failure.
2. **High**: Cross-table inconsistency or missing key guards.
3. **Medium**: Readability or non-critical coverage gaps.

Handling:

1. Blocking: Stop merge and fix first.
2. High: Fix within a bounded window with regression protection.
3. Medium: Track in the plan and close with scheduled follow-up.

### E4. Decision Closure

Every change must include:

1. Intent (`Why`).
2. Scope (`What`).
3. Execution steps and commands (`How`).
4. Acceptance criteria (`Done`).
5. Risk and rollback strategy (`Risk/Rollback`).

---

## Part F — Two-Layer Quality Guard

### F1. Layer 1: CI Deterministic Guards

Guard coverage should include:

1. Rule ID parseability and uniqueness.
2. Table field completeness and type validity.
3. Cross-table reference consistency.
4. Drift checks between fact source and generated projection.
5. Naming conventions and forbidden-pattern checks.
6. Rule reference coverage.
7. Key implementation/spec mapping checks (constants/enums/state machines).

#### Existing Check Catalog (Methodology-related Baseline)

1. `check:runtime-spec-kernel-consistency`
2. `check:runtime-spec-kernel-docs-drift`
3. `check:sdk-spec-kernel-consistency`
4. `check:sdk-spec-kernel-docs-drift`
5. `check:desktop-spec-kernel-consistency`
6. `check:desktop-spec-kernel-docs-drift`
7. `check:future-spec-kernel-consistency`
8. `check:future-spec-kernel-docs-drift`
9. `check:platform-spec-kernel-consistency`
10. `check:platform-spec-kernel-docs-drift`
11. `check:realm-spec-kernel-consistency`
12. `check:realm-spec-kernel-docs-drift`
13. `check:spec-human-doc-drift`
14. `check:scope-catalog-drift`
15. `check:runtime-bridge-method-drift`

#### Minimal Hard Gate (Merge Admission)

1. `consistency` checks must pass for all affected domains.
2. `docs-drift` checks must pass for all affected domains.
3. Global `spec-human-doc-drift` must pass.
4. `scope-catalog-drift` is a Hard Gate for cross-domain mapping.
5. `runtime-bridge-method-drift` is a Hard Gate for interface projection drift (triggered by relevant changes).

### F2. Layer 2: Semantic Audit

Semantic audit covers areas not easily automated:

1. Design soundness (strategy, performance, resilience).
2. Spec completeness (missing constraints or dimensions).
3. Cross-domain semantic alignment (terms, state, and error semantics).
4. Evolution feasibility (migration cost and compatibility strategy).

Constraints:

1. Semantic audit does not replace CI checks.
2. Machine-verifiable defects must flow back to Layer 1 guards.

### F3. Bi-directional Audit Model

Bi-directional audit has two lanes:

1. `Lane A: Spec -> Impl`: Verify whether spec is implemented.
2. `Lane B: Impl -> Spec`: Verify whether implementation changes are written back to spec.

Governance roles:

1. LLM/automation performs continuous audit.
2. Human reviewers are the final arbiter.

Trigger model:

1. Event-driven, not fixed cadence.
2. Recommended trigger events:
   - Kernel/Table changes
   - Major feature merges
   - Pre-release freeze windows

### F4. Defect Backflow

Standard backflow:

1. Detect defect.
2. Decide whether it is machine-verifiable.
3. If yes: add guard rule and fix defect together.
4. If no: record semantic audit item and re-review condition.
5. Update templates/check catalog after retrospective.

---

## Part G — Templates & Playbooks

### G1. PR Template (Generic)

```md
## Change Summary
- Change Type: Rule / Fact / Projection / Guard
- Affected Areas: ...
- Rule IDs: ...

## Files
- Contract files:
- Fact tables:
- Generated views:
- Guard scripts:

## Execution
1. `<generate-command>`
2. `<consistency-check-command>`
3. `<drift-check-command>`

## Gate Results
- Hard Gate: PASS / FAIL
- Soft Gate: PASS / FAIL (if FAIL, risk owner required)
- Advisory: observations / trend notes

## Results
- PASS:
- FAIL:
- Not Run (reason):

## Risks
- Compatibility:
- Rollback:
```

### G2. Audit Report Template (Generic)

```md
# Spec Audit Report
Date: YYYY-MM-DD
Scope: ...

## Evidence
- Commands:
  - `<command-1>`
  - `<command-2>`
- Inputs:
  - `<file-or-module-1>`

## Findings
### Blocking
1. ...

### High
1. ...

### Medium
1. ...

## Bi-directional Audit
- Lane A (Spec -> Impl):
- Lane B (Impl -> Spec):
- Human Verdict (Final Arbiter): PASS / CONDITIONAL PASS / FAIL

## Recommended Actions
1. ...
2. ...

## Acceptance Criteria
- [ ] ...
- [ ] ...
```

### G3. New Rule Introduction Template (Rule/Table/Check Sync)

```md
## New Rule
- Rule ID: `<PREFIX>-<AREA>-NNN`
- Contract location: `<kernel-file>`
- Intent: ...

## Fact Impact
- Table: `<table-file>`
- Fields changed: ...
- source_rule mapping: must match project's declared Rule ID format (required on every structured fact row)

## Projection Impact
- Generated target: `<generated-file>`
- Regeneration required: yes/no

## Guard Impact
- Existing checks affected: ...
- New deterministic check needed: yes/no
- Check logic summary: ...

## Verification
1. `<generate-command>`
2. `<consistency-check-command>`
3. `<drift-check-command>`
```

### G4. Migration Template (Doc-style Spec -> Executable Spec)

```md
## Migration Plan
Phase 1: Inventory
- Collect existing normative statements.
- Identify duplicated facts and conflicting definitions.

Phase 2: Kernelization
- Move cross-domain rules into Kernel contracts.
- Assign stable Rule IDs using `<PREFIX>-<AREA>-NNN`.

Phase 3: Structuring
- Convert enumerable facts into Tables.
- Add `source_rule` for every table row (must match the project's declared Rule ID format).

Phase 4: Automation
- Introduce Generate pipeline.
- Introduce Consistency + Drift checks.

Phase 5: Governance
- Define PR evidence policy.
- Define semantic audit cadence and backflow rules.
```

---

## Part H — Anti-Patterns & Red Lines

### H1. Red Lines

1. Manually editing Generated projections.
2. Defining the same fact in multiple locations.
3. Running semantic audit without deterministic guards.
4. Merging changes without evidence chain.
5. Writing execution snapshots into normative spec content.

### H2. Common Anti-Patterns

1. Treating "local green checks" as "global safety".
2. Updating prose but not source facts and guard scripts.
3. Changing rules without updating `source_rule` bindings.
4. Explaining rules by personal memory instead of rule text.

### H3. Evolution Governance (Phase / Deferred / Deprecation)

Recommended policy:

1. `Phase`: Define constraint level (`Draft` / `Normative` / `Frozen`).
2. `Deferred`: Record deferrals, trigger conditions, and review date.
3. `Deprecation`: Define deprecation window, migration path, and removal gate.
4. Every status transition must include evidence and ownership.

---

## Appendix

### Appendix A — Glossary

| Term | Definition |
|---|---|
| Spec-first | Define contracts before implementation |
| Kernel | Cross-domain authoritative rule layer |
| Domain | Domain increment layer |
| Table | Structured fact source |
| Generated | Read-only projections generated from fact source |
| Drift | Mismatch between source facts and projections |
| Consistency | Alignment among rules, facts, and references |
| Evidence | Command outputs and audit records as proof chain |
| Semantic Audit | Non-deterministic semantic review |
| Hard Gate | Check failure blocks merge |
| Soft Gate | Check failure can merge only with risk owner |
| Advisory | Recommendation used for trend tracking and optimization |
| Lane A | Spec -> Impl audit lane |
| Lane B | Impl -> Spec audit lane |

### Appendix B — 90-Day Minimum Adoption Roadmap (L1/L2/L3)

#### L1 (Day 1-30): Build the Skeleton

1. Establish Kernel/Domain/Table/Generated layers.
2. Pilot one core area with `<PREFIX>-<AREA>-NNN` and Table-first flow.
3. Introduce minimum Generate and Drift-check.

#### L2 (Day 31-60): Strengthen Guards

1. Extend consistency checks (references, cross-table, naming).
2. Introduce audit and PR evidence templates.
3. Add blocking guards on high-risk paths.

#### L3 (Day 61-90): Operationalize at Organization Scale

1. Roll out Two-Layer Guard across all domains.
2. Standardize semantic-defect-to-script backflow.
3. Run quarterly reviews: rule coverage, regression rate, change throughput.

### Appendix C — Document Maintenance Rules

1. This document maintains methodology design, not execution snapshots.
2. Version upgrades must state new axioms, flow changes, or template changes.
3. Any new layer or guard mechanism must update Part C/F/G together.
4. Keep examples project-agnostic except when command baselines are explicitly listed.
