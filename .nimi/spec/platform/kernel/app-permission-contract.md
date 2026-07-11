# App Permission Contract

> Owner Domain: `P-PERM-*`

## Scope

定义 Nimi App 的 product-facing 权限合同：closed permission taxonomy、grant
lifecycle、audit event mapping、fail-closed denial state machine、与
cross-app authorization 规则。本契约由 Platform 拥有 product-facing
authority；Realm 负责 grant lifecycle 与 audit 的 backend 实现真相，
Runtime 仍拥有 local AI spend / connector custody / local audit，Cognition
仍拥有 memory / knowledge access policy（`C-APMEM-*`）。

Platform 拥有 `P-PERM-*` 不替代 Realm/Runtime/Cognition 已 admit 的 backend
authority；Realm `R-OAUTH-*` 与 Runtime grant-service / auth / authz
backend rules 保留为各自 backend authority，本契约只锁定 product surface
与跨域 owner split。

## P-PERM-001 — Product-Facing Authority

`MUST`：Platform 拥有 Nimi App permission 的 product-facing authority。
Realm 实现 grant lifecycle 与 cloud audit；Runtime 实现 local AI spend
metering 与 local audit；Cognition 实现 memory / knowledge access policy。

`MUST NOT`：apps、Home shell、SDK 不得绕过 Platform-defined permission
taxonomy 或 fail-closed denial state machine。

## P-PERM-002 — Closed Permission Taxonomy

`MUST`：app permission 的 scope 枚举为以下封闭集合：

- `account.read`
- `account.session.read`
- `data.scope.read`
- `data.scope.write`
- `agent.identity.project`
- `agent.identity.bind`
- `ai.spend.meter`
- `ai.spend.delegate`
- `memory.read.bounded`
- `memory.write.admitted`
- `knowledge.read.bounded`
- `knowledge.write.admitted`
- `notification.send`
- `notification.subscribe`
- `file.read.scoped`
- `file.write.scoped`
- `device.use.scoped`
- `audit.read.scoped`
- `ai_profile.selection.consume`

`MUST NOT`：不得 admit 开放字符串 scope；新增 scope 必须修改本契约并触发
governance gate。

## P-PERM-003 — Grant Lifecycle State Machine

`MUST`：grant lifecycle 固定 typed state set：`pending`, `granted`,
`denied`, `expired`, `revoked`, `superseded`。合法转移：

- `pending → granted | denied | expired`
- `granted → revoked | expired | superseded`
- `denied → pending`（仅在新请求时）
- 终止态不得静默回到 `granted`

## P-PERM-004 — Audit Event Mapping

`MUST`：每个 grant lifecycle 转移必须发出 admitted audit event；event
shape 至少包含 `app_id`、`AIScopeRef`、`scope_name`、`old_state`、
`new_state`、`triggered_by`、`timestamp`。Realm 拥有 cloud audit 写入；
Runtime 拥有 local audit 写入；两者不得互相替代。

`MUST NOT`：不得通过 batch / coalesce 合并跨 grant 转移成单事件；不得跳
过 audit。

## P-PERM-005 — Fail-Closed Denial State Machine

`MUST`：缺少 grant、grant `expired`、grant `revoked`、当前 trust tier 低
于 scope 要求（参见 `nimi-app-trust-tiers.yaml` 与 ecosystem expansion
authority）、
scope 不在 `P-PERM-002` 枚举集合中，皆必须 `denied`。

`MUST NOT`：缺少 grant 时不得静默 allow；请求失败时不得跳过 audit。

## P-PERM-006 — Cross-App Authorization

`MUST`：app A 请求 app B 的资源（data / memory / agent projection /
file / device 等）必须通过 grant 流程；audit 必须记录 source app /
target app / `AIScopeRef`。

`MUST NOT`：apps 不得通过 host bridge implementation detail、shared
filesystem、socket 等私有 channel 实现 cross-app 数据访问。

## P-PERM-007 — Permission Scope Ref Shape

`MUST`：`permission_scope_ref` schema 固定：

```
{
  appId: string,
  scopeFamily: 'account' | 'data' | 'agent' | 'ai_spend' | 'memory' | 'knowledge' | 'notification' | 'file_device' | 'audit' | 'ai_profile',
  scopeName: <one of P-PERM-002 enum entries>,
  qualifier?: string
}
```

The exact product permission for installed callers retrieving their own
Runtime artifact audience is `data.scope.read` with qualifier
`runtime.artifacts`. This is an operation mapping, not a new permission scope:
the Runtime operation id, product permission and AI capability namespaces stay
distinct. A registry row is only the static ceiling; a current account grant
for the same app, scope and qualifier is still required on every operation.

`tables/nimi-app-registry.yaml` 的 `permission_scope_ref` 必须解析到该
schema；`permission_fabric_pending` 是 permission fabric 尚未 admit 具体
scope set 时的 fail-closed 状态，不能被应用当作 granted scope。

## P-PERM-008 — Spend Metering

`MUST`：所有 cloud / runtime AI execution 必须发射 typed spend record，
绑定到 active `ai.spend.meter` 或 `ai.spend.delegate` grant。

