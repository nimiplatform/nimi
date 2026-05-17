# Agent Identity Floor Contract

> Owner Domain: `P-AGID-*`

## Scope

定义跨 app agent identity 的 platform-level floor。本契约固定 Wave 0
`agent-identity-primitive-floor.md` 决议：agent identity 不是 app-local
truth；apps 接收 account-scoped durable identity 的 projection。本契约不
拥有 chat transcript / `ConversationAnchor` 实现细节（仍由 Runtime 与
Desktop-hosted Home 拥有），也不拥有 Cognition memory access 政策（属
`C-APMEM-*`）。

## P-AGID-001 — Account-Scoped Durable Identity

`MUST`：agent identity 是 account-scoped durable truth，canonical owner
是 Realm。Wave 4 admit 的 identity primitive 至少包含：

- `AgentFamilyId` — agent family 标识。
- `AgentPersonaId` — persona 标识。
- `AgentProjectionRef` — 某 app 对某 persona 的 projection 引用。

`MUST NOT`：apps 不得自定义/持久化平行 identity schema。

## P-AGID-002 — Family / Persona / Projection Semantics

`MUST`：family / persona / projection 三层关系固定为：

- 一个 family 可拥有多个 persona。
- 一个 persona 可被多个 app projection 引用。
- projection 是 app-app 隔离的 identity 视图，绑定 app scope 与
  `permission_scope_ref` (`P-PERM-*`)。

`MUST NOT`：apps 不得通过 cache、约定、或 inferred channel 在不同 app
之间共享 persona 的 raw identity material；persona 共享必须经 Realm 投影。

## P-AGID-003 — App-Specific Projection

`MUST`：每个 app 对某 persona 收到的 projection 是稳定的、scope-bound
的、可撤销的。projection 绑定到 app 的 `permission_scope_ref`
（`P-PERM-007`）。

`MUST NOT`：app 不得跨 scope 重用 projection；projection lifetime 与
对应 permission grant 绑定。

## P-AGID-004 — ConversationAnchor Continuity Binding

`MUST`：agent chat 会话必须绑定到 Runtime `ConversationAnchor`，跨
surface 续会语义沿用现有 Runtime 合同
（`runtime-cognition-knowledge-memory-owner-split.md`）。

`MUST NOT`：Home / Desktop / SDK 不得将 anchor binding 改为 renderer-local
state 或 chat-local cache。

## P-AGID-005 — No App-Local Mint

`MUST NOT`：apps、shell、SDK consumer 都不得：

- 自创 `AgentFamilyId` / `AgentPersonaId` / `AgentProjectionRef`
- 把 app-local user state 直接写入 Realm 的 canonical identity 字段
- 在缺少 projection 的情况下使用 persona 字符串作为 identity 默认

## P-AGID-006 — Agent Chat Transcript / History Owner

`MUST`：agent chat transcript / history 的 owner 是 Desktop-hosted Home
shell（`D-HOME-006`）。Home shell 拥有 transcript display / replay /
local cache，但其内容不构成 memory truth。

`MUST NOT`：transcript / history cache 不得：

- 被自动升格为 Cognition memory（必须经 `chat_derived.projection.admitted`
  policy，参见 `C-APMEM-003`）
- 被外部 app 直接读取（必须经 `P-PERM-*` 与 `C-APMEM-*` 授权）

## P-AGID-007 — Chat-Derived Memory Projection Rule

`MUST`：chat context → memory truth 的转换必须由 Wave 4
`C-APMEM-003` 的 `chat_derived.projection.admitted` policy 触发，且
projection record 必须携带 `ConversationAnchor` 引用、source app id、
target persona id、与 Realm audit event 引用。

`MUST NOT`：不得通过 background job / passive cache / chat replay 自
动产生 memory truth。

## P-AGID-008 — Projection Lifecycle

`MUST`：projection lifecycle 与 grant lifecycle 同源：

- app uninstall → projection 失效
- permission grant revoke → 对应 projection 失效
- account 退出 → 所有 projection 失效

`MUST NOT`：projection 不得 orphan；缺乏 grant 的 projection 必须 fail
closed。

## Fact Sources

- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-012`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
- `.nimi/spec/sdk/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — `D-LLM-022..D-LLM-026`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/agent-identity-primitive-floor.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/runtime-cognition-knowledge-memory-owner-split.md`
