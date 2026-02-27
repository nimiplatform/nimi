---
title: Nimi Mod SSOT
status: ACTIVE
version: v2.8
updated_at: 2026-02-25
rules:
  - Mod 接入必须通过 execution-kernel + hook + llm-adapter，不得直连 core 数据平面。
  - Agent Chat 业务执行规范统一引用 `@nimiplatform/nimi-mods/local-chat/SSOT.md`；Mod 域不重复定义该业务规则。
  - World Studio 业务执行规范统一引用 `@nimiplatform/nimi-mods/world-studio/SSOT.md`；Mod 域不重复定义其阶段状态机、路由门禁与维护流程细节。
  - Kismet 业务执行规范统一引用 `@nimiplatform/nimi-mods/kismet/SSOT.md`；Mod 域不重复定义其推理与可视化业务细节。
  - Re:Life（Decision Retrospect）业务执行规范统一引用 `@nimiplatform/nimi-mods/re-life/SSOT.md`；Mod 域不重复定义其决策回顾与平行时空模拟业务细节。
  - 跨域”AI 最后一公里”总语义以 `ssot/platform/ai-last-mile.md` 为准；本域仅定义 Mod 接入边界与治理规范。
  - Hook Action 执行模式固定为 `full|guarded|opaque`；`opaque` 为 V1 正式等级，非临时降级态。
  - Mod 对 Hook Action 的接入必须保持透明：Mod 仅声明/调用 Action，授权/前置校验/降级/审计由 runtime 包装治理层负责。
  - Mod 不得直接写经济账本与核心身份数据，只能走受控 API。
  - 平台受保护能力（economy-write/identity-write/platform-cloud-write）必须携带 nimi-realm control-plane grant token。
  - 高风险本地能力（network/filesystem/process）必须显式用户授权，不得静默放权。
  - 安装/启用/禁用/卸载/升级/执行必须产生本地审计事件。
  - 任何 Action（含 `opaque`）执行都必须有持久审计记录；无审计视为协议违规。
  - 审计上报 nimi-realm 为可配置能力；sideload 可由用户关闭。
  - 单 Mod 故障不得影响 Core 可用性（CrashIsolator 横切子系统必须存在）。
  - local-only Mod 运行不得把 nimi-realm 作为硬依赖。
  - 固定治理链 8 环节不可裁剪：discovery → manifest/compat → signature/auth → dependency/build → sandbox/policy → load → lifecycle → audit。
  - `high risk` Action 不允许 `opaque` 执行模式。
  - Action 写操作缺失 `idempotencyKey` 必须拒绝执行。
  - Action `commit` 必须落持久 execution ledger（`accepted -> executing -> committed|failed|replayed`）；持久化不确定性默认 fail-close 且同 key 重试不得重复副作用。
  - Core 能力判定唯一标准是"脱离 mod 后是否仍为必需产品能力"，不得因 runtime 重构而误删。
  - 涉及 `@nimiplatform/sdk/*` 的接口规范仅以 `ssot/sdk/*` 为真相源；本文件对 SDK 的描述属于 Mod 侧治理投影。
  - TTS（Speech）规范唯一归属本文件；业务 Mod 只能引用，不得在各自 SSOT 重复定义 provider 协议细节。
  - 本地 AI Runtime 的模型来源、路由来源、能力维度与审计策略以 `ssot/runtime/local-runtime.md` 为唯一来源；本文件仅定义 Mod 接入边界。
  - Speech 类能力必须通过 `llm.speech.*`（llm-adapter 语义）承载；调用方 Mod 不得绕过 capability 直连 provider。
  - `providerId` 在 Speech 请求中只表达 provider 标识，不承载 route source；路由来源必须通过 `routeSource`（可选）显式表达。
  - Mod AI 调用稳定入口统一为 `@nimiplatform/sdk/mod/ai`（`generateText|streamText|generateObject|generateImage|generateVideo|transcribeAudio|generateEmbedding|synthesizeSpeech`）；不保留 `llm.invokeScenario` 兼容 shim。
  - Mod Manifest 的 AI 扩展字段主规范固定为 `ai.consume + ai.dependencies(v2)`；禁止 legacy model packs 字段。
  - `ai.dependencies(v2)` 的 `kind` 只允许 `model|service|node`；依赖求解由 runtime 执行，Mod 不得绕过。
  - runtime 依赖解析以 `mod.manifest.yaml` 为运行时真源；源码 manifest 必须与其保持语义一致。
  - Runtime Setup 可对用户开放 `Verified + HF Catalog` 搜索与安装，但该能力仍由 Core 控制面执行；Mod 仅可声明需求与引导用户操作，不得直接触发生命周期写命令。
  - 业务 Mod 的用户可见文案必须由 mod i18n 机制统一管理；`world-studio` 当前为 en/zh 双语强制纳管（算法词典/正则/prompt 可按域规则排除）。
  - Hook SDK 客户端创建入口固定为 `createHookClient(modId)`；禁止恢复 `createModHookClient` 别名入口。
  - `mod-sdk` 内部类型别名不得保留 `CreateModHookClient`；统一使用 `createHookClient` 概念与命名，避免 Hook DX 语义分叉。
  - Hook/AI 健康检查类型口径固定：`hook.llm.checkHealth(RuntimeLlmHealthInput) -> RuntimeLlmHealthResult`，`ai.checkRouteHealth(...) -> RuntimeRouteHealthResult`，禁止回退 `Record<string, unknown>`。
  - `@nimiplatform/sdk/mod` 对 Mod 的稳定导入面固定为 `ai/hook/types/ui/logging/utils/model-options/runtime-route`；禁止 root import，禁止依赖 `runtime/internal` 装配接口，`host` 仅允许运行时装配层使用。
  - `runtime-hook` 类型组织固定为按域文件（`event/data/turn/ui/inter-mod/llm/meta/shared/index`），禁止恢复 `runtime-hook/client/*` 与 `runtime-hook/facade/*` 目录。
  - `hook-runtime` 对外门面签名必须在独立 contract 文件显式声明（如 `runtime/hook/contracts/facade.ts`）；禁止只依赖 `Parameters<T>[0]` 推断作为唯一可读入口。
  - 非 `index.ts/tsx` 文件禁止“一行 re-export 壳”；调用点必须直连真实实现模块，避免调试跳转层。
  - 禁止同一路径下出现“文件名与目录名同名/近同名”的双入口形态（如 `runtime.ts + runtime/`、`openai-compatible.ts + openai-compatible/`、`engine.ts + engine/`），必须统一为目录边界 `index.ts` 方案。
  - renderer `features/*` 禁止保留单跳入口壳；仅 `mods/*/*-page.tsx` 可作为页面边界入口保留薄容器。
  - World Studio 主面板必须直接挂载 `create-workbench/maintain-workbench`，禁止恢复 `create-main-panel.tsx` / `maintain-main-panel.tsx` 之类单跳壳组件。
  - World Studio 控制层输入模型统一为 `WorldStudioViewModel` 语义，禁止恢复 `shell-input-builder` 命名。
  - `data-sync/facade.ts` 与 `execution-kernel/kernel.service.ts` 必须保持编排层职责，业务细节下沉到 `flows/*`。
  - `runtime/state/store.ts` 必须只保留 store 组装与跨 slice 编排；`storage/cache/event-emitter` 必须放在 `runtime/state/core/*`，禁止回流内嵌 class。
  - `runtime-config` provider connectors 必须采用 `view + actions + connector-capability-patch` 分层；UI 容器禁止直接实现 capability 选择补丁循环。
  - runtime query 面板必须采用 `parse + execute + field-bindings + view + panel(container)` 分层，禁止将解析器逻辑回流到 UI 容器。
  - renderer `bridge.ts` 必须直接组装真实 runtime bridge 能力，禁止恢复 `event/data/ui/llm` 的薄代理桥接层。
  - mod-ui `slot-host` 必须采用 `conflict-log + render-entry + retry-runtime-mod` 分层；Host 容器只保留装配与注册顺序。
  - `app-store` 必须采用 `store-slices/* + store-types.ts` 组织，`app-store.ts` 仅保留切片装配入口。
  - World Studio `contracts.ts`、`data.ts` 作为边界入口文件保留，具体实现下沉到 `contracts/*` 与 `data/queries/*`。
  - World Studio 控制层工具调用固定直连 `snapshot-normalize` / `event-graph-map` / `mutation-payload`，禁止恢复 `world-studio-page-utils` 门面转发层。
  - World Studio 面板回调与冲突判定绑定固定在 `controllers/world-studio-view-model-builder.ts` 的 `panelBindings` 输出；页面主链固定 `page-controller -> view-model-builder(panelBindings) -> panel-builders`，不得回流额外组合中间层。
  - World Studio 路由覆盖与 hydration 必须采用分域组合（`hooks/route-overrides/{store,derived,actions}`、`hooks/hydration/{hydrate-draft,hydrate-maintain}`），禁止回流到单文件双流程实现。
  - World Studio hydration 输入类型固定为 `snapshot: WorldStudioWorkspaceSnapshot` + `patchSnapshot: WorldStudioSnapshotPatch`，禁止在 controller 层使用 `unknown -> Record<string, unknown>` 强转。
  - World Studio `services/index.ts` 仅允许导出 `snapshot-normalize` / `event-graph-map` / `mutation-payload`，禁止跨域导出 `data.ts` 或 `generation/pipeline.ts`。
  - runtime-config provider 命令入口必须直连 `discover-command` / `health-command` / `connector-test-command`，禁止恢复 `domain/provider-connectors/commands.ts` 中间转发层。
  - runtime-config 命令编排固定在 `runtime-config-panel-commands.ts`，禁止恢复 legacy provider/capability 透传 actions。
  - runtime-config 命令链固定为 `runtime-config-panel-commands -> commands/* -> domain/*`，`panel-commands` 仅允许 guard + 编排，不得内联 provider 探测与 route apply 计算实现。
  - runtime-config `commands/context.ts` 仅允许命令级最小上下文（provider health seed / capability seed），禁止回流整包 panel state 透传。
  - runtime host capability bridge 必须优先显式 typed helper（如 `toRecordOrNull/toWorldStatusParam`）；禁止在业务方法散落 `as never` 与 `as Record<string, unknown>` 强转。
  - 任意新增中间层/封装层必须证明能减少调试跳转并提升可定位性；无法证明收益的新增层级禁止合入。
  - runtime control-plane client 固定分层 `client(endpoint语义) + env + endpoints + http + error-map`，禁止在 `client.ts` 回流环境解析与 URL 拼接细节。
  - runtime mod lifecycle 固定分层 `lifecycle(orchestrator) + lifecycle-{validate,register,unregister,telemetry}`，禁止回流能力校验和注册细节到 orchestrator。
  - runtime mod sideload discovery 固定分层 `external/sideload(orchestrator) + {load-factory,build-registration,report-error}`，禁止恢复 discover-external 或单体流程文件。
  - runtime mod external discovery 仅允许 `discovery/index.ts -> external/injected|sideload` 直连，禁止恢复 `discover-external.ts` 转发层。
  - settings 面板必须保持 `settings-panel-body.tsx` 作为 feature 入口并承载视图编排，视觉常量应放在独立资产模块。
  - 核心 feature 页面（marketplace/login/explore/contacts/main-layout）必须采用 `controller/view` 或 `container/view` 分层，页面容器不承载业务流程与协议映射。
  - `apps/desktop/src/client/*` 属于生成代码层，禁止手工修改；调用侧只能在外层适配器组织行为。
  - Mod 发现链路必须按 `module-loader/factory-resolver/manifest-capabilities/discover-*` 分域，`runtime/mod/discovery/index.ts` 仅做聚合入口。
  - 默认内置 Mod 也必须采用 external 目录形态（`nimi-mods/<id>/mod.manifest.yaml + index.ts + dist/index.js`），运行时统一走 `list manifests -> discover sideload -> register` 单链路。
  - 默认 Mod 的 root manifest 能力与版本必须与源码单源（`*_PERMISSIONS` 与 `src/manifest.ts`）严格一致；漂移必须由守卫直接阻断。
  - 禁止恢复 builtin 专用发现/注册路径（含 `discoverBuiltinRuntimeMods`、`registerBuiltinRuntimeMods`、`VITE_NIMI_MOD_DEV_BUILTIN`）。
  - 默认 Mod 的源码 manifest 禁止回流 builtin 叙事（如 `hash: 'builtin-*'`、`built-in mod` 注释/文案）；统一使用 external/default 术语（如 `default-*`）。
  - `no-builtin-mod-loading-path` 守卫扫描范围固定覆盖 `src/**` 与默认 Mod 的 `nimi-mods/*/src/manifest.ts`，确保加载路径与术语双向不回流。
  - `builtin` 作为 Hook 权限来源枚举保留（用于策略分层），但不再对应独立的 mod 加载分支。
  - `window.__NIMI_RUNTIME_MOD_FACTORIES__` 注入路径仅用于 dev/test 调试，不得承载默认 Mod 主链语义。
