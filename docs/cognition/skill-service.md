# Skill Service

Cognition Skill Service is the typed authority for skill
artifacts — capability blueprints expressed as ordered steps with
typed inputs and known references. It is the **advisory** family
that gives an agent reusable patterns of doing things.

## What A Skill Is

| Property | Value |
| --- | --- |
| Type | Advisory artifact (not core truth) |
| Shape | Ordered steps |
| Input typing | Typed |
| References | Known refs to other artifacts |
| Lifecycle | Save / list / load / lexical-search / explicit-delete / history |
| Validation | Non-empty step validation; reference target check |

A skill is **not** model state. It is a typed bundle that
describes "to do X, follow these steps." The agent can search,
load, and follow skills.

## Why Skills As Typed Bundles

A model that hallucinates "the right way to do X" might be wrong.
A model that consults a typed skill bundle gets a vetted pattern
authored under admitted contracts. The agent's reliability
benefits.

| Benefit | What it gives |
| --- | --- |
| Reusability | Agent reuses tested patterns instead of re-deriving |
| Auditability | The skill bundle is typed; what the agent did is reconstructible |
| Cleanup | Stale skills can be archived under digest |
| Cross-session | Skills travel with the agent |

## Skill Operations

| Operation | Behavior |
| --- | --- |
| `Save` | Save a typed skill bundle |
| `Load` | Load by id |
| `List` | List under typed filter |
| `LexicalSearch` | Search by lexical query |
| `Delete` | Explicit destructive delete |
| History | Read history of this skill |

## Reference Validation

A skill bundle's references must point to admitted targets.

| Check | What it does |
| --- | --- |
| Reference target exists | Yes — fail-closed if missing |
| Cross-scope reference | Forbidden — fail-closed |
| Type compatibility | Reference type matches expected |

A skill that references a non-existent or cross-scope artifact
fails validation at save time. There is no silent acceptance of
broken references.

## Reader Scenario: An Agent Saves A New Skill

An agent has learned a useful pattern through interaction with
a user.

1. **Compose skill bundle.** Ordered steps, typed inputs,
   references to relevant memory / knowledge artifacts.
2. **Submit Save.** Skill service receives.
3. **Validate.**
   - Non-empty step validation.
   - Reference target check (each ref must exist in scope).
4. **Admitted.** Skill is saved with typed shape.
5. **Service-derived metadata.** Support, lineage.
6. **Available for future use.** Agent can search / load.

The skill is now part of the agent's typed advisory bundle
collection.

## Reader Scenario: An Agent Searches For A Skill

An agent is about to do something it has done before.

1. **Lexical search.** `SkillService.LexicalSearch` with query.
2. **Service returns matches.** Typed skill bundles matching.
3. **Agent loads top match.** Reads the typed steps.
4. **Agent follows the pattern.** Ordered steps drive reasoning;
   the agent reuses the pattern.

The agent did not have to re-invent. It consulted the typed
skill.

## Reader Scenario: A Skill With A Stale Reference

A skill bundle references a knowledge page that has since been
deleted.

1. **Refgraph reasoning.** The skill's outgoing reference is
   broken.
2. **Digest pass.** Identifies the broken ref as a candidate
   for cleanup.
3. **Archive proposed.** Skill is archived (reversible).
4. **User can restore.** If the user restores the missing
   knowledge page (or amends the skill to remove the ref), the
   skill can be unarchived.
5. **Or proceed to remove.** Later digest pass may remove the
   archived skill.

Cleanup is **explainable** — refgraph reasoning gives "why."

## Why Skills Stay Advisory

Skills are advisory, not core truth. They cannot demote kernel
truth.

| Concern | Why advisory matters |
| --- | --- |
| Skill says X | Model may consider, may override under reasoning |
| Kernel says Y | Inviolate truth |
| Conflict | Kernel wins; skill cannot demote kernel |

A buggy or out-of-date skill cannot corrupt kernel truth. The
kernel primacy is structural.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Skill bundle storage | Cognition Skill Service |
| Validation | Service-side under completion gates |
| Reference graph | Refgraph |
| Cleanup | Digest + explicit delete |
| Truth weight | Advisory (not core) |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope cognition`
