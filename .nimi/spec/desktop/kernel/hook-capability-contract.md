# Hook Capability Contract

> Authority: Desktop Kernel

## Scope

Desktop Hook 能力模型契约。定义 6 个 hook 子系统、capability key 格式、source-type 权限白名单、wildcard 匹配语义。

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

**与 Runtime 拦截器链的时序关系**：Turn hook 在 renderer 进程执行，时序先于 SDK 发送请求到 Runtime。Runtime K-DAEMON-005 拦截器链（version → lifecycle → activity → protocol → authn → authz → credential-scrub → audit，共 8 层）在 daemon 收到请求后执行。两层无重叠：Desktop turn hook 负责请求编排（策略门控、模型选择、状态更新、提交确认），Runtime 拦截器负责请求验证与执行边界保护（版本协商、健康门控、活跃 RPC 跟踪、幂等性、身份认证、授权、敏感 metadata 擦除、审计）。

## D-HOOK-004 — UI 子系统

UI 扩展槽位注册：

- `ui.register.<slot>`：注册 UI 组件到指定槽位。
- 8 个预定义槽位（参考 `tables/ui-slots.yaml`）。
- `codegen` 仅允许 `ui-extension.app.*` 前缀的槽位。

**边界说明**：

- `ui.register(...)` 的扩展载荷必须保持声明式；Desktop host 可以将其解释为 same-tree render 或未来的 isolated render，但该解释方式不属于公开 contract。
- `ui.register(...)` 不得被视为“mod 可直接注入 shared React tree”的承诺。
- route tab identity 在 Desktop host 中固定使用 `tabId`；route visibility / retention / lifecycle 由 host 管理，不属于 hook payload 本身。

## D-HOOK-005 — Storage 子系统

Desktop host 提供的 mod 本地持久化能力：

- `storage.files.read`
- `storage.files.write`
- `storage.files.delete`
- `storage.files.list`
- `storage.sqlite.query`
- `storage.sqlite.execute`
- `storage.sqlite.transaction`

约束：

- 持久化根固定为 `{nimi_data_dir}/mod-data/{mod_id}`。
- mod 身份只能由 host caller context 决定，payload 不得自报 `modId`。
- `files` 只允许相对路径访问该 mod 自己的 `files/` 子树。
- `sqlite` 只允许访问该 mod 自己的 `sqlite/main.db`。
- `codegen` 不开放任何 `storage.*` 能力。

## D-HOOK-006 — Inter-Mod 子系统

跨 mod RPC 通信：

- `inter-mod.request.<channel>`：发送请求到指定通道。
- `inter-mod.provide.<channel>`：在指定通道提供服务。
- `builtin` 支持 request + provide，其他 source types 仅支持 request。

## D-HOOK-007 — Capability Key 格式

Capability key 采用点分层级格式：`<subsystem>.<action>.<target>`。

- 归一化：`normalizeCapabilityKey()` — trim 空白。
- 匹配：`capabilityMatches(pattern, key)` — 支持 `*` wildcard。
- 批量匹配：`anyCapabilityMatches(patterns, key)` — 任一模式匹配即通过。

## D-HOOK-008 — Source-Type 权限网关

5 种 source types 按信任级别递减排列：

1. `core`：全权限 `*`。
2. `builtin`：完整 6 子系统 + runtime facade + action + audit/meta（含 `meta.read.all`）。
3. `injected`：完整 event/data/storage/ui/inter-mod + 受限 turn hook（仅 pre-model, post-state）+ 完整 runtime facade + action + audit/meta（无 `meta.read.all`、无 `inter-mod.provide`）。
4. `sideload`：event.publish + data.query + storage + ui.register + inter-mod.request + 完整 runtime facade + action + audit/meta（无 event.subscribe、无 data.register、无 turn hook、无 `inter-mod.provide`）。
5. `codegen`：最小权限（runtime text facade + `ui-extension.app.*` 槽位 + `data-api.user-*` 数据 API + audit/meta.read.self）。

`catalog` access mode 不形成额外 source type。catalog-installed mod 在 capability allowlist 语义上继续归入 `source_type=sideload`，catalog 校验只影响安装许可、审计与风险提示，不提升 hook/runtime facade 权限。

