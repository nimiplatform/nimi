# Hook Capability Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop Hook 能力模型契约。定义 5 个 hook 子系统、capability key 格式、source-type 权限白名单、wildcard 匹配语义。

## D-HOOK-001 — Event 子系统

Pub/sub 事件总线：

- `event.publish.<topic>`：发布事件到指定主题。
- `event.subscribe.<topic>`：订阅指定主题事件。
- 所有 source types 均支持 `event.publish.*`，但 `sideload` 不支持 subscribe。

## D-HOOK-002 — Data 子系统

共享数据能力注册与查询：

- `data.query.<name>`：查询已注册的数据能力。
- `data.register.<name>`：注册新的数据能力。
- `sideload` 仅支持 query，不支持 register。

## D-HOOK-003 — Turn 子系统

AI 对话生命周期拦截点：

- `turn.register.<point>`：注册到指定 hook point。
- 4 个 hook points（按执行顺序）：`pre-policy` → `pre-model` → `post-state` → `pre-commit`。
- `injected` source type 仅允许 `pre-model` 和 `post-state`。
- `sideload` 和 `codegen` 不允许 turn hook。

**与 Runtime 拦截器链的时序关系**：Turn hook 在 renderer 进程执行，时序先于 SDK 发送请求到 Runtime。Runtime K-DAEMON-005 拦截器链（lifecycle → protocol → authz → audit）在 daemon 收到请求后执行。两层无重叠：Desktop turn hook 负责请求编排（策略门控、模型选择、状态更新、提交确认），Runtime 拦截器负责请求验证（健康门控、幂等性、授权、审计）。

## D-HOOK-004 — UI 子系统

UI 扩展槽位注册：

- `ui.register.<slot>`：注册 UI 组件到指定槽位。
- 8 个预定义槽位（参考 `tables/ui-slots.yaml`）。
- `codegen` 仅允许 `ui-extension.app.*` 前缀的槽位。

## D-HOOK-005 — Inter-Mod 子系统

跨 mod RPC 通信：

- `inter-mod.request.<channel>`：发送请求到指定通道。
- `inter-mod.provide.<channel>`：在指定通道提供服务。
- `builtin` 支持 request + provide，其他 source types 仅支持 request。

## D-HOOK-006 — Capability Key 格式

Capability key 采用点分层级格式：`<subsystem>.<action>.<target>`。

- 归一化：`normalizeCapabilityKey()` — trim 空白。
- 匹配：`capabilityMatches(pattern, key)` — 支持 `*` wildcard。
- 批量匹配：`anyCapabilityMatches(patterns, key)` — 任一模式匹配即通过。

## D-HOOK-007 — Source-Type 权限网关

5 种 source types 按信任级别递减排列：

1. `core`：全权限 `*`。
2. `builtin`：完整 5 子系统 + LLM + action + audit/meta（含 `meta.read.all`）。
3. `injected`：完整 event/data/ui/inter-mod + 受限 turn hook（仅 pre-model, post-state）+ 完整 LLM + action + audit/meta（无 `meta.read.all`、无 `inter-mod.provide`）。
4. `sideload`：event.publish + data.query + ui.register + inter-mod.request + 完整 LLM + action + audit/meta（无 event.subscribe、无 data.register、无 turn hook、无 inter-mod.provide）。
5. `codegen`：最小权限（text LLM + `ui-extension.app.*` 槽位 + `data-api.user-*` 数据 API + audit/meta.read.self）。

Capability 检查流程：
1. 解析请求的 capability key。
2. 查找 mod 的 source type。
3. 遍历该 source type 的 allowlist。
4. `capabilityMatches(pattern, key)` 判定。

## D-HOOK-008 — LLM Capability 域

所有非 codegen source types 共享完整 LLM 能力集：

- `llm.text.generate` / `llm.text.stream`
- `llm.image.generate` / `llm.video.generate` / `llm.embedding.generate`
- `llm.lifecycle.read`
- `llm.speech.*`（providers.list、voices.list、synthesize、stream.*、transcribe）

## D-HOOK-009 — Action Capability 域

所有非 codegen source types 共享 action 能力集：

- `action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`

## D-HOOK-010 — Audit / Meta Capability 域

辅助能力域，用于 mod 自检和平台元数据读取：

- `audit.read.self`：读取本 mod 的审计日志（所有 source types 均可用，包括 `codegen`）。
- `meta.read.self`：读取本 mod 的元数据（所有 source types 均可用，包括 `codegen`）。
- `meta.read.all`：读取全局 mod 元数据（仅 `builtin` 可用）。

## Fact Sources

- `tables/hook-subsystems.yaml` — Hook 子系统枚举
- `tables/hook-capability-allowlists.yaml` — Source-type 能力白名单
- `tables/ui-slots.yaml` — UI 扩展槽位
- `tables/turn-hook-points.yaml` — Turn hook 挂载点
