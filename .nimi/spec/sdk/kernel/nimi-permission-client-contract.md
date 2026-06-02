# SDK Nimi Permission Client Contract

> Owner Domain: `S-PERM-*`

## Scope

定义 SDK 对 Platform `P-PERM-*` app permission fabric 与 Cognition
`C-APMEM-*` memory access policy 的 typed consumer surface。本契约确保
SDK 是 app / developer 对 permission grant lifecycle 与 access policy
的唯一接入入口；apps 不得绕过 SDK 直接访问 Realm 私有 transport 或
Cognition private endpoint。

## S-PERM-001 — Sole Admitted Access Path

`MUST`：SDK Nimi permission client surface 是 app / developer 对
permission grant 申请 / 撤销 / 查询 / 订阅的唯一 admitted access path。

`MUST NOT`：apps 不得：

- 绕过 SDK 直接调用 Realm grant REST endpoint
- 绕过 SDK 直接调用 Cognition memory / knowledge / skill API
- 通过 host bridge implementation detail 推断或私自缓存 grant 状态

## S-PERM-002 — Logical Operation Set

`MUST`：SDK 暴露以下 logical operation：

- `permission.list(scopeRef)` — 列出 app 当前 scope 下的 grant 集合。
- `permission.get(scopeRef, grantId)` — 获取单个 grant。
- `permission.request(scopeRef, grantSpec)` — 请求新 grant；返回
  typed lifecycle state。
- `permission.revoke(scopeRef, grantId)` — 撤销 grant。
- `permission.subscribe(scopeRef, callback)` — 订阅 grant lifecycle
  变更。
- `permission.status(scopeRef)` — 获取 scope 下所有 grant 的状态快照。

## S-PERM-003 — Mandatory AIScopeRef

`MUST`：每个 logical operation 必须显式接收 `AIScopeRef`（`P-AISC-001`）。

`MUST NOT`：SDK 不得从 active chat、renderer-local current app、或默认
scope 隐式推断；不得允许 caller 省略 `scopeRef`。

## S-PERM-004 — Fail-Closed Denial States

`MUST`：SDK 返回的 grant state 必须使用 `P-PERM-003` typed 枚举：
`pending`, `granted`, `denied`, `expired`, `revoked`, `superseded`。

`MUST NOT`：不得通过 generic boolean、null、或字符串状态隐藏 typed
state；不得在 missing grant 时投影 `granted`。

## S-PERM-005 — No Fallback Knob

`MUST`：失败返回 typed error；遵循 `S-AICONF-002` no-fallback 模式。

`MUST NOT`：不暴露 `{ fallback: 'allow' }` 类参数；不静默升级到 partial
grant。

## S-PERM-006 — No Private Path

`MUST NOT`：SDK 不得：

- import Realm private client / private transport
- import Cognition private endpoint
- 通过 `runtime/internal/**` 路径绕过 admitted SDK surface

## S-PERM-007 — Subscription Scope

`MUST`：`permission.subscribe(scopeRef, callback)` 仅承载 grant lifecycle
变更事件。

`MUST NOT`：subscription 不承载 audit event；audit 必须通过 Realm
admitted audit projection 路径访问。

## S-PERM-008 — Permission Scope Ref Shape

`MUST`：SDK `permission.request(scopeRef, grantSpec)` 的 `grantSpec`
schema 与 `P-PERM-007` 的 `permission_scope_ref` schema 对齐：

```
{
  appId: string,
  scopeFamily: 'account' | 'data' | 'agent' | 'ai_spend' | 'memory' | 'knowledge' | 'notification' | 'file_device' | 'audit' | 'ai_profile',
  scopeName: <one of P-PERM-002 enum entries>,
  qualifier?: string
}
```

`MUST NOT`：SDK 不得 admit 开放字符串 scope；不得允许 enum 之外的字段。

## S-PERM-009 — Cross-App Access Flow Shape Stub (Deferred Live Behavior)

**Background fact.** `P-PERM-006` admits the Platform-side cross-app
authorization rule: app A requesting app B's resources (data /
memory / agent projection / file / device) MUST flow through the
grant lifecycle with source-app / target-app / `AIScopeRef`
recorded on the audit trail. Parent invariant `PI-W0-9` records
that "cross-app access is deferred and user-confirmed at access
time." `K-APP-018` defers cross-app file access on the
Nimi-mediated file-API surface to a future sub-topic admitting the
typed cross-app flow shape on that surface. This rule admits the
SDK-side FLOW SHAPE only; the SDK does NOT admit live cross-app
access behavior at this admission cut.

`MUST` (flow-shape carrier — shape only, no live behavior). SDK
Nimi permission client surface admits the typed flow shape for a
future cross-app access request, exposing the fields a future
sub-topic's live admission will fill in:

- `source_app_id` — the calling app's admitted `app_id`
  (`P-NAPP-002`); resolved from the admitted `AIScopeRef`
  (`P-AISC-007`), not from caller-supplied input;
- `target_app_id` — the target app's admitted `app_id`;
- `scopeRef` — the canonical `AIScopeRef` for the access request
  (`P-AISC-001`);
- `grantSpec` — the `S-PERM-008` typed `grantSpec` shape, with
  `appId` resolving to the `target_app_id`;
- `purpose` — review-vetted purpose string carried into the
  cross-app audit record per `P-PERM-006` audit-trail requirement;