Capability 检查流程：
1. 解析请求的 capability key。
2. 查找 mod 的 source type。
3. 遍历该 source type 的 allowlist。
4. `capabilityMatches(pattern, key)` 判定。

**两层语义必须分离**：

- Hook permission key 负责授权 mod 是否可以调用某个 desktop/runtime facade 方法。
- Runtime canonical capability token 负责在 `runtime.route.listOptions/resolve/checkHealth` 中判定 connector/model/workflow 的支持面。
- Hook permission key 不是 provider/model 能力真相；Desktop 不得用 `runtime.*` permission 反推 `text.generate` / `audio.synthesize` / `voice_workflow.tts_v2v` 等 runtime canonical capability。

## D-HOOK-009 — Runtime Capability 域

所有非 codegen source types 共享完整 runtime facade 能力集：

- `runtime.ai.text.generate` / `runtime.ai.text.stream`
- `runtime.ai.embedding.generate`
- `runtime.media.image.generate` / `runtime.media.image.stream`
- `runtime.media.video.generate` / `runtime.media.video.stream`
- `runtime.media.tts.list.voices` / `runtime.media.tts.synthesize` / `runtime.media.tts.stream`
- `runtime.media.stt.transcribe`
- `runtime.media.jobs.submit|get|cancel|subscribe|get.artifacts`
- `runtime.voice.get.asset|list.assets|delete.asset|list.preset.voices`
- `runtime.route.list.options|resolve|check.health|describe`
- `runtime.local.assets.list`
- `runtime.local.profiles.list`
- `runtime.local.profiles.install.request`
- `runtime.profile.read.agent`

legacy runtime-aligned mod/hook surface 已硬切移除，不得回流旧的 mod AI 专用子路径、旧的 AI client 构造入口与公开类型、旧的 LLM hook capability 键、旧的 runtime route hint / override 字段，或 legacy speech provider-list / stream-control surface。

执行命令：

- `pnpm check:runtime-mod-hook-hardcut`

## D-HOOK-010 — Action Capability 域

所有非 codegen source types 共享 action 能力集：

- `action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`

## D-HOOK-011 — Audit / Meta Capability 域

辅助能力域，用于 mod 自检和平台元数据读取：

- `audit.read.self`：读取本 mod 的审计日志（所有 source types 均可用，包括 `codegen`）。
- `meta.read.self`：读取本 mod 的元数据（所有 source types 均可用，包括 `codegen`）。
- `meta.read.all`：读取全局 mod 元数据（仅 `builtin` 可用）。

## D-HOOK-012 — Route Runtime Lifecycle Boundary

Desktop host 必须将 route runtime lifecycle 与 package lifecycle 分开处理。

- package lifecycle 继续遵循 `tables/mod-lifecycle-states.yaml`
- route runtime lifecycle 只描述某个 `tabId` 对应 route instance 的可见性 / retention / throttling 状态
- route runtime lifecycle 的公开状态固定为：
  - `active`
  - `background-throttled`
  - `frozen`
  - `discarded`

route runtime lifecycle 可以被公开为 SDK facade，但不得混入 hook permission key，也不得以 `modId` 聚合作为稳定 contract。

Desktop same-tree host 的默认 route lifecycle policy 还必须满足：

- 已打开且当前不可见的 mod route instance 默认进入 `background-throttled`
- 普通 tab 切换不得仅因 hidden tab 数量变化而将已打开 route instance 转为 `discarded`
- `discarded` 只允许在 tab 被关闭、mod 被禁用/卸载、或 host 明确销毁 route instance 时出现
- `frozen` 在 same-tree host 中保留为未来更强策略的兼容状态，不得作为常规 tab 切换的默认结果

## Fact Sources

- `tables/hook-subsystems.yaml` — Hook 子系统枚举
- `tables/hook-capability-allowlists.yaml` — Source-type 能力白名单
- `tables/ui-slots.yaml` — UI 扩展槽位
- `tables/turn-hook-points.yaml` — Turn hook 挂载点