---

# Nimi Mod 唯一真相（SSOT）

## 1. 目标与边界

Mod 域目标：

1. 定义可插拔上层产品能力的接入、治理、安全与审计规范。
2. 保证 Mod 扩展不破坏 Core 稳定性和安全边界。
3. 让开发者可以在统一治理链下分发和运行 Mod。

Mod 域边界：

1. Mod 域定义：Mod 生命周期、治理链、权限模型、Hook 接入、LLM-Adapter 使用、分发模式、审计要求。
2. Mod 域不拥有：Core 产品能力定义（Core 域）、Runtime 双平面架构（Desktop 域）、经济账本（Economy 域）。
3. Mod 可以扩展 Core 能力，但不可替代 Core。

## 2. 核心概念

### 2.1 Mod

`Mod` 是可插拔上层产品能力，运行在 Runtime execution-plane 的沙箱中。

典型能力：小说生成、文游、狼人杀、world tour、叙事玩法扩展、本地聊天、本地 provider 切换。

### 2.2 Core 与 Mod 边界

`Core` = 脱离 Mod 后仍为必需的产品能力。

判定标准唯一：**不使用"runtime 最小化"裁剪 core；只按"是否属于无 mod 必需能力"判定**。

Core 典型能力：登录/授权、权限验证、用户体系、World/Agent 创建与维护、聊天、好友、用户/agent/world 搜索、翻译、经济结算。

