# Cognition

> Status: Running today. Cognition is a standalone authority domain
> (`C-COG-*`); the runtime bridge is the admitted consume seam.

Cognition owns memory, knowledge, prompt serving, references,
completion, skill service, runtime-bridge behavior, and capability
upgrades. It's a standalone authority domain.

Runtime can talk to Cognition through a defined bridge. It can't absorb
Cognition's authority — only consume it.

For depth on the surfaces:

- [Memory + Knowledge Composition](/cognition/memory-knowledge-composition) — why two services, how they compose
- [Prompt Lanes](/cognition/prompt-lanes) — lane separation + serving rules
- [Skill Artifacts](/cognition/skill-artifacts) — validated advisory bundles + non-ownership boundary
- [Reference Graph](/cognition/reference-graph) — refgraph explainability for cleanup decisions

## Why Cognition Is Separate

Long-lived AI systems need more than transient model calls. They need
memory across sessions, knowledge retrieval, prompt serving, references,
completion gates, and upgrade paths. Those concerns are broad enough to
need their own authority home.

Keeping Cognition separate prevents Runtime or Realm from becoming
overloaded with memory and knowledge semantics that belong elsewhere.
It also makes the bridge explicit: Runtime consumes Cognition under a
defined contract instead of absorbing it.

## What Cognition Owns

Cognition owns:

- memory service contracts (long-lived participant memory);
- knowledge service contracts (retrievable structured information);
- prompt serving (authoritative prompt templates and serving lanes);
- references and completion gates;
- runtime bridge contracts (how Runtime is allowed to consume
  Cognition);
- runtime upgrade contracts (how capability upgrades flow without
  redefining authority).

## What Cognition Does Not Own

Cognition doesn't own runtime execution, Realm world truth, the
Desktop shell, or Avatar presentation. It exposes a standalone surface
that Runtime can bridge to; the bridge is consumption, not absorption.

## Reader Scenario: An Agent Recalling A User Across Sessions

Suppose an agent meets a user, and the next day the user comes back.
Under Cognition contracts:

1. Cognition's memory service holds the relevant memory under
   admitted bank scopes.
2. When the new session starts, Runtime calls Cognition through the
   admitted bridge to resolve the relevant memory.
3. Cognition returns memory under the bridge contract; Runtime
   consumes it without redefining what memory is.
4. The agent's behavior in the new session is shaped by that memory
   under runtime-owned agent participation contracts.

The cross-domain choreography is bounded. No surface invents memory
that is not in Cognition; no surface stops being itself because of the
bridge.

## Reader Scenario: A Knowledge-Backed Completion

Suppose an agent needs to consult retrievable knowledge before
completing a turn. Under Cognition's knowledge service:

1. The knowledge service is queried under its admitted contract.
2. The retrieved knowledge participates in the completion as input
   evidence.
3. The completion contract gates how the result is allowed to be
   used.
4. The runtime bridge keeps Runtime's role as execution and
   Cognition's role as knowledge authority cleanly separated.

If the result was wrong because the knowledge was stale, the fix is
in Cognition, not in Runtime. If the result was wrong because the
completion was poorly governed, the fix is in the completion contract,
not in the knowledge service.

## Source Basis

- [`.nimi/spec/cognition/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/surface-contract.md)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)
- [`.nimi/spec/cognition/kernel/completion-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/completion-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-upgrade-contract.md)
