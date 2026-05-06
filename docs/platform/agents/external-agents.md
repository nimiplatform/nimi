# External Agents

Nimi treats external AI hosts — a separate AI provider, an
MCP-tooled agent, or a future A2A peer — as first-class
participants. They register as `ExternalPrincipal` entities, hold
scoped tokens, and act through the same Hook Action Fabric as
internal agents.

This page is the product narrative. For the security and
authorization frame, see [Authority Model](/platform/authority-model)
and [AI Last Mile](/platform/ai-last-mile).

## What `ExternalPrincipal` Means

An `ExternalPrincipal` is the platform's typed identity for an
external AI host. It is admitted alongside user, agent, and app
principals as a real participant in the authorization model.

| Property | Value |
| --- | --- |
| Issued through | Desktop External Agent Access panel |
| Token shape | Scoped, single-use plaintext display |
| Token visibility after issue | Immutable token ledger only |
| Capability domains | `action.discover.*`, `action.dry-run.*`, `action.verify.*`, `action.commit.*` |
| Trust tier | `CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` / `BLOCKED` |
| Action surface | Hook Action Fabric (Runtime + Desktop hook capability sandbox) |

The single-use plaintext display is a deliberate choice. The token
is shown once at issue; subsequent visibility is via the ledger.
This means a token cannot be silently exposed by re-rendering the
issue page.

## Capability Domains

A token's scope is defined by capability domains. Each domain
admits its own typed verbs.

| Domain | What it covers |
| --- | --- |
| `action.discover.*` | Read-only discovery — what is available, what is reachable |
| `action.dry-run.*` | Simulate an action without committing — what would happen |
| `action.verify.*` | Confirm a value or condition without mutation |
| `action.commit.*` | Mutate state — actually take an action |

A token can carry any subset. A read-only assistant might have
`discover` + `dry-run`. A more powerful integration might have
`commit` for specific scopes. The platform refuses ambient
"do anything" tokens; scope is always explicit.

## Trust Tiers

Each external principal is admitted under a trust tier:

| Tier | Meaning |
| --- | --- |
| `CONTROLLED_LOCAL` | Most restricted; behavior is local-only and tightly scoped |
| `USER_ADDED_REVIEWED` | User chose this principal explicitly; default for typical hosts |
| `ORG_MANAGED` | An organization has admitted this principal under its policy |
| `BLOCKED` | Explicitly denied; cannot register |

Trust tier shapes the policy snapshot applied to the principal's
delegated session. Approval requirements, sensitivity thresholds,
and quarantine triggers all read from trust tier.

## The Delegated Session

When an external principal wants to act, Runtime opens a
**delegated session** for it.

| Property | Value |
| --- | --- |
| Identity | Typed external principal id |
| Trust tier | From the registration |
| Policy snapshot | Frozen at session open |
| Lifecycle | `OPEN → PAUSED_FOR_APPROVAL → CLOSING → CLOSED|FAILED` |

Within a session, the external principal sends typed delegation
requests:

| Request | Purpose |
| --- | --- |
| `OBSERVE` | Report an observation |
| `QUERY` | Ask a typed question |
| `SUGGEST_INTENT` | Propose an intent |
| `SUGGEST_TOOL_REQUEST` | Propose a tool call |
| `SUGGEST_PRESENTATION` | Propose a presentation update |
| `CREATE_ARTIFACT` | Propose creating an artifact |
| `CONTROLLED_TEST` | Run a controlled, sandboxed test |

Notice that **all of these are suggestions or observations, not
actions**. The result of an external request is quarantined
evidence, not a mutation.

## The Output Firewall

Every result from an external principal passes through the output
firewall before Runtime acts on it.

The firewall validates:

- **Schema** — does the result match its declared shape?
- **Provenance** — where did this result come from?
- **Descriptor hash** — does the principal's declared capability
  match its current behavior, or has it drifted?
- **Sensitivity classification** — `USER_PRIVATE` /
  `CREDENTIAL_LIKE` / `ORG_PRIVATE` / `REGULATED` /
  `UNKNOWN_SENSITIVE`.
- **Prompt poisoning detection** — has the result been crafted to
  manipulate downstream behavior?

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

A suggested tool call **never** directly executes. Runtime
re-authorizes and emits a Runtime-owned action with independent
audit lineage.

## Reader Scenario: Adding An External AI Host

A user wants to grant an external AI host bounded access to their
Nimi account.

1. **Open the External Agent Access panel.** This panel is the
   only place external principal tokens are issued.
2. **Choose capability domains.** The user picks
   `action.discover.contacts`, `action.dry-run.message_compose`,
   and excludes `action.commit.*` for messaging.
3. **Issue.** The panel issues a scoped token with one-time
   plaintext display. The user copies the token to the external
   AI host's configuration.
4. **Ledger.** Subsequent visibility is via the immutable token
   ledger. The user can revoke at any time; revocation is
   recorded.
5. **External AI is now a registered principal.** It can act
   within its scope.

Note: the user did not paste a credit card number into the
external AI. The token does not authorize wallet operations because
the user did not include `action.commit.gift` or any wallet
domain.

## Reader Scenario: An External AI's Suggestion Is Quarantined

An external AI sends a `SUGGEST_TOOL_REQUEST` to invoke a tool that
operates on credentials.

1. **Output firewall classifies** the result. Sensitivity:
   `CREDENTIAL_LIKE`.
2. **Verdict.** Trust tier and policy snapshot say credential-like
   results from this principal must be quarantined.
3. **Quarantine.** The result is held; Runtime doesn't use it as
   context, does not propagate it to the user, does not act on it.
4. **Audit.** The quarantine is recorded with reason and lineage.

The external AI cannot route around this. The firewall is between
the external principal and any platform action.

## Reader Scenario: Provider Drift Triggers Quarantine

An external AI's descriptor hash changes mid-session — perhaps the
underlying provider updated its tool descriptor.

1. **Firewall detects mismatch.** The session's declared descriptor
   no longer matches what is now reported.
2. **`PROVIDER_DRIFTED` verdict.** The session enters
   `PAUSED_FOR_APPROVAL` or moves toward `CLOSED|FAILED` per
   policy.
3. **User sees the reason.** "External AI's descriptor changed
   mid-session; you may re-admit or revoke."
4. **No silent continuation.** The platform does not pretend the
   drift did not happen.

This is what makes external AI integration a real product feature
rather than an integration risk. Drift is detected and surfaced
explicitly.

## Source Basis

- [`.nimi/spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-agent-security-interface.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-approval-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-approval-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-mcp-adapter-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-a2a-future-seam-contract.md)
- [`.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-provider-profiles.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-request-fields.yaml)
- [`.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/delegation-result-fields.yaml)
- [`.nimi/spec/desktop/external-agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/external-agent.md)