Desktop 本地聊天/本地 provider 切换属于 Mod 能力；其业务执行规范见 `@nimiplatform/nimi-mods/local-chat/SSOT.md`，不在本文件重复定义。

### 2.3 Execution-Kernel

Desktop Mod Launcher，负责 Mod 的发现、校验、加载、执行、审计。默认位于 execution-plane（`desktop`）。

`CrashIsolator` 作为横切子系统确保单 Mod 故障不影响 Core 可用性。

### 2.4 Hook（Core API 开放层）

Mod 通过 Hook 获取 Core 能力，不得直连 Core 数据平面。

5 类 Hook 子系统：

| Hook 类型 | 语义 | 说明 |
|----------|------|------|
| `event-bus` | 事件订阅与发布 | Mod 可订阅 Core 事件，可发布 Mod 事件 |
| `data-api` | 读/写 Core 数据 | 受权限控制，走认证上下文 |
| `ui-extension` | UI 扩展注入点 | Mod 可注入自定义 UI 组件 |
| `turn-hook` | 回合扩展点 | `pre-policy / pre-model / post-state / pre-commit` |
| `inter-mod` | Mod 间通信通道 | Mod 之间的消息传递 |

Core 数据读桥接规则（冻结）：

1. `nimi-mods/*` 不允许依赖 `@nimiplatform/sdk/mod/host`。
2. Mod 读取 Core 数据必须通过 capability 查询（如 `data-api.core.*`）。
3. runtime 负责注册 `data-api.core.*` provider；Mod 只消费能力键，不感知宿主实现细节。

