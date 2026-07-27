# Skill Artifacts

## Status: Admitted Contract; Release-Gated Surface

The skill service operation registry, lifecycle semantics, and
non-ownership boundary (`C-COG-056..C-COG-058`) are admitted at the
kernel level. Cross-app consumers should use this only when Cognition exposes
the corresponding public API.

## What A Skill Artifact Is

A **skill artifact** in cognition is a validated advisory bundle —
a named, ordered sequence of steps that the agent can use as a
playbook for a particular task. Skills are local to a cognition
scope; they participate in prompt serving and digest cleanup but
do not own runtime execution.

Skills are deliberately **advisory**, not executable. Cognition
does not absorb runtime workflow execution.

## Operation Registry

The authority surface:

| Concern | Authority |
| --- | --- |
| Operation registry | `tables/skill-service-operations.yaml` |
| Operation rules | `C-COG-056` |
| Lifecycle + retrieval rules | `C-COG-057` |
| Non-ownership boundary | `C-COG-058` |

Every admitted skill service operation must:

- Appear in the registry exactly once
- Declare admitted inputs, identity invariants, validation posture,
  retrieval posture, lifecycle effects, derived-view behavior,
  fail-closed reasons, non-ownership boundary

Skill capability admission must be grounded in this registry; it
cannot be inferred from envelope shape or package naming.

## Lifecycle Semantics (C-COG-057)

| Operation | Constraint |
| --- | --- |
| Save / update | Explicit semantics for **one bundle in one cognition scope** |
| Validation | Validated bundles must require non-empty ordered steps; fail-close on duplicate step identity, duplicate order, illegal refs, illegal scope crossing |
| Delete | Explicit delete semantics required for skill ownership |
| Digest-triggered transitions | Stay archive/remove outcomes; not hidden hard delete |
| List / search | Exclude removed bundles by default |
| Load / history | Keep removed lifecycle outcomes explicitly observable until explicit delete |
| History exposure | Created, updated, archived, removed, deleted transitions explicit (clients should not infer lifecycle from current bundle snapshot) |

## Non-Ownership Boundary (C-COG-058)

The most important boundary on this page:

> Standalone cognition skill remains separate from runtime execution
> orchestration.

| Skill DOES NOT own | Owner |
| --- | --- |
| Runtime scheduler truth | Runtime |
| Provider / tool routing | Runtime |
| Automation execution policy | Runtime |
| Control-plane state | Runtime |

Standalone skill lifecycle and retrieval semantics do **not**
authorize cognition to absorb runtime execution-policy or workflow
ownership. Validated skill artifacts may participate in prompt
serving and digest cleanup; that participation does not make
cognition a runtime automation owner.

## Reader Scenario: An Agent Saves A Skill

A user teaches their agent a multi-step procedure. The agent
captures it as a skill bundle.

1. **Save operation.** Skill service `Save` operation invoked per
   the registry.
2. **Validation.** Bundle must have non-empty ordered steps. Step
   identity unique. Step order unique. Refs legal. Scope crossing
   not present.
3. **Persisted in cognition scope.** Bundle lives under the
   cognition scope (per-agent + per-context per admitted scoping).
4. **Available to prompt serving.** Skill participates as advisory
   artifact through the admitted prompt lane (see
   [Prompt Lanes](/cognition/prompt-lanes)).
5. **Not executed by cognition.** When a turn wants to "follow the
   skill," runtime is the execution authority — cognition supplied
   the playbook, runtime ran it.

## Reader Scenario: Skill History Visibility

A user wants to see what's happened to a skill bundle over time.

1. **History query.** Skill service exposes the lifecycle
   transitions: `created → updated → archived → removed → deleted`.
2. **Each transition explicit.** Clients see when the bundle was
   archived vs removed vs deleted; they do not infer lifecycle from
   "is this currently in the list?"
3. **Removed but not deleted.** A removed bundle stays observable
   in history until an explicit delete; the user can recover it
   before that.

## Reader Scenario: Cognition Tries To Decide Workflow

A maintainer proposes letting cognition decide when to run a skill
end-to-end.

1. **Reject.** Per `C-COG-058`, skill ownership does not include
   runtime scheduler / provider routing / execution policy.
2. **Re-route.** Runtime workflows (`workflow_*` API) are the
   execution surface; cognition contributes the skill bundle as
   advisory input.
3. **Boundary preserved.** Cognition stays the cognition authority;
   runtime stays the execution authority.

## Reader Scenario: A Validation Failure

A caller tries to save a bundle with two steps having the same step
identity.

1. **Validation fails.** Duplicate step identity is fail-close.
2. **No partial save.** The bundle is not persisted with one of the
   duplicates dropped silently.
3. **Caller sees typed reason.** Duplicate step identity reason code
   surfaces.

## What Skill Artifacts Do Not Do

- They are not executed by cognition.
- They do not own scheduler / provider routing / control-plane
  state.
- They are not silently demoted to fit a less-strict lifecycle.
- They do not validate by "best-effort accept what looks reasonable"
  — fail-close on identity / order / ref / scope violations.
- They do not let `list` or `search` quietly include removed
  bundles.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Operation registry rules | `C-COG-056` + `tables/skill-service-operations.yaml` |
| Lifecycle, retrieval, history | `C-COG-057` |
| Non-ownership boundary | `C-COG-058` |
| Family system that skill participates in | `cognition/kernel/family-contract.md` + `tables/artifact-families.yaml` |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
