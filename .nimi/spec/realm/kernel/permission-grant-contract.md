---
id: SPEC-REALM-KERNEL-PERMISSION-GRANT-001
title: Realm Permission Grant Kernel Contract
status: active
owner: "@team"
updated: 2026-06-15
---

# Permission Grant Contract

> Domain: permission-grant
> Rule family: R-PERM

## Scope

This contract defines Realm-owned, account-scoped app permission grant lifecycle truth for ecosystem apps. It governs the canonical grant record, grant lifecycle state, subject identity binding, mutation semantics, validation posture, and typed projection boundary used by Runtime, Desktop, and SDK consumers.

This contract does not govern OAuth authorization-code or account-session issuance (covered by [`oauth-authority-contract.md`](oauth-authority-contract.md)), runtime-local spend/session/audit ownership, provider credentials, raw app tokens, or app-local permission caches. The existing `/api/runtime/realm-grants/issue` stateless HMAC token bridge is acknowledged only as a partial bridge and is not canonical app permission grant lifecycle truth.

OASIS/world/app interconnect remains future product motivation only. This contract admits identity and permission authority; it does not claim multi-world public product readiness.

## R-PERM-001

Realm owns the account-scoped app permission grant lifecycle truth for ecosystem apps. SDK, Desktop, Runtime, and individual apps may consume Realm grant projections or bridge tokens, but they must not own canonical grant lifecycle truth or define parallel grant state.

## R-PERM-002

Grant state is the closed set `PENDING`, `GRANTED`, `DENIED`, `EXPIRED`, `REVOKED`, `SUPERSEDED`. Unknown states must fail closed. Only a current `GRANTED` record may authorize a grant-dependent operation; `PENDING`, `DENIED`, `EXPIRED`, `REVOKED`, and `SUPERSEDED` are non-authorizing states.

## R-PERM-003

Actor and subject identity come from the authenticated Realm account context. App/client-provided subject identifiers are request hints only and are never authority. Cross-subject issuance, revoke, and list operations must fail closed unless a separate admitted Realm administrative authority explicitly governs that surface.

## R-PERM-004

The canonical grant record must carry `grantId`, `subjectAccountId`, `appId`, `scopeFamily`, `scopeName`, `qualifier`, `state`, `reason`, `requestedAt`, `requestedByAccountId`, `grantedAt`, `grantedByAccountId`, `deniedAt`, `deniedByAccountId`, `revokedAt`, `revokedByAccountId`, `expiredAt`, `supersededAt`, `supersededByAccountId`, `supersededByGrantId`, `expiresAt`, and `version`. Grant records and projections must not carry raw credentials, bearer tokens, HMAC token bytes, OAuth tokens, provider secrets, or app-local secret material.

## R-PERM-005

Grant mutation is explicit, idempotent, versioned, and auditable. Request, grant, deny, expire, revoke, and supersede mutations must identify the target grant or deterministic idempotency identity, the authenticated actor, the intended lifecycle action, the reason, and the expected current version or equivalent concurrency guard. Repeating the same admitted mutation may return the existing canonical result; conflicting mutation intent must fail closed.

## R-PERM-006

Grant validation must read the canonical Realm grant record and current version. Missing grants, unsupported scope family, unsupported scope name, expired grants, revoked grants, denied grants, pending grants, superseded grants, and version mismatches must fail closed and must not degrade to app-local allowlists, stateless bridge tokens, default grants, or partial success.

## R-PERM-007

Realm may expose a typed permission-grant projection for Runtime, Desktop, and SDK consumption. The projection is a consumer contract over canonical Realm grant truth and must not include raw credentials or secret material. Runtime owns local spend/session/audit semantics; it does not own Realm grant lifecycle truth.

## R-PERM-008

The existing `/api/runtime/realm-grants/issue` stateless HMAC token bridge remains a partial runtime bridge. It may mint short-lived typed bridge material for an authenticated subject, but it is not the canonical permission grant lifecycle, does not persist grant state, and must not be confused with the Realm-owned app permission grant contract. OASIS/world/app interconnect remains future motivation and is not admitted as public multi-world readiness by this contract.

## R-PERM-009

Public Platform first-party seed grants are Realm grant seed inputs only for
admitted first-party app ids. The current admitted seed app is `nimi.avatar`,
with the exact scope set declared in `tables/permission-grant-contract.yaml`.
Realm must materialize, project, and validate those seed scopes through the
canonical app permission grant lifecycle. Any scope outside the admitted seed
set must fail closed, and the seed set must not become an app-local allowlist,
runtime-local default grant, ordinary Apps visibility expansion, or app
self-admission path.
