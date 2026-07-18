# SDK Nimi Permission Client Contract

> Owner Domain: `S-PERM-*`

## Scope

定义 SDK 对 Platform `P-PERM-*` product-facing permission catalog 的唯一
app-facing typed projection。本契约只覆盖第三方 app 访问 Nimi、Realm、Agent
或 Cognition owner 资源时的用户权限；base entitlement、first-party product
operation、app-owned authority 与 OS right 明确不属于本 client。

## S-PERM-001 — Sole Public Permission Path

`MUST`：当某个 `P-PERM-017` permission slice 完整准入后，SDK permission
client 是 app 查询自身 posture、发起用户可理解请求和订阅自身 posture 变化的
唯一 public path。Transport 必须由 Kit/native host 注入，并从 protected carrier
派生 app、account、principal 与 OS-user identity。

`MUST NOT`：app 不得直接调用 Realm grant REST、Runtime private grant RPC、
Cognition private endpoint，或经 bridge implementation detail 读写 grant ledger。

## S-PERM-002 — Minimal Product Operation Set

SDK logical surface 固定为：

- `permission.status(permissionId)` — 返回 calling app 对该 public id 的一个
  public posture。
- `permission.request({ permissionId, reason })` — 发起一次 public permission
  request；需要 selector 时由 owner-owned picker 接管。
- `permission.subscribe(permissionId, callback)` — 订阅 calling app 对该 id 的
  public posture 变化。

普通 app surface 不暴露 `list(scopeRef)`、`get(grantId)`、`revoke(grantId)`、
grant history、raw lifecycle 或 other-app rows。用户撤销与审计管理属于 Desktop
Settings；未来若 admit app-initiated release，必须作为独立 public semantic
operation 准入，不得复用 raw grant id。

## S-PERM-003 — Public Request Shape

`MUST`：request input 精确为 `{ permissionId, reason }`。`reason` 是 bounded、
面向用户的说明，不是 authority。App/account/principal/session/OS-user anchor 从
protected carrier 派生；selector 与 selector digest 从 catalog 指定的 owner picker
派生。

`MUST NOT`：public SDK input/type/export 不得出现 `AIScopeRef`、`scopeFamily`、
`scopeName`、`qualifier`、`operationId`、`resourceRef`、`grantId`、raw account/
principal/session、token 或 credential。

## S-PERM-004 — Closed Catalog And Current Admission

`MUST`：`PermissionID` 仅包含
`nimi-app-permission-catalog.yaml#public_permissions` 的稳定 product ids。
只有 `admission: admitted` 且 `manifest_allowed: true` 的 id 可进入
`request(...)`。Known-but-reserved id 可用于 `status(...)` 的 typed
`unavailable` projection，但 request 必须在调用 transport 前 fail closed。

当前没有已准入的第三方 public permission；因此 current SDK request positive
set 为空。该状态不影响 app 启动、私有存储、host commands 或 app-owned UI。

## S-PERM-005 — Public Posture, Not Grant Lifecycle

`MUST`：app-facing posture 闭集为 `prompt | pending | granted | denied |
unavailable`，并至少返回 `{ permissionId, posture, canRequest }`。Transport
返回未知值、mismatched id、reserved id 的 positive posture，或缺失字段时 SDK
必须 fail closed。

`MUST NOT`：owner lifecycle 的 `expired | revoked | superseded`、revision、
fingerprint 与 transition history 不得成为 ordinary app API。SDK 不得把 missing
record、transport error 或 reserved id 投影为 `granted`。

## S-PERM-006 — No Fallback Or Parallel Ledger

失败必须返回 typed actionable error。SDK 不得提供 `{ fallback: 'allow' }`、
默认 scope、implicit current app、client-side optimistic grant、offline allow、
Realm/Runtime 双 ledger 合并，或把 publish/review trust 当作 permission。

## S-PERM-007 — Public/Internal Enforcement Separation

一个 public permission 可由 owner 映射到多个 exact operations、resource checks、
quota、budget、rate、presence 与 audit events；这些映射保留在 owner backend。
SDK/renderer 只见 public id、reason、public posture 与 owner-hosted picker flow，
不得按 method、anchor、turn、stream 或 app-private file 逐项申请。

## S-PERM-008 — One-Shot And Cross-App Non-Admission

`files.open`、`files.save`、`artifacts.open` 与 `shared_resources.open` 当前均为
reserved one-shot rows。Owner picker、non-forgeable handle、consume semantics 与
audit 未原子准入前，SDK 不得暴露 callable file/cross-app shortcut、target app id、
path 或 generic durable grant。

## S-PERM-009 — App-Private Authority Exclusion

Nimi-mediated private JSON storage 是 `app.private_storage` base entitlement；
app 自建 SQLite、media、settings、cache、routes 和 exact native commands 是
`app_owned_authority`；普通 filesystem/network/process/device authority 是
`os_right`。三者均不得进入 `PermissionID`、manifest permission request、grant
ledger 或用户批准 UI。

SDK storage/host-command helpers 仍必须依赖 live protected carrier、opaque
principal/account partition、path/quota/symlink/origin/payload checks；“不是用户
permission”不等于“没有安全边界”。

## S-PERM-010 — Review Evidence Is Not Permission

Release review/attestation accessor 属于 `S-APP-*` admission evidence surface，
不得出现在 permission posture、permission request、subscription 或 owner grant
lifecycle。`approved | revision-requested | rejected | kill-switched` 与 public
permission posture/lifecycle 是互斥词汇；review 结果不得 seed 或扩大 grant。

## Fact Sources

- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-017`
- `.nimi/spec/platform/kernel/tables/nimi-app-permission-catalog.yaml`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-*`
- `.nimi/spec/runtime/kernel/app-lifecycle-contract.md` — `K-APP-*`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-*`
- `.nimi/spec/sdks/kernel/error-projection.md` — `S-ERROR-*`