Speech 相关能力不归类为 `data-api`，统一归入 `llm-adapter` 能力空间，见 2.6。

#### 2.4.1 Hook Action（对 Mod 透明）

1. Hook Action 不是第 6 类 Hook，而是建立在既有 Hook 体系上的 Action 粒度注册协议。
2. Mod 稳定调用面固定为 `hook.action.discover / hook.action.dryRun / hook.action.verify / hook.action.commit`（或等价 SDK API）。
3. Mod 只声明 action schema、权限边界与 handler 能力，不自行实现授权、社交前置、降级与审计策略。
4. runtime 包装治理层必须统一执行：`auth -> schema -> permission -> social precondition -> idempotency -> execute -> audit`。
5. descriptor 语义矩阵必须在注册期强校验：`full=>supportsDryRun=true`、`opaque=>supportsDryRun=false`、`write=>idempotent=true`、`high risk` 禁止 `opaque`。

### 2.5 LLM-Adapter（共享算力层）

固定在 Desktop 的共享算力层，Mod 通过 Hook 使用：

| 组件 | 职责 |
|------|------|
| `local-ai-runtime-supervisor` | 本地引擎与模型统一编排（本地模型生命周期与健康门禁） |
| `provider-adapters` | 云端 Provider 适配（OpenAI, Claude, Gemini 等） |
| `capability-router` | 能力 → 模型/Provider 路由 |
| `credential-vault` | 凭证管理（非明文存储） |
| `usage-tracking` | 调用计量与配额跟踪 |

Local-first：优先本地 Provider/模型，cloud 为可选。

Mod AI 调用规范（冻结）：

1. 业务 Mod 的文本能力调用统一通过 `@nimiplatform/sdk/mod/ai`。
2. 稳定接口集合：
   - `generateText`
   - `streamText`
   - `generateObject`
   - `generateImage`
   - `generateVideo`
   - `transcribeAudio`
   - `generateEmbedding`
   - `synthesizeSpeech`
3. `llm.invokeScenario` 与 `resolveScenarioRuntimeConfig` 不作为对 Mod 的稳定入口。
4. 具体模型来源、路由来源与能力维度约束统一由 `ssot/runtime/local-runtime.md` 定义。

`mod-sdk` 公共面约束（冻结）：

说明：本段是 Mod 侧调用约束投影；SDK 规范定义请以 `ssot/sdk/mod-contract.md` 与 `ssot/sdk/package-surface.md` 为准。

1. Mod 层只允许从 `@nimiplatform/sdk/mod/ai`、`@nimiplatform/sdk/mod/hook`、`@nimiplatform/sdk/mod/types`、`@nimiplatform/sdk/mod/ui`、`@nimiplatform/sdk/mod/logging`、`@nimiplatform/sdk/mod/utils` 导入。
2. `@nimiplatform/sdk/mod` root import 视为违规；`@nimiplatform/sdk/mod/runtime`、`@nimiplatform/sdk/mod/host`、`@nimiplatform/sdk/mod/internal/*` 属于运行时装配细节，不作为 Mod 稳定接口。

