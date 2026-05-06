# AI Last Mile

The AI last mile is the bridge between an AI agent's intent and a
real action on the platform. It is where a model says "send a gift"
and the platform either does it, asks the user, or refuses — under
explicit, audited contracts.

This page introduces the **Hook Action Fabric**, the unified action
surface for both internal Nimi agents and external AI hosts.

## What Problem It Solves

Most AI products solve the last mile by having the AI simulate a
human: it clicks buttons through a screen-control surface, types
into form fields, drags windows. That works as a demo and breaks as
a platform — there is no audit, no scope, no consent model, and the
platform cannot tell the difference between a real user click and a
synthetic one.

Nimi takes the opposite stance: AI agents call typed capability APIs
that are designed for them. Action is a first-class admitted
operation, not a screen click pretending to be one.

## What The Hook Action Fabric Is

The Hook Action Fabric is built from Runtime + Desktop's hook
capability sandbox. Together they provide:

- **Typed action verbs.** Each admitted capability domain has its
  own action API (`action.discover.*`, `action.dry-run.*`,
  `action.verify.*`, `action.commit.*`).
- **Minimum-privilege scoped authorization.** Tokens carry an
  explicit scope; capability is what the scope says, not what the
  agent wants.
- **Control plane / data plane split.** Authorization decisions
  live in the control plane; the data plane follows the
  control plane's verdict.
- **Fail-closed by default.** A capability that is not admitted is
  not available. Unknown verbs do not silently fall back to a
  generic action.

For an agent, this means: ask for the typed verb you actually need,
under your token's scope, and get either a real result or a typed
refusal.

## Internal Agents And External Agents

The Hook Action Fabric is the same surface for both. An agent that
ships inside Nimi (life-track or chat-track) and an external AI host
(via `ExternalPrincipal`) both call typed capabilities; both pass
through the firewall; both leave audit lineage.

The difference is policy:

| Factor | Internal Agent | External Principal |
| --- | --- | --- |
| Trust tier | Bound to user's account by default | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| Token shape | Runtime-issued with admitted scope | Single-use plaintext display + immutable ledger |
| Approval policy | Set by user preference | Set by user preference + capability sensitivity |
| Audit lineage | Recorded under runtime audit | Recorded with delegation lineage extension |

The capability surface is identical. Only the trust tier and
approval policy differ.

## Reader Scenario: An External AI Suggests Sending A Gift

You added an external AI host as a delegated principal. It suggests
sending a gift to a friend.

1. **Suggestion arrives.** The external AI sends a typed delegation
   request: `SUGGEST_INTENT { action: gift.send, recipient: ..., item: ... }`.
2. **Output firewall validates.** The firewall checks schema,
   provenance, and descriptor hash. It classifies sensitivity. It
   detects prompt poisoning. It derives an approval requirement.
3. **Verdict.** The firewall emits one of: `ACCEPTED_OBSERVATION`,
   `ACCEPTED_SUGGESTION`, `APPROVAL_REQUIRED`, `QUARANTINED`,
   `REJECTED`, `PROVIDER_DRIFTED`, `SCHEMA_INVALID`,
   `POLICY_BLOCKED`. For a gift, `APPROVAL_REQUIRED` is typical.
4. **Approval prompt.** Desktop shows a typed approval card —
   "external AI X suggests sending gift Y to Z." You approve or
   deny.
5. **Runtime acts.** If approved, Runtime — not the external AI —
   issues the gift commit through Realm. The action's audit
   lineage links back to the original suggestion, the firewall
   verdict, and your approval.

The external AI never directly mutates Realm. It proposes; Runtime
re-authorizes; you consent; Runtime commits. The chain is what
makes the suggestion safe.

## Reader Scenario: An Internal Agent Wants To Schedule Itself

An internal agent on the Life Track wants to remind itself to
follow up tomorrow.

1. **Hook intent.** The agent emits a typed `HookIntent` —
   "follow up at T+24h."
2. **Runtime validates.** Runtime checks the intent against the
   admitted hook contract and the agent's life-track token budget.
3. **Admission.** If admitted, the intent enters the hook
   lifecycle: `pending → running → completed | failed | canceled |
   rescheduled | rejected`.
4. **Future fire.** When the time arrives, the hook fires under
   Runtime's scheduling. The agent's life-track is invoked under
   its admitted cadence and budget.

Notice what the agent did not do: it did not write its own scheduler;
it did not invent a free-form scheduling string; it did not bypass
the budget. The hook intent contract is the typed action verb for
"schedule yourself."

## Why "Typed Verbs Not Synthetic Clicks"

| Concern | What typed verbs give you |
| --- | --- |
| Audit | Every action is a typed event with structured lineage |
| Scope | Capability is bounded by token scope, not whatever the screen exposes |
| Consent | Sensitive actions get typed approval prompts, not arbitrary "are you sure?" dialogs |
| Provider drift | Descriptor hash mismatch quarantines the session; synthetic clicks have no descriptor |
| Reproducibility | Replay can re-derive the action from the typed log |
| Policy | Trust tier and policy snapshot apply to every action; no privilege escalation by clicking |

A platform that gives AI synthetic-click access has no answer for
any of these. A platform that gives AI typed action verbs answers
all of them by construction.

## Source Basis

- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
