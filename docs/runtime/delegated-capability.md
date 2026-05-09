# Delegated Capability

> Status: Running today. Runtime delegated session, gateway,
> output firewall, and audit / replay extension are shipped under
> `K-DELEG-*`. MCP adapter ships at `stdio_command`; remote
> transports admitted as direction.

Runtime owns the gateway and the output firewall through which
external AI hosts (a separate AI provider, an MCP-tooled agent, a
future A2A peer) take action on the platform. This page covers the
runtime side of delegation. For the product framing, see
[Platform → AI Last Mile](/platform/ai-last-mile),
[Platform → Execution Protocol](/platform/execution-protocol), and
[Runtime → MCP Integration](/runtime/mcp-integration).

## The Delegated Session

When an external AI wants to act, Runtime opens a **delegated
session** for it. The session has typed identity, a trust tier, a
policy snapshot, and a defined lifecycle.

| Property | Value |
| --- | --- |
| Identity | Typed external principal id |
| Trust tier | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| Policy snapshot | Frozen at session open |
| Lifecycle | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

The trust tier shapes the policy snapshot. Approval requirements,
sensitivity thresholds, and quarantine triggers all read from the
trust tier.

## Provider Lifecycle

External provider lifecycle is admitted at runtime:

| State | Meaning |
| --- | --- |
| `REGISTERED` | Provider admitted into the system |
| `DISCOVERING` | Capability discovery in progress |
| `READY` | Provider is healthy and reachable |
| `DEGRADED` | Provider is reachable with reduced reliability |
| `DISABLED` | Provider explicitly disabled |
| `QUARANTINED` | Provider quarantined due to drift or policy violation |
| `REMOVED` | Provider removed |

A provider that drifts (descriptor hash changes mid-session) is
moved to `QUARANTINED` automatically. There is no silent
continuation across drift.

## Typed Delegation Requests

The external AI sends typed delegation requests:

| Request | Purpose |
| --- | --- |
| `OBSERVE` | Report an observation |
| `QUERY` | Ask a typed question |
| `SUGGEST_INTENT` | Propose an intent |
| `SUGGEST_TOOL_REQUEST` | Propose a tool call |
| `SUGGEST_PRESENTATION` | Propose a presentation update |
| `CREATE_ARTIFACT` | Propose creating an artifact |
| `CONTROLLED_TEST` | Run a controlled, sandboxed test |

All of these are **suggestions or observations, not actions**. The
result is quarantined evidence; it does not directly mutate state.

## The Output Firewall

The result of any external request is **not action**. It is
quarantined evidence that passes through the **output firewall**
before Runtime acts on it.

The firewall validates:

| Check | What it does |
| --- | --- |
| Schema | Does the result match its declared shape? |
| Provenance | Where did this result come from? |
| Descriptor hash | Does the principal's declared capability match its current behavior? |
| Sensitivity classification | `USER_PRIVATE` / `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` / `UNKNOWN_SENSITIVE` |
| Prompt poisoning | Has the result been crafted to manipulate downstream behavior? |
| Streaming chunk integrity | Quarantine streaming chunks until the full envelope is admitted |

The firewall is **fail-closed admission**. Anything that fails any
of these checks does not pass.

## Firewall Verdicts

The firewall emits one of:

| Verdict | Meaning |
| --- | --- |
| `ACCEPTED_OBSERVATION` | Runtime may use this as context |
| `ACCEPTED_SUGGESTION` | Runtime decides whether to act, ask for approval, or ignore |
| `APPROVAL_REQUIRED` | Specifically gated on user approval |
| `QUARANTINED` | Held without further use |
| `REJECTED` | Refused outright |
| `PROVIDER_DRIFTED` | Descriptor hash does not match expected; session quarantined |
| `SCHEMA_INVALID` | Schema validation failed |
| `POLICY_BLOCKED` | Trust tier or policy blocks this result |

These verdicts are observable to the user (in approval prompts) and
to the audit ledger (in lineage records).

## Re-authorization For Action

