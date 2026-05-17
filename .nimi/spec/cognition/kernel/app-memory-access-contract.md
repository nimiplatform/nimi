# Cognition App Memory Access Contract

> Owner Domain: `C-APMEM-*`

## Scope

定义 Cognition 对 app memory / knowledge / skill access 的产品级 policy
authority。本契约不替代 Cognition 既有 `C-COG-*` memory / knowledge /
skill service 真相；它锁定 cross-app 消费这些 service 时必须遵守的 admitted
policy enum、chat-derived projection 规则、与 no-implicit-allow rule。

## C-APMEM-001 — Cognition Owns App Memory / Knowledge / Skill Access Policy

`MUST`：Cognition 拥有 app 访问 memory / knowledge / skill 的 policy
决策；Realm grant lifecycle 决定 scope 可否使用，Cognition policy 决定具体
read / write / projection 的形状与约束。

`MUST NOT`：Realm grant、Runtime local execution、Desktop hosted shell、
SDK 都不得自创 memory / knowledge / skill access policy。

## C-APMEM-002 — Admitted Policy Enum

`MUST`：以下为 Wave 4 admitted policy 枚举：

- `memory.read.persona-scoped-bounded`
- `memory.read.session-scoped-bounded`
- `memory.write.session-scoped-admitted`
- `knowledge.read.bounded`
- `knowledge.write.admitted`
- `skill.run.bounded`
- `chat_derived.projection.admitted`

每条 policy 对应 `P-PERM-002` 中的 scope；Cognition 收到 grant 时按该映射
执行 read / write / projection。

`MUST NOT`：不得 admit 开放字符串 policy；新增 policy 必须修改本契约。

## C-APMEM-003 — Chat-Derived Projection Rule

`MUST`：chat transcript 转换为 memory truth 必须满足：

- 存在 active `chat_derived.projection.admitted` grant
- projection request 携带 `ConversationAnchor` 引用、source app id、target
  persona id、与 Realm audit event id
- Cognition 写入的 memory record 含 `source.anchor` 与
  `source.app_id` 字段

`MUST NOT`：不得在缺少 grant 时由 background job、passive cache、replay
触发 chat → memory 转换；不得在 transcript display 路径上直接写入
memory bank。

## C-APMEM-004 — No Implicit Allow

`MUST`：缺少 policy → deny；scope ambiguous → deny；orphan
projection（无 active app / grant / anchor）→ deny。

`MUST NOT`：不得静默 fallback 到 default allow；不得通过缓存 invalidation
迟滞绕过 deny。

## C-APMEM-005 — Memory Write Boundary

`MUST`：`memory.write.session-scoped-admitted` 写操作必须：

- session-scoped（绑定到当前 chat / app session）
- persona-bound（指向具体 `AgentPersonaId`）
- 写入 Realm audit event

`MUST NOT`：跨 persona / 跨 session 的写操作必须重新申请 grant；不得
通过 batch 写绕过 audit。

## C-APMEM-006 — Knowledge Write Boundary

`MUST`：`knowledge.write.admitted` 写操作必须声明 knowledge base id、
target scope、admitted policy class、与 audit reason。

`MUST NOT`：不得通过 implicit insertion 写入 knowledge；不得用 prompt
context 直接成为 knowledge truth。

## C-APMEM-007 — Skill Run Boundary

`MUST`：`skill.run.bounded` 执行必须声明 capability set、persona scope、
与 canonical `AIScopeRef`（`P-AISC-001`）。

`MUST NOT`：不得用 host bridge 绕过 Cognition skill service；不得让
skill run 持有跨 app persona 的 persistent state。

## C-APMEM-008 — Agent Chat Memory Projection Boundary

`MUST`：Agent Chat 在 Wave 1 / 2 / 3 surface 上不得 pre-cache 或
pre-project memory truth；任何 chat 上下文中的 memory projection 必须由
Wave 4 admitted policy 触发。

`MUST NOT`：Desktop-hosted Home shell 不得维护 cross-session memory
cache；session lifecycle 结束后必须 release projection。

## Fact Sources

- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/default-experience-profile-contract.md` — `P-DXP-001..P-DXP-012`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/cognition/kernel/memory-service-contract.md` — `C-COG-*` memory subset
- `.nimi/spec/cognition/kernel/knowledge-service-contract.md` — `C-COG-*` knowledge subset
- `.nimi/spec/cognition/kernel/skill-service-contract.md` — `C-COG-*` skill subset
- `.nimi/spec/sdk/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/runtime-cognition-knowledge-memory-owner-split.md`