### 2.6 AI 能力标准接入（唯一口径）

AI 能力统一属于 `llm-adapter` 能力扩展，不属于 `data-api` 资源读写能力。

标准能力名（冻结）：

1. `llm.text.generate`
2. `llm.text.stream`
3. `llm.image.generate`
4. `llm.video.generate`
5. `llm.embedding.generate`
6. `llm.speech.providers.list`
7. `llm.speech.voices.list`
8. `llm.speech.synthesize`
9. `llm.speech.transcribe`
10. `llm.speech.stream.open`
11. `llm.speech.stream.control`
12. `llm.speech.stream.close`
13. 事件主题：`speech.stream.{streamId}`（通过 `event-bus` 推送）

Route Source 与 Capability 口径由 `ssot/runtime/local-runtime.md` 统一定义：

1. route source: `local-runtime | token-api`
2. capabilities: `chat | image | video | tts | stt | embedding`
3. Local AI Runtime 依赖抽象固定为 `model -> service -> node`；Mod 仅声明依赖，不直接托管生命周期。

标准类型（冻结）：

1. `SpeechProviderDescriptor`
2. `SpeechVoiceDescriptor`
3. `SpeechSynthesizeRequest`
4. `SpeechSynthesizeResult`
5. `SpeechErrorCode`
6. `SpeechStreamOpenRequest`
7. `SpeechStreamOpenResult`
8. `SpeechStreamControlRequest`
9. `SpeechStreamEvent`

`SpeechSynthesizeRequest` 最小字段：

1. `text: string`
2. `providerId?: string`
3. `routeSource?: 'auto' | 'local-runtime' | 'token-api'`
4. `voiceId: string`
5. `language?: string`
6. `stylePrompt?: string`
7. `format: 'mp3' | 'wav' | 'pcm16'`
8. `sampleRateHz?: number`
9. `speakingRate?: number`
10. `pitch?: number`
11. `targetId?: string`
12. `sessionId?: string`

`providerId` 语义：

1. `providerId` 仅标识 provider，不承载 route source。
2. route source 需使用 `routeSource`；未传时按 runtime 默认 `auto(local-first)` 解析。
3. 禁止把 `local-runtime/token-api` 当作 `providerId` 传入；此类值必须通过 `routeSource` 表达，否则请求按 `SPEECH_PROVIDER_UNAVAILABLE` 失败。
4. 自动路由失败时返回 `SPEECH_PROVIDER_UNAVAILABLE`。

`SpeechSynthesizeResult` 最小字段：

1. `audioUri: string`（统一播放入口，调用方不处理 provider 原始流）
2. `mimeType: string`
3. `durationMs?: number`
4. `providerTraceId?: string`
5. `cacheKey?: string`

`SpeechErrorCode` 最小集合：

1. `SPEECH_CAPABILITY_UNAVAILABLE`
2. `SPEECH_PROVIDER_UNAVAILABLE`
3. `SPEECH_SYNTHESIS_FAILED`
4. `SPEECH_OUTPUT_INVALID`
5. `SPEECH_STREAM_UNSUPPORTED`
6. `SPEECH_STREAM_PROTOCOL_ERROR`
7. `SPEECH_STREAM_BACKPRESSURE_TIMEOUT`
8. `SPEECH_STREAM_ABORTED`

`SpeechStreamOpenRequest` 最小字段：

1. `text: string`
2. `voiceId: string`
3. `providerId?: string`
4. `routeSource?: 'auto' | 'local-runtime' | 'token-api'`
5. `language?: string`
6. `stylePrompt?: string`
7. `format?: 'pcm16' | 'mp3' | 'opus'`
8. `sampleRateHz?: number`
9. `chunkMs?: number`
10. `targetId?: string`
11. `sessionId?: string`

`SpeechStreamOpenResult` 最小字段：

1. `streamId: string`
2. `eventTopic: string`（形如 `speech.stream.{streamId}`）
3. `format: 'pcm16' | 'mp3' | 'opus'`
4. `sampleRateHz: number`
5. `channels: number`
6. `providerTraceId?: string`

`SpeechStreamControlRequest` 最小字段：

1. `streamId: string`
2. `action: 'pause' | 'resume' | 'cancel'`
3. `reason?: string`

`SpeechStreamEvent` 最小字段：

1. `start`
字段：`type='start'`, `streamId`, `format`, `sampleRateHz`, `channels`, `providerTraceId?`
2. `chunk`
字段：`type='chunk'`, `streamId`, `seq`, `audioBase64`, `durationMs`, `textOffsetStart?`, `textOffsetEnd?`
3. `mark`（optional）
字段：`type='mark'`, `streamId`, `markId`, `textOffsetStart`, `textOffsetEnd`
4. `end`
字段：`type='end'`, `streamId`, `totalChunks`, `durationMs`
5. `error`
字段：`type='error'`, `streamId`, `errorCode`, `message`, `retryable`

