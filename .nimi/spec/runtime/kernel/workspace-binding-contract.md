# Workspace Binding Contract

> Owner Domain: `K-BIND-*`

## K-BIND-016 Workspace Knowledge Binding Authority

Workspace binding is a Runtime-issued, workspace-specific, non-secret
attachment/relation family for WORKSPACE_PRIVATE knowledge access. It is
separate from Avatar / agent scoped app binding.

Fixed rules:

- workspace binding issue/revoke authority is owned by
  `RuntimeAccountService`; public `IssueWorkspaceBinding` and
  `RevokeWorkspaceBinding` RPC projection is admitted only for workspace
  binding attachment mint/revoke and must not expose resolver/probe semantics
- workspace binding exists only for `purpose = workspace.knowledge.consume`
- workspace binding must not be accepted for Avatar, agent, app messaging,
  world, grant, Realm REST, or direct account-token access
- Avatar / agent scoped binding relation semantics must not be broadened to
  satisfy WORKSPACE_PRIVATE knowledge authorization
- the attachment is a non-secret selector, not a token, not a Realm credential,
  and not subject/account truth

## K-BIND-017 Workspace Binding Relation And Attachment

The admitted workspace binding relation is:

| Field | Requirement |
|---|---|
| `binding_id` | Runtime-issued opaque id |
| `runtime_app_id` | required; Runtime-authenticated caller app id |
| `app_instance_id` | required; Runtime-authenticated caller app instance id |
| `device_id` | required; Runtime-derived device identity |
| `account_id` | required; Runtime account custody projection |
| `realm_environment_id` | required; Runtime account projection environment |
| `workspace_id` | required; target Realm-owned workspace membership key |
| `purpose` | exactly `workspace.knowledge.consume` |
| `scopes` | subset of admitted runtime knowledge scopes |
| `issued_at` / `expires_at` | required; active binding cannot be durable |
| `state` / `reason_code` | required lifecycle state and last reason |

The admitted `KnowledgeRequestContext` workspace binding attachment may contain
only:

- `binding_id`
- optional `binding_handle`
- `runtime_app_id`
- `app_instance_id`
- `workspace_id`
- optional `realm_environment_id`

It must not contain `account_id`, `device_id`, Realm token, Runtime app session
token, refresh token, raw JWT, decoded subject, `subject_user_id`, or
membership proof material.

## K-BIND-018 Workspace Binding Issue And Revoke Lifecycle

The workspace binding issue path must:

- require Runtime-authenticated caller app identity
- require account state `authenticated`
- validate caller `runtime_app_id`, `app_instance_id`, `device_id`,
  `account_id`, and `realm_environment_id` from Runtime-owned context
- validate target `workspace_id` against an active `K-ACCSVC-018` membership
  projection
- require a non-empty scope set from the admitted runtime knowledge scope
  vocabulary
- mint only a workspace binding attachment and redacted binding audit/event
  evidence

The workspace binding revoke path must:

- require Runtime-authenticated caller app identity
- validate caller ownership of the stored workspace binding relation
- revoke the binding idempotently
- emit `binding.revoked` with a typed reason

Workspace bindings must have short TTLs, must not survive daemon restart, and
must not be persisted as active capabilities. Implementations may retain a
redacted ledger for audit/restart evidence, but that ledger must not be
accepted as active binding state.

## K-BIND-019 Internal Workspace Binding Resolver

`ResolveWorkspaceBinding` is an internal account-owned resolver seam. It is not
a public RPC.

Resolver input must include:

- Runtime-authenticated caller identity from the protocol envelope: app id from
  `x-nimi-app-id`, app instance id from `x-nimi-app-instance-id`, and device
  identity derived or verified through Runtime account/app registry state
- workspace binding attachment
- target workspace id from the knowledge bank owner
- required knowledge scopes
- knowledge action name for audit

Resolver decisions are:

- `ALLOW`
- `DENY_MISSING_ATTACHMENT`
- `DENY_MALFORMED_ATTACHMENT`
- `DENY_NOT_FOUND`
- `DENY_REVOKED`
- `DENY_EXPIRED`
- `DENY_REPLAY`
- `DENY_ACCOUNT_UNAVAILABLE`
- `DENY_CALLER_MISMATCH`
- `DENY_WORKSPACE_MISMATCH`
- `DENY_ENV_MISMATCH`
- `DENY_DEVICE_MISMATCH`
- `DENY_SCOPE_MISSING`

Positive allow requires all of:

- account state is `authenticated`
- active workspace membership projection exists at consume time
- binding exists, is active, and is not expired
- relation purpose is `workspace.knowledge.consume`
- caller app, app instance, device, account, and realm environment match the
  stored relation
- attachment workspace id equals the target bank owner workspace id
- required scopes are covered by the relation scopes

Any mismatch fails closed. Resolver must not make synchronous Realm membership
lookups for every knowledge RPC and must not delegate truth to SDK/Desktop/app
cache.

## K-BIND-020 Workspace Binding Revocation And Restart

Workspace bindings must revoke or become invalid on:

- logout
- account switch
- membership loss
- realm environment change
- custody unavailable
- refresh failure / reauth required
- account expiration
- device mismatch
- scope change
- replay detection
- policy revocation
- daemon restart

Daemon restart posture is memory-only not-found for active state. If a redacted
ledger exists, it may emit `binding.revoked` evidence with reason
`daemon_restart_no_recovery`, but old workspace binding ids must never become
active again after restart.

## K-BIND-021 Workspace Binding Audit

Workspace binding issue, revoke, expire, replay, and resolver-deny decisions
must write audit evidence. Minimum fields:

- `binding_id`
- `runtime_app_id`
- `app_instance_id`
- `device_id`
- `account_id`
- `realm_environment_id`
- `workspace_id`
- `knowledge_action` when consumed through knowledge authorization
- `required_scopes`
- `decision`
- `reason_code`
- `action_hint`
- `event_sequence`

Audit must not record attachment handles as secrets, token values, raw JWT,
decoded subject, refresh material, or caller-supplied subject proof.

## K-BIND-022 Workspace Binding Fail-Close Matrix

Workspace binding must fail closed for missing attachment, malformed
attachment, unknown binding id, revoked binding, expired binding, replay,
account unavailable, caller mismatch, workspace mismatch, realm environment
mismatch, device mismatch, missing scope, membership projection missing/stale,
and direct use of `app_id` / `subject_user_id` as proof.

## K-BIND-023 SDK/Desktop/App Boundary

SDK, Desktop, Web, and apps may only carry or project the workspace
binding attachment fields admitted by `K-BIND-017`. They must not compute
workspace authorization, cache membership truth as resolver truth, call an
internal resolver, or convert workspace binding into Realm REST credentials.

## K-BIND-024 Workspace Binding Tables

Machine-readable workspace binding relation, decision, and scope facts must be
kept in `tables/workspace-binding-relation.yaml` and consumed by runtime
spec-derived docs before implementation waves begin.
