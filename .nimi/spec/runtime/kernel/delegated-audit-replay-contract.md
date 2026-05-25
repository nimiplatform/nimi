# Delegated Audit Replay Contract

> Owner Domain: `K-DELEG-*`

Delegated audit and replay are Runtime-owned correlation semantics layered on
top of `K-AUDIT-*`. They do not create a second audit store.

## K-DELEG-085 Delegation Audit Extension

Delegated audit events must use existing Runtime audit storage, retention,
export, and minimum fields from `K-AUDIT-*`.

Delegation-specific payload fields are:

| Field | Type | Required |
|---|---|---|
| `delegation_session_id` | string | conditional |
| `delegation_request_id` | string | conditional |
| `delegation_result_id` | string | conditional |
| `provider_profile_id` | string | conditional |
| `capability_id` | string | conditional |
| `firewall_verdict` | enum | conditional |
| `approval_decision_id` | string | conditional |
| `runtime_decision_id` | string | conditional |
| `projection_event_id` | string | conditional |

These fields belong in the `payload` extension of Runtime audit events.

## K-DELEG-086 Delegation Trace Chain

Replay must be able to join, at minimum:

1. Runtime turn or session id
2. delegated provider profile
3. delegated request
4. delegated result or failure
5. firewall verdict
6. approval decision when applicable
7. Runtime decision
8. final projection or action disposition

Missing join keys must fail replay validation.

## K-DELEG-087 Replay Redaction

Replay may expose redacted output and metadata, but raw credentials,
authorization headers, hidden prompts, and unapproved sensitive provider output
must remain unavailable to SDK/Desktop consumers.

Runtime audit may retain protected evidence according to policy, but replay
views must enforce access and redaction.

## K-DELEG-088 Replay Outcome

Replay outcome values are fixed to:

- `RECONSTRUCTED`
- `PARTIAL_REDACTED`
- `PARTIAL_MISSING_EVIDENCE`
- `BLOCKED_BY_POLICY`
- `INVALID_LINEAGE`

`PARTIAL_MISSING_EVIDENCE` and `INVALID_LINEAGE` are failures for wave closeout
when replay is required evidence.

## K-DELEG-089 Delegation Audit Domain

Delegation audit event `domain` values must use `runtime.delegation` or a
more-specific Runtime-owned subdomain such as `runtime.delegation.firewall`.

No Desktop, Avatar, app, MCP, or A2A audit domain may become the canonical
source for delegated decision lineage.
