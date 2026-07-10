# SDK Runtime Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-010 Runtime Client Construction

Runtime SDK 不允许隐式全局单例。`@nimiplatform/sdk` 根入口的
`createNimiClient()` / `NimiClient` 是 app-owned 显式组合面：调用方明确
提供 Runtime、Realm、App、AI、Agent 与 feature surface 所需配置或实例，不
恢复 retired platform-client singleton。runtime 子路径上的 `new Runtime()`
仅作为允许的 low-level escape hatch，并保留 first-run 默认值：

- Node.js 环境下，`new Runtime()` 默认使用 `node-grpc` 连接本地 daemon。
- 默认 `appId` 为 `process.env.NIMI_APP_ID || 'nimi.app'`。
- 默认 endpoint 为 `process.env.NIMI_RUNTIME_ENDPOINT || '127.0.0.1:46371'`。
- 非 Node.js 环境下若未显式提供 transport，必须 fail-close 并返回可行动错误。

## S-RUNTIME-011 Module Projection

Runtime 子路径公开方法集合由 `runtime-method-groups.yaml` 约束，必须与 runtime kernel RPC 面对齐。

允许在 `Runtime` 类上提供 ergonomic convenience 方法（如 `generate()` / `stream()`），但必须是对既有 runtime text surface 的薄投影，不得分叉推理语义、错误语义或 trace/usage 语义。

当 `RuntimeCognitionService` 与 `RuntimeAgentService` 进入 public projection
后，runtime 子路径必须保持以下 authority split：

- `runtime.memory.*` 投影 `RuntimeCognitionService` 的 runtime-owned memory family
- `runtime.knowledge.*` 投影 `RuntimeCognitionService` 的 runtime-owned knowledge family
- memory embedding runtime readiness/bind/cutover methods remain under the
  `runtime.memory.*` SDK namespace, but they are host/runtime typed logical
  methods backed by retained runtime-private memory depth; they are not a new
  `RuntimeMemoryService` and not canonical agent memory direct-write shortcuts
- steady-state runtime-owned live agent control plane belongs to
  `RuntimeAgentService`
- the app-facing steady-state agent projection is `runtime.agent.*`
- reactive agent-chat consumption is currently carried through the admitted
  app-messaging transport addressed to reserved target `runtime.agent`, rather
  than a separate reactive-chat RPC family
- that agent projection may additionally project runtime-owned
  persistent `AgentPresentationProfile`
- canonical agent memory 的 app-facing mutation 统一经该 runtime-owned agent projection
- canonical agent memory bank status/bind 的 app-facing helper may be SDK
  DX/projection only when it delegates to `runtime.agent.*`; it must not
  combine memory embedding config, inspect state, or `GetBank` as a second
  status authority
- `runtime.memory.*` 不得被 app 误用为 canonical agent memory 直写捷径
- current-thread avatar interaction state must stay above runtime and must not be promoted into a new `runtime.avatar.*` truth surface

Runtime Agent AI Config（K-AGCORE-144~150）的 app-facing 面固定为
`runtime.agent.aiConfig.*` 逻辑模块：

- `get()` / `readiness()` / `subscribeReadiness()` 消费 committed config 与
  readiness projection；`upsert({ expectedRevision, intents })` 是唯一的
  mutation 入口，revision 冲突必须以 typed concurrent-modification 失败浮出，
  不得静默重试覆盖。
- SDK 不得缓存 readiness 作为自有 truth，不得从 `AIConfig` overlay、route
  projection、或 app 局部状态重算 agent chat binding truth。
- Agent turn request 不携带 execution binding payload（K-AGCORE-147）。turn
  runner 的 route/model 显示上下文只能来自 Runtime turn 事件/快照投影。