实时流式最小契约（冻结）：

1. `llm.speech.stream.open` 成功后返回 `streamId` 与 `eventTopic`。
2. `eventTopic` 上必须按统一事件协议发送：`start -> chunk* -> end | error`。
3. `chunk` 事件必须包含单调递增 `seq` 与音频分片载荷（`audioBase64`，Phase 6 初始方案）。
4. `llm.speech.stream.control` 支持 `pause | resume | cancel`。
5. `llm.speech.stream.close` 必须幂等；close 后迟到 chunk 必须丢弃并审计。
6. `mark` 事件为可选能力；缺失时调用方不得依赖文本高亮对齐。
7. `audioBase64` 为首版通用载荷；后续可演进为 binary transfer，但不改变事件语义。

接入原则：

1. 任何业务 Mod（如 local-chat）只消费上述能力，不定义 provider 协议字段。
2. provider 私有协议适配必须封装在 Speech Mod 或 SpeechAdapter 内。
3. 文本生成与语音合成是两段链路：先文本，后 `llm.speech.synthesize`。
4. 实时流式是可选能力：不支持 streaming 的 provider 必须返回 `SPEECH_STREAM_UNSUPPORTED`，调用方可回退非流式 `llm.speech.synthesize`。
5. 推荐流程：先查 `providers.list.capabilities` 是否含 `streaming` 再开流；`stream.open` 返回 `SPEECH_STREAM_UNSUPPORTED` 时作为安全网回退非流式。
6. `stylePrompt` 与 `language` 由 runtime/provider 适配层映射（如 `stylePrompt -> providerParams.instruct`, `language -> providerParams.language`）；业务 Mod 不直接拼接厂商私有字段。

## 3. 全局硬约束（MUST）

1. Mod 接入必须通过 `execution-kernel + hook + llm-adapter`，不得直连 Core 数据平面。
2. Mod 不得直接写经济账本与核心身份数据，只能走受控 API。
3. 平台受保护能力（`economy-write/identity-write/platform-cloud-write`）必须携带 nimi-realm control-plane grant token。
4. 高风险本地能力（`network/filesystem/process`）必须显式用户授权，不得静默放权。
5. 安装/启用/禁用/卸载/升级/执行必须产生本地审计事件。
6. 审计上报 nimi-realm 为可配置能力；sideload 可由用户关闭。
7. 单 Mod 故障不得影响 Core 可用性（`CrashIsolator` 横切子系统必须存在）。
8. local-only Mod 运行不得把 nimi-realm 作为硬依赖。
9. nimi-realm 不承载第三方 Mod 的默认执行宿主职责。
10. 业务 Mod 的用户可见文案必须纳入对应 mod i18n 字典并受守卫检查；`world-studio` 当前必须满足 en/zh 双语覆盖。
11. `opaque` Action 允许上线，但必须持久审计并返回可追溯字段（`traceId/auditId`）。
12. `high risk` Action 禁止 `opaque` 执行；违反时必须拒绝并返回明确 reasonCode。
13. Action 写操作缺失 `idempotencyKey` 必须拒绝执行，不得 best-effort 提交。
14. Action 写操作遇到“同 `idempotencyKey` 不同输入”必须拒绝并返回 `ACTION_IDEMPOTENCY_KEY_CONFLICT`。

## 4. 固定治理链

```
discovery → manifest/compat → signature/auth → dependency/build → sandbox/policy → load → lifecycle → audit
```

约束：

1. 8 环节不可裁剪。
2. 各环节必须输出结构化决策记录。
3. 任何 `DENY` 必须阻断进入下一环节。
4. 本地审计不可关闭。

各环节职责：

| 环节 | 职责 | 输出 |
|------|------|------|
| `discovery` | 发现本地/远程 Mod 包 | Mod 候选列表 |
| `manifest/compat` | 解析 ModManifest，检查 runtime 版本兼容性 | 兼容性决策 |
| `signature/auth` | 签名校验，来源认证 | 签名决策 |
| `dependency/build` | 依赖解析，版本冲突检查 | 依赖图谱 |
| `sandbox/policy` | 沙箱约束配置，权限策略应用 | 沙箱配置 |
| `load` | 加载 Mod 到 isolate | 加载凭证 |
| `lifecycle` | 生命周期钩子执行（onLoad/onEnable/onDisable/onUnload） | 生命周期事件 |
| `audit` | 本地审计事件写入 | 审计记录 |

## 5. 准入模式

