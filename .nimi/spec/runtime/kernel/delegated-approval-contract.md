# Delegated Approval Contract

> Owner Domain: `K-DELEG-*`

Delegated approval is a Runtime-owned pause/resume decision contract. Desktop
may render the review surface, but Runtime owns approval state and action
admission.

## K-DELEG-090 Approval Authority

Runtime owns delegated approval policy, pending approval state, approval
decision state, resume semantics, rejection semantics, and audit linkage.

Desktop owns only approval review UX. Protocol adapters do not own approval
semantics.

## K-DELEG-091 Approval Request

Approval requests must include:

| Field | Type | Required |
|---|---|---|
| `approval_request_id` | string | yes |
| `delegation_request_id` | string | yes |
| `agent_id` | string | yes |
| `effect_class` | enum | yes |
| `sensitivity_class` | enum | yes |
| `provider_profile_id` | string | yes |
| `capability_id` | string | yes |
| `summary_ref` | string | yes |
| `policy_snapshot_id` | string | yes |
| `created_at` | timestamp | yes |

`summary_ref` must point to Runtime-reviewed approval copy. It must not expose
raw provider output that has not passed firewall review.

## K-DELEG-092 Approval Decision

Approval decision values are fixed to:

- `APPROVED_ONCE`
- `REJECTED`
- `APPROVED_FOR_SESSION`
- `POLICY_BLOCKED`
- `EXPIRED`

`APPROVED_FOR_SESSION` is valid only when Runtime policy allows session-scoped
approval for the exact provider, capability, effect class, and policy snapshot.

## K-DELEG-093 Approval Resume

Runtime may resume a paused delegated request only when:

- approval request id matches the paused request
- policy snapshot is still valid
- provider descriptor hash has not drifted
- request effect class has not changed
- user or administrative principal is authorized

If one condition fails, Runtime must reject or regenerate the approval request.

## K-DELEG-094 Approval Expiry

Every pending approval must have an expiry. Expired approvals transition to
`EXPIRED` and cannot be resumed.

## K-DELEG-095 Approval Audit

Every approval request and decision must link to:

- `delegation_request_id`
- `provider_profile_id`
- `capability_id`
- `policy_snapshot_id`
- principal id
- audit trace id

Approval audit uses `K-AUDIT-*` storage with `K-DELEG-*` payload fields.

## K-DELEG-096 Approval UI Boundary

Desktop approval UI may display summary, risk, provider, capability, effect
class, sensitivity, and retry options. It must submit a typed approve/reject
decision to Runtime and must not mutate provider policy, credential custody, or
request payload directly.

## K-DELEG-097 Approval Rejection

Rejected approvals must produce an observable delegation failure or rejected
suggestion. Runtime must not continue the same delegated request by silently
removing the risky operation.

## K-DELEG-098 Programmatic Approval

Programmatic approval may exist only as Runtime policy. Desktop, SDK,
protocol adapters, apps, mods, and Avatar cannot auto-approve delegated
requests by local convention.

## K-DELEG-099 Approval Projection

SDK and Desktop may consume approval projection as typed Runtime state:

- pending approval list
- approval detail
- approval decision result
- approval failure

Approval projection is not policy truth. Runtime policy remains canonical.