`runtime.route.describe(...)` 的 app-facing route metadata projection 边界由 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`）约束；在 runtime transport authority 定稿前，它不得被表述为新的 daemon convenience method。

media convenience 也必须遵守同一原则：新增 ergonomic API 只能封装既有 `ScenarioJob` + artifact 主链，不得引入新的推理语义或绕过 runtime 校验。`runtime.media.music.iterate()` 属于允许的薄投影，必须复用 `MUSIC_GENERATE` 与 `nimi.scenario.music_generate.request` 扩展面。

Runtime image helper `buildLocalProfileExtensions()` 仅用于编码 `entry_overrides` 与 `profile_overrides` 到既有 runtime request extension；Runtime music helper `buildMusicIterationExtensions()` 仅作为低层 extension builder。两者不是新的推理 owner，也不替代 `runtime.media.music.iterate()` 的官方主路径。

Runtime AI session-loop helpers are not Runtime daemon method projections. SDK
may expose app AI loop DX through core AI/Agent/features under
`S-SURFACE-020`, but those helpers must compose admitted Runtime AI consume
surfaces rather than adding ordinary product-session methods to
`RuntimeAiService` or recording app chat-history helpers in
`runtime-method-groups.yaml`.

`RuntimeAiService` remains the execution owner for AI consume, provider/model
routing, readiness, jobs, artifacts, audit/fail-closed enforcement, and typed
scenario output. It does not own ordinary app product `thread`, `message`,
`draft`, or session-history truth by default. Runtime-owned chat session truth
is admitted only through `RuntimeAgentService` Agent lifecycle or another
explicit Runtime authority rule.

已知 method id 的低层调用必须通过 `Runtime.call()` 与 method-id contract map 绑定；`runtime.raw` 兼容别名不再是允许的公开 surface。

high-level convenience targeting 必须满足：

- `runtime.generate({ prompt })` / `stream({ prompt })`：本地默认文本模型
- `runtime.generate({ model: '<local-model-id>', ... })`：本地显式模型
- `runtime.generate({ provider: '<provider>', ... })`：provider 默认文本模型
- `runtime.generate({ provider: '<provider>', model: '<model>', ... })`：provider 显式模型

其中 high-level `model` 只表示具体模型，不承担 provider/route alias 语义；fully-qualified remote model id 必须留在低层 `runtime.ai.text.*` surface，不得作为 high-level convenience public contract。

SDK 不解析 `~/.nimi/runtime/config.json` 或 `~/.nimi/nimi.json`；模型默认值
（`defaultLocalTextModel`、`defaultCloudProvider`、`provider.defaultModel`）由
runtime 按 K-CFG-002 优先级解析后通过 RPC 响应返回。SDK convenience 方法仅
传递调用方意图，不做本地 config 回退。

high-level local targeting 只允许：

- bare local default：`local/default`
- qualified local model：`local/<model-root>`
- canonical engine prefix：`llama/`、`media/`、`speech/`、`sidecar/`

`localai/`、`nexa/`、`nimi_media/`、`localsidecar/` 属于 invalid legacy input；SDK 不得继续把它们当作合法 public contract。

high-level app-facing runtime convenience surface 不得继续暴露 route/provider fallback 开关：

- `runtime.generate()` / `runtime.stream()`
- `runtime.ai.text.*`
- `runtime.media.*`
- core AI and independent adapter packages

这些 surface 必须固定使用 `FallbackPolicy.DENY`，不得允许调用方以 `fallback: 'allow' | 'deny'` 修改稳定 product contract。

## S-RUNTIME-012 Metadata Projection

connector/body 字段与 metadata 字段必须按 transport 合同分层传递。

## S-RUNTIME-015 ready() Fail-Close

Runtime `ready()` 探测失败必须抛出 `RUNTIME_UNAVAILABLE`，不得 fail-open。

## S-RUNTIME-023 Deferred Service Projection

Phase 2 deferred 服务必须显式标记不可用语义，不得冒充 active。

## S-RUNTIME-028 Disconnected Event

连接中断时 SDK 必须发射 `runtime.disconnected` 事件，重建决策交给调用方。

## S-RUNTIME-045 Retry Backoff Baseline

Runtime gRPC 重试基线为指数退避（200ms 初始，3000ms 上限），不自动重连流式订阅。

## S-RUNTIME-050 Blocked vs Deferred

blocked 与 deferred 是不同状态：blocked 由依赖缺失造成，deferred 属于路线图阶段控制。

## S-RUNTIME-066 Pagination Projection

Runtime List RPC 的分页默认值与 Realm REST 客户端分页默认值可不同，必须在文档层显式说明。

Runtime 分页具体默认值（`K-PAGE-001`）：
- 默认 `page_size` = 50
- 最大 `page_size` = 200
- 超出范围时 runtime 自动 clamp 至 [1, 200] 区间，不报错

## S-RUNTIME-067 鉴权与主体上下文分离

> **Authority Disposition**：
> 本规则仅在 **Web/cloud 与 external-principal 模式** 保留为 app-provided auth/subject seam。Local first-party Runtime 模式下，本规则被 superseded：local first-party SDK 不允许接收 app 提供的 `auth.accessToken`、`subjectContext`、refresh-token provider、session store、或 subject provider；account 上下文必须通过 Runtime account projection（`K-ACCSVC-005`）、Runtime-issued short-lived access-token provider（`GetAccessToken`）、和 scoped binding（`K-BIND-*`）消费。详见 `S-RUNTIME-109`。

Runtime SDK 必须将“鉴权 token”与“业务主体标识”分离建模：

- `auth.accessToken`：用于 Runtime AuthN（`authorization` 注入）。
- `subjectContext`：用于填充请求体 `subjectUserId`。

两者语义独立，不得复用同一配置字段。

**模式适用范围（authority split）：**

- Web / cloud 显式 adapter 模式：保留。
- external-principal 模式：保留。
- Local first-party Runtime account 模式：app-provided `auth.accessToken` / `subjectContext` provider **禁止**；仅允许 SDK 内部使用 Runtime-backed short-lived access-token provider。

Runtime SDK 还必须保持 multi-agent truth boundary：

- app 可以维护 local `current/default/pinned agent` UX state
- 该状态不得被提升为 runtime-owned platform default agent truth
- 每个 agent-scoped wire call 仍必须显式解析到一个 `agent_id`
- SDK 不得把 construction-time bound agent helper 作为 canonical public
  surface；multi-agent consume path 必须显式接收 `agent_id`

## S-RUNTIME-068 Subject Context 命名规范

RuntimeOptions 公开字段必须使用 `subjectContext` 命名，不得继续暴露 `authContext` 旧命名。

## S-RUNTIME-069 调度器并发拒绝

Runtime 调度器在 per-app 并发上限（2）或全局并发上限（8）达到时返回 `RESOURCE_EXHAUSTED`（`K-DAEMON-007`）。SDK 处理规则：

- `RESOURCE_EXHAUSTED` 属于 S-ERROR-004 定义的 retryable transport code，SDK 应按 S-RUNTIME-045 退避重试基线自动重试。
- 饥饿检测超时（30s）触发的拒绝同样投影为 `RESOURCE_EXHAUSTED`，SDK 行为一致。

## S-RUNTIME-070 Session 恢复协议

SDK 消费者应在 `runtime.disconnected` 事件（`S-RUNTIME-028`）处理器中无条件重新 `connect()` + `OpenSession()`（`K-AUTHSVC-012`）：

- 恢复失败按 S-RUNTIME-045 退避重试基线重试。
- 不区分网络故障和 daemon 重启——两者恢复策略相同（重新建立连接并打开新 session）。
- session 恢复是消费者侧职责，SDK 不自动执行（与 S-TRANSPORT-003 禁止隐式重连一致）。

## S-RUNTIME-071 Connector 字段预校验（建议性）

SDK 可在客户端侧对 Connector 操作执行预校验以改善 DX（`K-RPC-007`/`K-RPC-008`）：

- `CreateConnector`: 请求面只表示 `REMOTE_MANAGED` 创建路径，不接受调用方自定义 `kind`；`api_key` 必填。
- `UpdateConnector`: 至少包含一个可变字段，否则建议在客户端侧提前拒绝。

此规则为建议性（SHOULD），服务端强制校验是权威。客户端预校验旨在减少无效 RPC 往返。

## S-RUNTIME-072 Music Iteration Fail-Fast

SDK 对 `runtime.media.music.iterate()` 必须执行最小 fail-fast 预校验，以减少无效 RPC 往返：

- `mode` 只能是 `extend | remix | reference`
- `sourceAudioBase64` 必须非空且可解码
- `trimStartSec` / `trimEndSec` 必须为非负数
- 同时提供 start/end 时必须 `trimEndSec > trimStartSec`

该预校验不得替代 runtime 权威校验；服务端 reason code 仍是权威事实源。

## S-RUNTIME-073 Stable AI Output Typed Projection

SDK runtime 高层文本/embedding/语音与多媒体 convenience surface 必须直接消费稳定 typed proto output，不得继续把 `ExecuteScenarioResponse.output` 当作 `google.protobuf.Struct` 使用。

- `runtime.generate()` / `runtime.ai.text.generate()` 必须从 `ScenarioOutput.textGenerate` 投影文本结果。
- `runtime.embed()` / `runtime.ai.text.embed()` 必须从 `ScenarioOutput.textEmbed` 投影向量结果。
- `runtime.media.tts.synthesize()` 必须从 `GetScenarioArtifactsResponse.output.speechSynthesize` 投影稳定结果，不得仅把 artifact 列表当作隐式语义载体。
- `runtime.media.stt.transcribe()` 必须从 `GetScenarioArtifactsResponse.output.speechTranscribe` 投影转录结果，不得再从 artifact bytes 恢复文本语义。
- `runtime.media.image.generate()`、`runtime.media.video.generate()`、`runtime.media.music.generate()` 必须从 `GetScenarioArtifactsResponse.output.{imageGenerate|videoGenerate|musicGenerate}` 投影稳定结果，不得仅把 artifact 列表当作隐式语义载体。
- 文本 stable surface 必须以 typed `reasoning` 配置透传 `TextGenerateScenarioSpec.reasoning`；不得继续用 metadata、extensions 或自由对象拼装推理开关。
- 流式 text/speech/media helper 必须从 `ScenarioStreamDelta` 显式 oneof 分支读取 `text`、`reasoning` 或 `artifact`；不得依赖旧的自由字段或手工 `Record<string, unknown>` 解析。
- `runtime.ai.text.stream()` 的稳定顺序必须允许 `start -> reasoning-delta* -> delta* -> finish|error`；SDK 不得把 reasoning chunk 合并回普通 text，也不得在 unsupported provider 上伪造 reasoning 事件。
- high-level `Runtime.stream()` 若暴露文本 convenience chunk，也必须保留独立 reasoning chunk 类型；不得为了兼容旧 helper 折叠 reasoning 语义。
- `Struct` 仅允许出现在 low-level explicit-dynamic scenario/workflow 边界；稳定 product surface 不得把 `Struct` 暴露为默认 app-facing contract。
- stable helper 缺 typed output、缺 artifact metadata、缺稳定 mime/result 字段时必须 fail-close；不得补默认 `artifactId`、`application/octet-stream`、空 artifact 成功、或 content-type 占位值来伪装成功路径。

## S-RUNTIME-091 World Evolution Engine App-Facing Logical Facade Boundary

World Evolution Engine app-facing typed facade candidates may be published only as SDK logical consumer facades layered on already-admitted projection-visible Runtime shapes.

Allowed app-facing candidate families are limited to:

- observe family
- selector-read family
- request family

These candidates must follow `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-085` through `S-RUNTIME-096`) and must remain satisfiable through SDK public surface only.
Selector-read stable publication is additionally governed by `S-RUNTIME-102`.

They must not:

- be recorded as new daemon top-level RPC method groups
- imply `new Runtime()` or `@nimiplatform/sdk/runtime` already owns host-specific observation lifecycle or control-plane semantics
- bypass `S-RUNTIME-079` through `S-RUNTIME-084` projection hardcuts
- widen Runtime execution semantics beyond `K-WEV-*`

## S-RUNTIME-102 World Evolution Engine App-Facing Selector-Read Publication Profile

App-facing stable selector-read publication may exist only on the SDK public composition surface.

The stable app-facing logical namespace is fixed to `worldEvolution`.
The stable app-facing logical operations are fixed to:

- `worldEvolution.executionEvents.read(selector)`
- `worldEvolution.replays.read(selector)`
- `worldEvolution.checkpoints.read(selector)`
- `worldEvolution.supervision.read(selector)`
- `worldEvolution.commitRequests.read(selector)`

These app-facing logical methods must preserve the shared semantic matrix defined by `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-097` through `S-RUNTIME-101`).

`@nimiplatform/sdk/runtime` may share selector, result, rejection, and view type families for these methods, but it must not publish the selector-read methods themselves as:

- `Runtime` class convenience methods
- runtime-subpath daemon convenience methods
- new top-level RPC parity claims

App-facing selector-read publication must not add:

- observe or subscribe siblings
- session or lifecycle siblings
- effectful request siblings
- pagination or buffering semantics
- fallback or re-inference knobs

## S-RUNTIME-105 `worldEvolution` Non-Equivalence Boundary

The root-level `worldEvolution` logical namespace remains the SDK composition
surface for the adjacent `K-WEV` execution-evidence line governed by
`S-RUNTIME-091` and `S-RUNTIME-102`.

Boundary rules:

- `worldEvolution` is not the semantic owner of world feature helpers
- `worldEvolution` does not restore the removed `@nimiplatform/sdk/world`
  subpath
- execution-event, replay, checkpoint, supervision, and commit-request
  evidence publication remain distinct from world-domain fixture, render, and
  session composition semantics

## S-RUNTIME-103 Agent Presentation Projection Boundary

SDK runtime may project runtime-owned persistent `AgentPresentationProfile` and
the admitted transient `runtime.agent.turn.*` / `runtime.agent.presentation.*`
families plus admitted read-only `runtime.agent.state.*` projection only as
part of `runtime.agent.*` surfaces.

Fixed rules:

- the SDK may expose stable avatar asset refs, backend kind,
  expression/idle preset refs, default `VoiceReference` binding, anchor-scoped
  turn/text projections, backend-neutral presentation requests, status text,
  execution state, current emotion, and posture projection when runtime makes
  them public
- projection must remain downstream of `K-AGCORE-022` through `K-AGCORE-026`; SDK must not reinterpret missing profile fields into fallback avatar truth
- anchor-scoped turn/presentation projection must preserve
  `conversation_anchor_id`, `turn_id`, `stream_id`, and `message_id` semantics
  rather than collapsing them into app-local session guesses
- SDK must not publish a parallel top-level `runtime.avatar.*` daemon convenience surface for the same persistent truth
- SDK must not expose APML parser events as the durable app-facing product path;
  APML remains runtime model-facing input and SDK consumers observe only typed
  `runtime.agent.*` projections unless a later mounted runtime rule admits
  another surface
- SDK must not publish Avatar generated motion routes, backend capability
  profiles, mapping sidecars, or mapping confidence labels as runtime-owned
  payload truth. Those are Avatar-owned downstream projection facts consumed
  after typed `runtime.agent.*` delivery.
- SDK typed projection helpers must preserve the distinction between public
  APML wire syntax and typed runtime presentation events; no SDK helper may
  re-admit public `<motion>`, `<expression>`, `<lookat>`, `<pose>`, or
  `<clear-pose>` syntax by translating it client-side.
- SDK may combine typed `runtime.agent.presentation.voice_playback_requested`
  / `runtime.agent.presentation.voice_stream_chunk_available` /
  `runtime.agent.presentation.lipsync_frame_batch` events into a
  non-authoritative playback schedule for app/Kit consumers when all Runtime
  timeline authority fields, turn identity, stream identity, audio artifact
  identity, and drift bounds remain explicit and fail closed.
- SDK must not decide whether Desktop manual playback, Avatar autoplay, or
  text-only fallback applies. Those decisions are Runtime voice policy truth.
- SDK runtime packages must not import browser-only audio processing dependencies
  such as WebAudio worklets or `wlipsync`; Avatar/browser helpers may live in
  Kit Avatar entrypoints downstream of typed Runtime events.

## S-RUNTIME-104 Renderer-Local Transient Non-Owner Boundary

SDK runtime is not the semantic owner of renderer-local transient avatar
interaction state.

Fixed rules:

- runtime-owned current emotion may project through
  `runtime.agent.state.current_emotion` /
  `runtime.agent.state.emotion_changed`
- speaking/listening phase, viseme, amplitude, and renderer-local attention
  target remain app/surface-side inputs unless a later runtime contract admits
  them explicitly
- SDK may carry runtime-owned turn/presentation/emotion projections, but it
  must not elevate renderer-local values into runtime canonical read/write truth
- when first-party apps combine runtime-owned presentation profile with surface-local avatar interaction state, the ownership cut must remain explicit and fail-closed

## S-RUNTIME-106 Broad Event API Deferral Boundary

The closed 2026-04-20 SDK Event API design remains evidence only. The active SDK
runtime surface admits the current `runtime.agent.*` consume path, not a general
platform event API.

Active SDK boundary:

- `runtime.agent.turns.subscribe(...)` may merge admitted app-message turn /
  presentation events with RuntimeAgentService state/hook events
- `runtime.agent.turns.subscribe(...)` may filter by explicit `agentId` and
  optional `conversationAnchorId`
- emitted SDK event names and payloads must remain downstream of
  `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`
- SDK parsing must fail closed on invalid runtime activity category or
  intensity values

Not admitted on the stable SDK surface in the current authority set:

- `client.events.on(...)`, `once(...)`, `onBefore(...)`, `emit(...)`, or
  `clear(...)` as a broad app developer event bus
- wildcard subscription contracts for `desktop.*`, `avatar.*`, `system.*`,
  `apml.*`, or third-party namespaces
- cancellable before-event semantics
- SDK-owned app-event schema or rate-limit truth

Future admission of the broad Event API requires a new SDK/runtime authority
packet and must not be inferred from historical design evidence.

## S-RUNTIME-107 Local SDK Consumer Trust Posture

The SDK local runtime consumer posture is an active SDK/runtime boundary, not a
historical trust checklist.

Fixed rules:

- SDK consumers must provide explicit `agentId` for every localAgent-scoped runtime
  call; construction-time current-localAgent helpers are not canonical truth
- `conversationAnchorId` is the only admitted cross-surface continuity scope for
  a selected conversation; SDK must not synthesize app-local session ids or
  reuse same-localAgent traffic across anchors
- auth credentials, subject context, localAgent identity, and conversation anchor
  identity remain separate inputs; SDK must not infer one from another
- runtime reconnect/session recovery is consumer-owned per `S-RUNTIME-070`; SDK
  may expose recovery methods such as anchor snapshot/session snapshot reads,
  but it must not silently reconnect, reopen, or downgrade to fixture/mock data
- protected runtime agent turn read/write paths must request the admitted
  runtime scopes for that operation and must fail closed when runtime rejects the
  request
- SDK runtime consume projection remains downstream of active runtime authority
  and must not import runtime-private implementation packages or app-local
  avatar/Desktop surfaces

Trust-posture evidence must be current implementation or test evidence from the
SDK/runtime public surface. Closed 2026-04-20 trust posture artifacts may be
used only as historical evidence and cannot close this rule by themselves.

## S-RUNTIME-108 Presentation Timeline Consume Boundary

The SDK may expose PresentationTimeline metadata only as a downstream projection
of runtime-owned `runtime.agent.*` timeline-bearing events admitted by
`K-AGCORE-051`.

Fixed rules:

- SDK must preserve runtime-owned `agentId`, `conversationAnchorId`, `turnId`,
  `streamId`, timebase, offset, duration, deadline, and interrupt semantics
  without collapsing them into app-local session or renderer state
- SDK parsing must fail closed on malformed timing metadata, unknown timeline
  channel names, invalid negative offsets, or non-monotonic voice/lipsync frame
  sequences once the concrete runtime schema is admitted
- SDK must not publish this branch as `client.events.*`, wildcard subscription,
  cancellable before-event, or general app-event broker behavior
- SDK must not synthesize voice timing, lipsync frames, or mouth-open values;
  those values remain runtime/provider/avatar downstream data with explicit
  ownership
- SDK may provide ergonomic typed accessors over admitted timeline metadata, but
  those accessors must remain thin projections over runtime event payloads

Retired SDK Event API and PresentationTimeline designs are evidence only and
cannot close SDK timeline support without current tests.

## S-RUNTIME-109 Local First-Party Account Projection And Binding Consumer

> Authority: SDK kernel
>
> Upstream Runtime authority: `K-ACCSVC-*`（`account-session-contract.md`）、`K-BIND-*`（`scoped-app-binding-contract.md`）。

Local Runtime app mode 下，SDK 必须以 Runtime-owned account projection、
Runtime-mediated Realm broker、Runtime app session 与 scoped binding 作为唯一
权威来源。不得让 app 注入 token、refresh token、subject、session store、或
独立 Realm identity bootstrap。Runtime-backed short-lived access-token provider
只属于 registry/spec 显式 admitted 的 `first-party-local-app` exception；不是
Desktop、developer 或 installed third-party 的默认路径。

Default Nimi Avatar (`nimi.avatar`) is a local first-party Runtime-mode app.
It may use the same Runtime-backed short-lived access-token provider as other
admitted local first-party apps, and it must follow the same ban on app-owned
refresh/session/subject truth. It is not forced into binding-only mode merely
because Desktop launched it.

固定规则：

- SDK 必须暴露 typed Runtime account projection consumer：状态查询（映射 `GetAccountSessionStatus`）、事件订阅（映射 `SubscribeAccountSessionEvents`）。
- SDK 必须为 local app composition 暴露 Runtime-mediated Realm transport（映射
  `InvokeRealmUnary`）；`third-party-nimi-app` installed launch 必须映射为
  `ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP`，并消费 host-bound Runtime
  app-session proof。
- SDK 仅为显式 admitted `first-party-local-app` helper 暴露 Runtime-backed
  short-lived access-token provider。该 helper 与 mediated transport 分离，
  mode construction 后不可切换。
- SDK 必须暴露 developer-registered local app account caller helper；该 helper
  只能消费 Runtime account projection、Runtime app session、scoped binding 和
  developer-scoped broker，不得调用/包装 `BeginLogin`、`CompleteLogin`、
  `RefreshAccountSession`、`GetAccessToken`、`Logout` 或 `SwitchAccount`。
- SDK 必须暴露 typed scoped binding consumer：解析 binding 状态、订阅 binding 事件、关闭使用方时通知 Runtime。
- SDK 不得在 local first-party mode 接收 app-provided `auth.accessToken`、`auth.refreshToken`、`subjectContext`、`subject_user_id`、token provider、refresh callback、session store、或 JWT 解析 hook。
- SDK 在 local Runtime mode 暴露 Realm data client 时默认使用
  Runtime-mediated transport；只有 explicit first-party raw-token helper 可用
  Runtime-backed token projection。不得暴露 Realm identity bootstrap、
  `MeService.getMe` account truth、Realm direct login routes 或 SDK-owned 401
  refresh flow。
- SDK 必须在 account state 非 `authenticated` 时对依赖 account 的 capability fail-close（不得返回 anonymous / fixture / mock 投影）。
- SDK 必须在 binding state 非 `active` 时对 scoped 操作 fail-close。
- SDK `runtime.agent.turns` 必须暴露 explicit binding-only consume mode：
  `subscribe`、`request`、`interrupt`、`getSessionSnapshot` 必须接收 scoped
  binding attachment（`bindingId`、可选 opaque handle、以及 non-secret relation
  selectors），并将其投影到 `RuntimeAppService` / `RuntimeAgentService`
  request；该 mode 不得 resolve、要求、或发送 `subjectUserId` 作为 proof。
- SDK `runtime.agent.turns.getSessionSnapshot` 是 query surface，必须投影为
  `RuntimeAgentService.GetPublicChatSessionSnapshot` unary call；不得通过
  `RuntimeAppService.SendAppMessage` / `SubscribeAppMessages` 构造
  `runtime.agent.session.snapshot.request` request/reply。
- SDK must also allow default local first-party Avatar to use the normal
  first-party account / agent authorization path without scoped binding
  attachment.
- SDK binding-only mode 必须把 missing / stale / revoked / expired /
  suspended / superseded / replay / relation mismatch / scope mismatch 作为 typed
  binding unavailable / permission failure 投影给使用方，使用方据此关闭
  interaction / voice / activity 而不影响 visual carrier。
- SDK 必须使用稳定 mode discriminator（`first-party-local-app` vs
  `developer-registered-local-app` vs `third-party-nimi-app` vs
  `dev-standalone` vs `web-cloud-adapter` vs `external-principal`），且 mode 一旦
  确定不可在运行期跨切换。`third-party-nimi-app` 是 SDK app mode，不是新的
  Runtime enum。
- SDK 必须把 Runtime account / binding 事件以 typed 投影暴露，不得使 app 直接读取底层事件 envelope。
- SDK 必须保留对 Runtime account projection 缺失字段、未知 state、或断流（`replay_truncated`）的 fail-close 行为。

Web/cloud adapter 与 external-principal mode 仍可保留 app-provided token / subject provider 输入，但这些 mode 必须在公共 surface 上显式 fenced，且不得对 local first-party 消费可达。

SDK must expose `runtime.account.requestPresenceVerification(...)` only as a
typed thin projection of
`RuntimeAccountService.RequestPresenceVerification`. SDK must not implement the
second factor itself, accept passwords or secrets from the app, convert current
login/access-token state into verified presence, or call Realm server APIs as
the acceptance path. Only Runtime may orchestrate a Realm-backed fresh
`NIMI_REAUTH` fallback behind this method, and SDK/app consumers only receive
the Runtime response state/method/expiry. Non-verified, unavailable, cancelled,
or expired Runtime responses remain fail-closed.

## S-RUNTIME-110 Desktop-Owned Login Adapter Surface

local account login/logout/switch UX 仅由 Desktop account UX 拥有，并以
`ACCOUNT_CALLER_MODE_DESKTOP_SHELL` 调用 Runtime `BeginLogin` /
`CompleteLogin` / `Logout` / `SwitchAccount`。SDK 在 Desktop-owned composition
中仅扮演 typed projection；developer、installed third-party、binding-only
Avatar 与 ordinary first-party app facades 不得暴露这些 account-control helper：

- SDK 只在 Desktop account-UX facade 暴露 typed `beginLogin(...)`、
  `completeLogin(...)`、`logout(...)`、`switchAccount(...)` 包装并转发到
  Runtime；不得在 SDK 层完成 token exchange 或解码 JWT。
- public `RefreshAccountSession` 不属于 app-facing facade。SDK broker/token
  composition 不得调用它；refresh 由 Runtime private helper 完成。
- SDK 不得在 local first-party mode 暴露 Realm 直接登录路径；登录只允许通过 Runtime Nimi Auth Browser callback proof。
- SDK 必须把 Runtime 返回的 UX instruction envelope（不含 PKCE verifier）原样投影给 kit / Desktop。
- SDK 必须把 `CompleteLogin` proof envelope 视为不透明字节包，不得检查、解析或重写 token 字段。
- 登录失败 reason code 必须按 `K-ACCSVC-008` 投影；不得合并、改写、或以 anonymous fallback 替代。

## S-RUNTIME-111 Runtime Artifacts Bytes Retrieval

> Upstream Runtime authority: `K-AGCORE-053`（`runtime-artifact-contract.md`）。

SDK 必须暴露通用 artifact bytes 取回 surface，与 typed media projection 体系（`S-RUNTIME-073`）正交。avatar 等 first-party app 用此 surface 按 `audio_artifact_id`（来自 `voice_playback_requested.detail` / `voice_stream_chunk_available.detail`）取回 runtime-emitted audio artifact 的原始 bytes，用于本地 audio decode + wLipSync 等下游消费。`lipsync_frame_batch` 若继续存在，其 metadata artifact identity 不得与 playable audio artifact identity 混用。

固定规则：

- SDK 必须以 `Runtime` class `readonly artifacts: RuntimeArtifactsModule` 字段暴露 `runtime.artifacts.readBytes({ artifactId, expectedMimePrefix? }): Promise<{ bytes: ArrayBuffer; mimeType: string; sizeBytes: number; mimeInferred: boolean }>` 稳定 high-level convenience API。
- SDK 必须以 `Runtime['client']` / RPC binding 形态暴露底层 `runtimeClient.readArtifactBytes(request: ReadArtifactBytesRequest, options?: RuntimeCallOptions): Promise<ReadArtifactBytesResponse>`，绑定到 `RuntimeArtifactService.ReadArtifactBytes` proto method id。
- SDK Runtime class 的 `artifacts` module 必须暴露 Runtime-owned generated voice cleanup RPC binding：`cleanupGeneratedVoiceArtifacts({ agentId?, conversationAnchorId? })`，绑定到 `RuntimeArtifactService.CleanupGeneratedVoiceArtifacts`；SDK 不得在 app/Avatar 层实现文件删除逻辑。
- SDK 不得以 singleton const（如 `export const runtime = { artifacts }`）形式暴露 artifacts namespace；必须通过 Runtime class 实例化路径（`new Runtime(options)` 或 `createLocalFirstPartyRuntimePlatformClient(...)`）。
- `expectedMimePrefix` 用于 SDK fail-fast：runtime 返回 `mime_type` 不以 prefix 开头（case-insensitive）时，SDK throw `NimiError(reasonCode: ARTIFACT_MIME_MISMATCH)`，不暴露 bytes。
- SDK 必须在该 surface 上 enforce `fallback: 'deny'`（与 `runtime.media.*` 同 policy）；不允许调用方修改 fallback policy。
- SDK 必须把 `ARTIFACT_INVALID_INPUT` / `ARTIFACT_NOT_FOUND` / `ARTIFACT_TOO_LARGE` / `ARTIFACT_FORBIDDEN` / `ARTIFACT_MIME_MISMATCH`（`K-AGCORE-053`）作为稳定 reason code，必须 fail-close 透传到 caller；不得返回空 bytes / 默认 mime / 假装成功。
- SDK 对 voice playback/chunk audio artifact 的 `expectedMimePrefix` 应使用
  `audio/`；返回非 audio mime 必须 fail-close，不得把 lipsync metadata 或
  synthetic placeholder 交给 audio decoder。
- SDK runtime client 不得在 mime 缺失时填默认值；mime 必须由 runtime 端打 `mime_inferred: true`。
- 此 surface 不替代 `getScenarioArtifacts(jobId)`（job-typed projection；S-RUNTIME-073）或 `getVoiceAsset(GetVoiceAssetRequest)`（voice asset library）；用例正交，三者并存。
- `runtime.artifacts.readBytes` 入参 `expectedMimePrefix` 仅接受 RFC-6838 合法 top-level type（`audio/`、`image/`、`video/`、`text/`、`application/`、`model/` 等）；`music/` 不是合法 top-level type（music artifacts 实际为 `audio/*`），SDK 不得 advertise 它为合法 prefix。

drift check：

- SDK 不得在 `readBytes` 失败时返回空 bytes、默认 mime、或假装成功路径。
- SDK 不得为 `readBytes` 暴露 fallback / retry-on-decode-failure 旋钮（K-ERR-003 / S-RUNTIME-085 同 posture）。
- SDK readBytes mime prefix check 必须 case-insensitive；不得 exact-match。

## S-RUNTIME-123 Local Runtime Transfer State Projection

> Upstream Runtime authority: `K-LOCAL-024`（`local-catalog-recommendation-contract.md`）。

Runtime LocalService owns local transfer lifecycle state. SDK local-runtime
transfer parsers are typed projections over that state only.

Fixed rules:

- `state` is the canonical lifecycle field for local transfer progress events
  and session summaries.
- `done` and `success` are terminal flags derived from Runtime-owned `state`;
  SDK must not reverse-infer `completed`, `failed`, or `cancelled` from these
  booleans when `state` is absent or invalid.
- SDK must fail closed on missing or unknown transfer `state`.
- When Runtime provides `done` or `success`, SDK must verify those booleans are
  consistent with `state`; mismatches must fail closed instead of being
  projected as progress or completion.
- Desktop, Tester, Kit, and other apps may render SDK transfer projections but
  must not maintain a second transfer lifecycle state machine.

## S-RUNTIME-124 Runtime Agent Memory Observatory Projection Helper Boundary

> Upstream Runtime authority: `runtime-agent-canonical-memory-contract.md`
>
> Consumer product driver: Zhiyu H5 Memory Observatory local companion surface.

SDK Runtime Agent Memory Observatory helpers are typed read-only projections
over admitted RuntimeAgentService memory read envelopes. They may compose the
existing SDK canonical memory export helper, which itself reads
`RuntimeAgentService.GetAgentState` and `RuntimeAgentService.QueryAgentMemory`,
but they do not own memory truth, memory lifecycle truth, or app-local memory
identity.

Fixed rules:

- SDK Memory Observatory helpers must project canonical agent memory as
  `canonical-agent-memory` authority class and preserve Runtime-owned agent id,
  memory id, bank key, canonical class, memory kind, summary, provenance,
  timestamps, replication outcome, policy reason, and recall score from the
  RuntimeAgentService read envelope.
- SDK Memory Observatory helpers may expose product-readable state such as
  `ready` or `empty`, record counts, bank counts, lineage, and semantic
  confidence only when those values are directly available from the admitted
  memory export envelope.
- SDK Memory Observatory helpers must represent lifecycle fields not present on
  the admitted read envelope as explicit `not_projected` states. This includes
  review state, redaction state, and forget/retire intent.
- SDK Memory Observatory helpers must not infer review, redaction, forget
  intent, consent/grant state, provider/model facts, or app-local memory
  identity from metadata, summaries, timestamps, confidence, UI state, or cache.
- SDK Memory Observatory helpers must not call memory write/mutation paths,
  `runtime.memory.*` as a canonical agent memory shortcut, provider APIs,
  app-level REST, Desktop implementation modules, or Runtime private packages.

## S-RUNTIME-125 Runtime Agent Canonical Review Status Projection

> Upstream Runtime authority: `K-AGCORE-016a`（`runtime-agent-canonical-memory-contract.md`）
>
> Consumer product driver: Zhiyu Memory Observatory lifecycle transparency.

SDK may expose a typed read-only projection over
`RuntimeAgentService.GetAgentCanonicalMemoryReviewStatus` for canonical
agent-facing memory banks.

Fixed rules:

- SDK review status helpers must preserve Runtime-owned bank identity,
  readiness, executor availability, last review follow-up id, checkpoint basis,
  completion time, next eligibility time, and recoverable review-run id as read
  projection values.
- SDK must not infer review readiness, redaction, forget, retire, or per-record
  lifecycle state from memory records, metadata, summaries, confidence,
  timestamps, UI state, app cache, or provider/model outputs.
- SDK must not expose review execution, redaction, forget, or retire mutation
  through this projection helper.
- When Runtime does not project review status, SDK/app consumers must keep
  lifecycle fields explicit as unavailable or `not_projected`; they must not
  backfill product copy with synthetic lifecycle values.