| 模式 | 签名校验 | Control-Plane | 说明 |
|------|---------|--------------|------|
| `official` | 必须通过 | 优先接入 | 官方 Mod，最高信任度 |
| `community` | 必须通过 | 优先接入 | 社区分发，需签名验证 |
| `sideload` | 告警可继续 | 可关闭 | 用户自行安装，告警后可继续 |
| `local-dev` | 告警可继续 | 可关闭 | 本地开发模式 |

四档共享同一治理链。Control-plane 不可用时，不得阻断 local-only 执行。

## 6. 权限模型

### 6.1 能力分类

| 分类 | 授权方式 | 示例 | 说明 |
|------|---------|------|------|
| 平台受保护能力 | Nimi-realm control-plane grant token | `economy-write`, `identity-write`, `platform-cloud-write` | 必须由 nimi-realm control-plane 发放短期授权令牌 |
| 高风险本地能力 | 显式用户授权（consent UX） | `network`, `filesystem`, `process` | 必须弹窗确认，不得静默放权 |
| 标准 Hook 能力 | Manifest 声明 | `event-bus`, `data-api`, `ui-extension` | 在 ModManifest 中声明即可使用 |

Action 级权限映射（固定）：

1. `riskLevel=low`：可走 `full/guarded/opaque`，但 `opaque` 仍必须持久审计。
2. `riskLevel=medium`：默认走 `full/guarded`；若策略允许 `opaque`，必须满足审计与幂等门禁。
3. `riskLevel=high`：只允许 `full/guarded`；`opaque` 固定拒绝。

### 6.2 安全底线

1. Mod 执行必须在 desktop isolate（JS/WASM isolate）中运行。推荐 `QuickJS` 或 `V8 Isolate`。
2. 未授权调用必须中断并审计。
3. 不允许绕过 Hook 直接开放 Core 数据平面给 Mod。

### 6.3 Speech Mod 治理边界

1. Speech Mod 属于标准 Hook 能力扩展，不等同于 Core 内置引擎。
2. 官方 Speech Mod 可走 Nimi 托管下载分发；仍需经过固定治理链 8 环节。
3. Speech Mod 必须输出统一可播放结果（如 `audioUri`）并映射稳定错误码。
4. 业务 Mod 不得直接调用 provider 私有 endpoint；必须经 `llm.speech.*` 契约调用。
5. 语音业务消费规则由各业务 SSOT 引用本规范，不得复制或改写本规范字段定义。

## 7. Mod Manifest

`ModManifest` 声明 Mod 元数据、兼容性、权限、依赖、入口：

### 7.1 Manifest 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String | Mod 唯一标识 |
| `name` | String | Mod 显示名称 |
| `version` | String | 语义化版本 |
| `compatibility` | Object | 最低 runtime 版本要求 |
| `capabilities` | Array | 所需能力声明（标准/高风险/受保护） |
| `ai.consume` | Array | Mod 声明消费的 AI 能力维度（chat/image/video/tts/stt/embedding） |
| `ai.dependencies` | Object | Mod AI 依赖图声明（required/optional/alternatives/preferred） |
| `dependencies` | Array | 依赖 Mod 或库 |
| `entry` | String | 入口文件路径 |
| `lifecycle` | Object | 生命周期钩子声明 |

### 7.2 AI 依赖声明（v2 主规范）

`ai.dependencies` 的 dependency kind 仅允许：

1. `model`：纯模型资产依赖。
2. `service`：运行时服务依赖（可能含 Python/binary 环境要求）。
3. `node`：能力节点契约依赖（只读目录引用）。

强约束：

1. `ai.dependencies` 是 runtime 依赖求解输入真源；`ai.consume` 仅作能力摘要。
2. legacy model packs 字段为禁用项；出现即视为 manifest 协议违规。
3. 运行时解析以 `mod.manifest.yaml` 为真源，源码 manifest 必须与其保持语义一致。
4. Mod 不可直接调用 `install/remove/start/stop/dependencies.apply` 等生命周期写命令。

### 7.3 生命周期钩子

| 钩子 | 时机 | 说明 |
|------|------|------|
| `onLoad` | Mod 加载到 isolate 后 | 初始化资源 |
| `onEnable` | Mod 被启用时 | 注册 Hook、绑定事件 |
| `onDisable` | Mod 被禁用时 | 解绑事件、释放资源 |
| `onUnload` | Mod 被卸载时 | 清理所有状态 |

## 8. 语义对象

### 8.1 Execution-Kernel 语义对象

| 对象 | 语义 |
|------|------|
| `ModManifest` | Mod 元数据、兼容性、权限、依赖、入口声明 |
| `ModSignature` | Mod 包来源与完整性证明 |
| `DependencyGraph` | Mod 依赖与版本冲突解析结果 |
| `SandboxProfile` | Mod 沙箱执行约束 |
| `PermissionGrant` | Mod 能力授权结论 |
| `ComplianceDecision` | 合规与安全审查结论 |
| `LoadTicket` | 加载凭证 |
| `ExtensionAuditEvent` | 生命周期审计事件 |

