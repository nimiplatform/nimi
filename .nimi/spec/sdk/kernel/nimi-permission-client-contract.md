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
  scopeFamily: 'account' | 'data' | 'agent' | 'ai_spend' | 'memory' | 'knowledge' | 'notification' | 'file_device' | 'audit' | 'default_experience',
  scopeName: <one of P-PERM-002 enum entries>,
  qualifier?: string
}
```

`MUST NOT`：SDK 不得 admit 开放字符串 scope；不得允许 enum 之外的字段。

## Fact Sources

- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/sdk/kernel/surface-contract.md` — `S-SURFACE-*`
- `.nimi/spec/sdk/kernel/error-projection.md` — `S-ERROR-*`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
