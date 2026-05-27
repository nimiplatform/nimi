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
于 scope 要求（参见 `nimi-app-trust-tiers.yaml` 与 Wave 6 expansion）、
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

`tables/nimi-app-registry.yaml` 的 `permission_scope_ref` 必须解析到该
schema；Wave 3 `pending_wave_4` 占位字符串在 Wave 4 close 后必须全部替
换为 typed object 列表。

## P-PERM-008 — Spend Metering

`MUST`：所有 cloud / runtime AI execution 必须发射 typed spend record，
绑定到 active `ai.spend.meter` 或 `ai.spend.delegate` grant。

`MUST NOT`：缺少有效 spend grant 的 execution 必须 fail-closed；不得允
许无监管的 cloud spend。

## P-PERM-009 — First-Party Seed Grant Set

`MUST`：Wave 5 first-party target 的 grant set admitted 如下：

- `nimi.avatar`：`account.session.read`, `agent.identity.project`,
  `memory.read.bounded` (qualifier=persona-scoped),
  `memory.write.admitted` (qualifier=session-scoped),
  `ai.spend.meter`, `device.use.scoped`, `file.read.scoped`,
  `ai_profile.selection.consume`。
`MUST NOT`：first-party seed grant 不得 admit 超出本枚举的 scope；
Avatar Wave 5 集成仍受 Avatar 产品化 master gate 约束。

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

`MUST`：when an app invokes a Nimi-mediated file scope —
`file.read.scoped` or `file.write.scoped` per the `P-PERM-002` closed
enum — with `qualifier: app-local-drafts`, the call MUST resolve
relative to the calling app's data root:

```text
<nimi_data>/apps/<app_id>/
```

where `<app_id>` is the calling app's admitted Nimi App registry row
`app_id` (`P-NAPP-002`). Any Nimi-mediated SDK or Runtime file API
attempt to resolve a path outside this root — including paths
escaping via parent traversal, absolute paths leaving the root, or
paths into another app's root `<nimi_data>/apps/<other_app_id>/` —
MUST fail closed with typed reason `out_of_data_root`.

`MUST`：the calling app's data root admitted by this rule is the
same Nimi-owned data root admitted by `P-NAPP-015` and bound to
`storage_policy_ref.kind: nimi-mediated-default` by `P-NAPP-027`.
The `app-local-drafts` qualifier is the SDK / Runtime projection of
that admitted root; it does not introduce a parallel root.

`MUST NOT`：the closed `P-PERM-002` scope enum MUST NOT be extended
under this rule. `P-PERM-011` admits qualifier semantics for the
already-admitted `file.read.scoped` and `file.write.scoped` scopes
ONLY; it does not admit a new scope. Any future scope admission is
a separate authority-bearing change to `P-PERM-002`.

`MUST NOT`：the Nimi-mediated file API surface MUST NOT silently
allow a resolved path that escapes the admitted root. Heuristic
"close enough" path resolution, symbolic-link traversal that crosses
out of the root, or any fallback that maps an escaping path to a
permitted neighbor inside the root is forbidden; the fail-closed
behavior is `out_of_data_root`, not a remapped success.

**Forward-reference posture (legitimate)**：the Runtime-side
enforcement seam for this qualifier is `K-APP-018` in
`.nimi/spec/runtime/kernel/app-messaging-contract.md` (wave-C
admission of the Runtime-mediated file-API surface plus its typed
`out_of_data_root` invariant). The forward reference is legitimate
because rule IDs are frozen in the ST-L0-1 plan's wave-A1 packet
across all six waves before any worker writes spec text;
`K-APP-018` is the allocated wave-C rule ID for the Runtime-side
file-API admission. The SDK projection seam is `S-APP-*` /
`S-PERM-*` in `.nimi/spec/sdk/kernel/` (wave-E).

**Deferral acknowledgement (not admitted here)**：cross-app file
access — a path resolving into `<nimi_data>/apps/<other_app_id>/` —
remains deferred to a future sub-topic via the `P-PERM-006`
cross-app authorization flow with explicit user confirmation at
access time. This rule does NOT admit the cross-app flow; it
acknowledges the deferral and treats every cross-app path as
`out_of_data_root` until that future sub-topic admits the typed
flow shape.

## Fact Sources

- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-030`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/realm/kernel/social-contract.md` — `R-SOC-*`
- `.nimi/spec/realm/kernel/oauth-authority-contract.md` — `R-OAUTH-*`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
- `.nimi/spec/sdk/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/authority-supersession-map.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/agent-identity-primitive-floor.md`