- `user_confirmation_required` — boolean; per `PI-W0-9` cross-app
  access is "user-confirmed at access time", so this flag is
  admitted as always `true` on this surface until a future admission
  rule narrows it.

The flow shape is admitted as a typed projection. It exposes the
field shape so that a future sub-topic admitting the live
cross-app access behavior maps its admitted call surface onto this
shape without re-inventing parallel shapes.

`MUST NOT` (no live behavior at this admission cut). The SDK MUST
NOT admit a callable `permission.requestCrossApp(...)` operation,
MUST NOT admit a runtime path that returns a cross-app grant
state other than the typed deferral state, and MUST NOT admit any
Apps-surface or Desktop hosted shell consumer that treats this
flow shape as a live grant entry point. Any caller attempt to
invoke cross-app behavior through this shape at this admission cut
MUST fail closed with the typed deferral reason
`cross_app_access_deferred`. Live cross-app behavior is admitted
only by a future sub-topic explicitly closing `P-PERM-006`'s
deferred portion (and, on the file surface, `K-APP-018`'s deferral
acknowledgement).

`MUST NOT` (no parallel-truth cross-app substrate). The SDK MUST
NOT admit cross-app access through host-bridge implementation
detail, shared filesystem, socket, or any private channel — the
existing `P-PERM-006` `MUST NOT` is preserved. This rule does not
weaken that posture; it only admits the SDK projection of the
flow's typed shape so that future admission has a stable consumer
surface to bind against.

Cross-references: `P-PERM-006` (cross-app authorization rule; not
redefined, live behavior deferred), `K-APP-018` "Deferral
acknowledgement" (cross-app file access deferred on the
Runtime-mediated file-API surface), `P-AISC-001` / `P-AISC-007`
(canonical `AIScopeRef` shape), `S-PERM-008` (`grantSpec` shape),
`S-APP-014` (SDK file-API client; the file-surface cross-app
deferral pointer), parent invariants `PI-W0-9`.

## S-PERM-010 — Anti-Target: Review-Evidence Accessor Not Admitted Here

**Background fact.** The admitted release descriptor's review block
(`P-NAPP-025` decision schema, `P-AUDIT-006` evidence shape) is
exposed to SDK consumers via the review-evidence accessor admitted at
`S-APP-015` in `.nimi/spec/sdk/kernel/nimi-app-client-contract.md`.
The wave-e admission cut places that accessor in S-APP because the
review-decision record is an admission-evidence accessor over the
admitted release descriptor, not a permission grant lifecycle
accessor.

`MUST NOT` (placement anti-target). This contract MUST NOT admit a
review-evidence accessor or any review-decision-schema accessor for
the admitted release descriptor's review block. The decision-schema
fields (`decision`, `adjudicator_kind`, `adjudicator_ref`,
`decided_at`) and the upstream audit-evidence references
(`audit_evidence_ref`, `ai_audit_model_ref`, `scanner_results_ref`)
are out of scope for `nimi-permission-client-contract.md`.

`MUST NOT` (no review-state on grant lifecycle). The
`S-PERM-004` typed grant-state enum (`pending`, `granted`, `denied`,
`expired`, `revoked`, `superseded`) MUST NOT be extended with
`approved`, `revision-requested`, `rejected`, or `kill-switched`
values from the `P-NAPP-025` review-decision enum. The two enums are
disjoint and owned by separate admission surfaces; collapsing the
two enums or surfacing review-decision values on the grant
lifecycle subscription channel is forbidden.

`MUST NOT` (no review-state driven grant gating in this contract).
The permission client contract MUST NOT admit a rule that gates,
filters, or refuses grant requests on the basis of the admitted
descriptor's review-decision record. Review-decision is consumed
via the `S-APP-015` accessor as read-only admission evidence; the
authoritative grant-lifecycle gates are
`P-PERM-003`-typed states, `P-PERM-008` spend-grant binding, the
per-tier `permission_ceiling_ref`, and the fail-closed per-endpoint
enforcement at Runtime / Realm / Cognition.

Cross-references: `S-APP-015` (review-evidence accessor — admitted
location), `P-NAPP-025` (review-decision schema; not redefined),
`P-AUDIT-006` (review-evidence shape; not redefined), `S-PERM-004`
(grant-state enum; not extended with review-state values).

## Fact Sources

- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-015` (`S-APP-015` is the admitted location of the review-evidence accessor per `S-PERM-010`; `S-APP-014` is the SDK file-API client whose cross-app deferral pointer is referenced by `S-PERM-009`)
- `.nimi/spec/sdk/kernel/surface-contract.md` — `S-SURFACE-*`
- `.nimi/spec/sdk/kernel/error-projection.md` — `S-ERROR-*`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-007`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-011` (`P-PERM-006` cross-app authorization with deferred live behavior; `P-PERM-011` `app-local-drafts` qualifier semantics)
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-025` review-decision schema (consumed by `S-APP-015`, anti-target recorded at `S-PERM-010`)
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` — `P-AUDIT-006` review-evidence shape (consumed by `S-APP-015`, anti-target recorded at `S-PERM-010`)
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` — `K-APP-018` cross-app file-access deferral acknowledgement (referenced by `S-PERM-009` flow-shape stub)
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
- `.nimi/topics/ongoing/2026-05-22-nimi-apps-third-party-distribution-and-admission/result-wave-0-product-boundary-implementation.md` — parent invariant `PI-W0-9` ("manifest declaration is transparency, not control; cross-app access is deferred and user-confirmed at access time"; consumed by `S-PERM-009`)