## 9. nimi-realm 边界

### 9.1 nimi-realm 不做什么

1. 不承载第三方 Mod 的默认执行宿主职责。
2. 不替代 Desktop 的本地执行职责。

### 9.2 nimi-realm 可选治理服务（Control-Plane）

1. Manifest/Signature 校验 API。
2. 信任情报与撤销列表分发（revocation/risk feed）。
3. 平台受保护能力授权令牌（grant token）发放。
4. 审计汇聚与风控联动。

### 9.3 nimi-realm Apps（进程级边界）

- Core Apps: `api`, `brain`, `realtime`
- Platform-Ops Apps: `indexer`, `scheduler`, `worker`

### 9.4 nimi-realm API Modules

- Core Modules: `auth`, `user`, `agent`, `world`, `chat`, `creator`, `relationship`, `visibility`, `economy`, `search`, `discover`, `explore`, `translation`, `human`, `media`, `notification`, `post`
- Core-Adjacent Modules: `agent-surface`, `creator-surface`, `world-surface`, `invitation`, `desktop`, `discovery-engine`
- Platform-Ops Modules: `@admin`, `governance`, `support`, `referral`, `asset`

### 9.5 nimi-realm Domains（domain boundary）

- Core/Core-Adjacent: `user`, `agent`, `world`, `world-context`, `chat`, `relationship`, `social`, `economy`, `desktop`, `translation`, `discovery-engine`, `content`, `notification`, `access-control`, `tier`
- Platform-Ops: `asset`, `governance`, `referral`, `support`

## 10. 非目标（当前版本）

1. 不在本版本内做 Mod 商城（Marketplace）完整分发系统。
2. 不做多人协同 Mod 开发。
3. 不在 nimi-realm 恢复第三方 Mod 默认执行宿主职责。
4. 不在非 Desktop 端重复实现 `llm-adapter` runtime。
5. 对 `nimi-realm` 的 Core/Core-Adjacent 不做功能删减式瘦身。

## 11. 与业务 SSOT 的关系（独立性约束）

1. `ai-last-mile.md` 定义跨域总语义（关系连续性 + 能力接入标准化），本域仅承接能力接入侧的 Mod 规范。
2. `local-ai-runtime.md` 是本地 AI 基建（模型来源、导入校验、路由来源与能力维度）的唯一来源。
3. `mod/governance.md` 负责 Mod 接入边界与 capability 契约（含 Speech 字段定义）。
4. 业务 Mod SSOT 统一在 `@nimiplatform/nimi-mods/<mod>/SSOT.md` 维护，只声明“消费方式与业务行为”，不得重定义协议。
5. `@nimiplatform/nimi-mods/world-studio/SSOT.md` 是 World Studio 模式下“事件中心创建/维护/发布”的专项业务真相文件。
6. `@nimiplatform/nimi-mods/re-life/SSOT.md` 是 Re:Life 模式下“决策回顾/平行时空模拟/分享”的专项业务真相文件。
7. 若出现跨文档冲突，先按域边界裁决：基建语义以 `local-ai-runtime.md` 为准，Mod 接入语义以本文件为准。

## 12. 面向开发的落地准则

1. 新 Mod 必须提供完整 `ModManifest`。
2. 需要 Core 数据的 Mod 必须通过 `data-api` Hook，不得直连服务层。
3. 需要平台受保护能力的 Mod 必须设计 grant token 申请流程。
4. 所有 Mod 必须处理 `CrashIsolator` 隔离，确保故障不扩散。
5. Mod 扩展 Core 能力时不可替代 Core 原有功能。
6. 新增 Hook 类型必须先定义语义对象。
7. LLM-Adapter 新增 Provider 必须遵循 `capability-router` 统一路由。

## 13. 兼容与演进原则

1. SSOT 变更优先更新本文件，再改代码。
2. 治理链变更属于破坏性变更，需迁移计划。
3. 新增权限分类必须更新本文档能力分类表。
4. Runtime 支持双轨安装：`Marketplace + sideload`。
5. 兼容 shim 不是默认迁移策略；若目标规则已明确，必须一次性切换到最终态。
6. 任何偏离以上规则的实现视为回归，必须阻断进入主分支。

## 14. 运行时命名与结构收敛（2026-02）

1. runtime-config 命名已收敛为 `Capability*`，禁止回流 `Scenario*` 类型符号。
2. `@nimiplatform/sdk/mod` 业务导入面保持子路径导入，不允许 root/import internal。
3. Mod 页面文件保持薄容器化，重逻辑下沉到 hooks/services/feature 模块。