A suggested tool call **never** directly executes. Runtime
re-authorizes and emits a Runtime-owned action with independent
audit lineage.

| Step | Owner |
| --- | --- |
| 1. External AI proposes (e.g., `SUGGEST_TOOL_REQUEST`) | External AI |
| 2. Output firewall validates | Runtime |
| 3. If approved, Runtime acts | Runtime |
| 4. Action's audit lineage references the original suggestion | Runtime audit |

The action is Runtime-owned, not external-AI-owned. Provenance is
mandatory; an external AI can't bypass into the data plane.

## Delegated Approval

When the firewall verdict is `APPROVAL_REQUIRED`, the user (or
admitted approver under the policy) must approve before the action
proceeds. The approval is recorded as evidence.

| Approval flow | Runtime |
| --- | --- |
| Approval request | Surfaced to user via Desktop |
| Approval decision | Recorded against the session |
| Resume | Session resumes from `PAUSED_FOR_APPROVAL` |

## Delegated MCP Adapter

Runtime admits MCP (Model Context Protocol) tools as a particular
kind of delegated capability. The MCP adapter has its own lifecycle:

| Property | Value |
| --- | --- |
| Tool discovery | Bounded under MCP adapter contract |
| Allowlist | Tools must be allowlisted before use |
| Token hygiene | Per-session token rotation |
| Quarantined gateway evidence | All tool calls treated as quarantined evidence first |

The MCP adapter does **not** allow pre-firewall consumption — every
tool call goes through the output firewall.

## Delegated A2A (Future)

A2A (Agent-to-Agent) protocols are admitted as a **future seam
only**. There is no production A2A support today; the seam is
admitted to prevent app/Desktop/Avatar/mod bypass shortcuts that
would later collide with real A2A.

| Property | Value |
| --- | --- |
| Production support | None |
| Protocol authority promotion | Forbidden |
| Bypass paths | Forbidden |

## Audit And Replay

Every delegation request, every firewall verdict, every action,
every approval is recorded in the delegation audit / replay
extension on top of `K-AUDIT-*` storage.

| Lineage element | Purpose |
| --- | --- |
| Suggestion id | Links to the original delegation request |
| Firewall verdict | Records what the firewall decided |
| Approval decision | Records user/admitted-approver decision |
| Action lineage | Links to the Runtime-owned action |

Replay can reconstruct the chain. There are no silent shortcuts.

## Reader Scenario: An External AI Suggests A Tool Call

1. **Suggestion arrives.** External AI sends
   `SUGGEST_TOOL_REQUEST` with typed tool descriptor.
2. **Firewall validates.** Schema, provenance, descriptor hash,
   sensitivity, prompt poisoning checks.
3. **Verdict.** Sensitivity is `USER_PRIVATE`; trust tier is
   `USER_ADDED_REVIEWED`; verdict is `APPROVAL_REQUIRED`.
4. **Approval prompt.** Desktop surfaces the approval prompt to
   the user.
5. **User approves.** Approval is recorded.
6. **Runtime acts.** Runtime executes the typed tool action under
   its own audit lineage.
7. **Audit chain.** Lineage links suggestion → verdict →
   approval → action.

The external AI did not directly press the tool. Runtime did, on
the user's behalf.

## Reader Scenario: Provider Drift Quarantines A Session

1. **Session active.** External AI is in `OPEN` state.
2. **Mid-session, descriptor changes.** The provider's tool
   descriptor hash differs from session-open value.
3. **Firewall detects drift.** Verdict: `PROVIDER_DRIFTED`.
4. **Provider lifecycle.** Provider state moves to
   `QUARANTINED`.
5. **Session moves to `PAUSED_FOR_APPROVAL` or `CLOSING`** per
   policy.
6. **User sees the reason.** "Provider X's descriptor changed
   mid-session."
7. **No silent continuation.** The platform does not pretend the
   drift did not happen.

## Source Basis

- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md)
- [`.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-reason-codes.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-protocol-adapters.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-protocol-adapters.yaml)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