`MUST NOT`：缺少有效 spend grant 的 execution 必须 fail-closed；不得允
许无监管的 cloud spend。

## P-PERM-009 — First-Party Seed Grant Set

`MUST`：Avatar first-party target 的 grant set admitted 如下：

- `nimi.avatar`：`account.session.read`, `agent.identity.project`,
  `memory.read.bounded` (qualifier=persona-scoped),
  `memory.write.admitted` (qualifier=session-scoped),
  `ai.spend.meter`, `device.use.scoped`, `file.read.scoped`,
  `ai_profile.selection.consume`。
`MUST NOT`：first-party seed grant 不得 admit 超出本枚举的 scope；
Avatar first-party seed grants are admitted only for the hardcut `nimi.avatar`
row and do not expand ordinary Apps visibility.

## P-PERM-010 — Cross-Kernel Backend Retention

`MUST`：以下 backend authority 保留各自 kernel ownership：

- Realm `R-OAUTH-*` 与 Realm grant backend 仍拥有 cloud session / OAuth
  / grant persistence 真相。
- Runtime `account-session-contract.md` / `auth-service.md` /
  `authn-token-validation.md` / `authz-ownership.md` / `grant-service.md`
  仍拥有 Runtime local authority。
- Cognition `C-APMEM-*` 仍拥有 memory / knowledge access policy。

`MUST NOT`：Platform `P-PERM-*` 不得 supersede 上述 backend authority；
本契约只锁定 product-facing surface 与跨域 owner split。

## P-PERM-011 — App-Local-Drafts Qualifier Semantics

`MUST`：when a product reviews or projects a Nimi-mediated file scope —
`file.read.scoped` or `file.write.scoped` per the `P-PERM-002` closed
enum — with `qualifier: app-local-drafts`, the qualifier denotes the
calling app's data root:

```text
<nimi_data>/apps/<app_id>/
```

where `<app_id>` is the calling app's admitted Nimi App registry row
`app_id` (`P-NAPP-002`).

This qualifier is permission-review and scope-expression semantics only.
It does not by itself admit a Runtime-mediated file API, SDK file client,
Desktop bridge helper, Realm REST path, or direct filesystem operation.

`MUST`：the calling app's data root admitted by this rule is the
same Nimi-owned data root admitted by `P-NAPP-015` and bound to
`storage_policy_ref.kind: nimi-mediated-default` by `P-NAPP-027`.
The `app-local-drafts` qualifier is the SDK / Runtime projection of
that admitted root; it does not introduce a parallel root.

`MUST NOT`：the closed `P-PERM-002` scope enum MUST NOT be extended
under this rule. `P-PERM-011` admits qualifier semantics for the
already-admitted `file.read.scoped` and `file.write.scoped` scopes
ONLY; it does not admit a new scope. Additional scope admission is a
separate authority-bearing change to `P-PERM-002`.

`MUST NOT`：no consumer may treat this qualifier as permission to
silently allow a path that escapes the admitted root. Parent traversal,
absolute paths leaving the root, paths into another app's root
`<nimi_data>/apps/<other_app_id>/`, symbolic-link traversal that
crosses out of the root, heuristic "close enough" path resolution, and
fallback remapping are all forbidden. If a callable Nimi-mediated file
surface is admitted by its execution owner, escape attempts MUST fail
closed with typed reason `out_of_data_root`.

`MUST NOT`：cross-app file access is not admitted by this rule. A path
resolving into `<nimi_data>/apps/<other_app_id>/` is not made valid by
declaring `qualifier: app-local-drafts`.

Cross-references: `K-APP-018` records the current Runtime-mediated
file-API non-admission; `S-APP-014` records the current SDK file-client
non-admission. This Platform rule keeps the qualifier semantics but does
not admit an execution surface.

## P-PERM-012 - Zhiyu Proactive Interruptibility Permission Binding

`proactive_interruptibility_v1` uses the following `AIScopeRef` for the Zhiyu
product slice:

```text
{
  appId: 'nimi.zhiyu',
  scopeFamily: 'notification',
  scopeName: 'notification.subscribe',
  qualifier: 'proactive_interruptibility_v1.in_app_surface'
}
```

This scope is a product-facing opt-in for Runtime/host in-app proactive
companion projection only. It does not admit OS notification delivery,
`notification.send`, app registry release/admission, ordinary app visibility,
or an app-local scheduler.

`MUST`: missing, denied, revoked, or expired grant evidence suppresses
`proactive_interruptibility_v1` delivery and surfaces an owner-projected
`suppression_reason` plus audit evidence from Realm/Runtime as applicable.

`MUST NOT`: Zhiyu, SDKs, and apps may not treat this scope as granted without
Realm/Runtime grant evidence.

`MUST NOT`: `notification.not_admitted` is the required delivery-channel value
for OS notification paths in this PP6 slice until separate host notification
authority exists.

## Fact Sources

- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-032`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/realm/kernel/social-contract.md` — `R-SOC-*`
- `.nimi/spec/realm/kernel/oauth-authority-contract.md` — `R-OAUTH-*`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
