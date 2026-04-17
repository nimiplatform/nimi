# LLM Adapter Contract

> Authority: Desktop Kernel

## Scope

Desktop LLM 适配器契约。定义 provider 适配、路由策略、Connector 凭据路由、以及 runtime-aligned text/media/voice 集成边界。

## D-LLM-001 — Provider 适配层

LLM 请求通过 provider 适配层路由，对齐 K-KEYSRC-001 两路径模型：

- **managed 路径**（`connector_id` 存在）：通过 ConnectorService 解析 provider / endpoint / credential（K-KEYSRC-009）。`connector_id` 由用户在 Runtime Config UI 选择 connector 后写入运行时字段。
- **inline 路径**（Phase 2，K-KEYSRC-001 inline metadata）：Desktop Phase 1 不使用 inline 路径。
- `provider` 字段仍用于 UI 展示和路由选择，但执行层凭据注入由 `connector_id` 驱动。Runtime K-PROV-005 定义 provider 归一化映射（provider 名称到 ProviderType 枚举的规范化），Desktop 应使用归一化后的 provider 名称发送请求，确保 Runtime 侧正确路由。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定；endpoint 允许为空，空值表示当前 route 未配置本地 endpoint。
- `localOpenAiEndpoint`：OpenAI 兼容端点；允许为空，空值表示 runtime 未提供 OpenAI-compatible local binding。

cloud connector 路径必须保持 runtime-only：Desktop 不得恢复 legacy provider adapter factory 或直接 provider `listModels` / `healthCheck` 调用来旁路 Runtime。

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

**跨层引用**：K-KEYSRC-001、K-KEYSRC-009、K-PROV-005。

## D-LLM-002 — 路由策略

执行内核 turn 路由：

- Desktop core product 不拥有 Agent chat route API，也不得在 DataSync / launcher / fallback policy 中内建 Agent 聊天路由。
- mods 如需 Agent 聊天路由，必须通过 desktop host 的 data capability `data-api.core.agent.chat.route.resolve` 查询目标 agent 和 provider。
- `data-api.core.agent.chat.route.resolve` 必须 fail-close：缺少 `agentId`、控制面请求失败、或返回 payload 非法时直接报错；Desktop host 不得合成本地 `LOCAL/AGENT_LOCAL` 成功路由。
- `AgentEffectiveCapabilityResolution` 的唯一 authority home 是 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）定义的 shared builder；setup / submit / runtime 不得各自重算一份 agent route truth。
- `ExecuteLocalTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

## D-LLM-003 — Connector 凭据路由

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 body 传递 `connectorId`（S-TRANSPORT-002）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、K-CONN-001（.nimi/spec/runtime/connector.md）。

## D-LLM-004 — 本地 LLM 健康检查

`checkLocalLlmHealth` 验证本地引擎可用性：

- 对 local `text.generate` / `text.embed`，必须先解析到 `RuntimeLocalService` authoritative local model record；health/status/readiness 以 runtime local model list/status 为真源。
- host-local snapshot、推荐 feed、或 route config 中残留的 `localProviderModel` 只可补充展示元数据，不得单独构成 healthy/sendable 结论。
- local text 路径中，`goRuntimeStatus in {active, installed}` 可视为可执行或可 warm-on-demand；`degraded / unavailable / unhealthy / removed / missing` 必须 fail-close 为 unreachable。
- local `llama` text 健康检查不得仅靠 `GET /v1/models` 2xx 判定 healthy。
- media / speech 路径继续遵循各自的 canonical endpoint 探测协议。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。对 local text，它消费 runtime authoritative local model state，而不是复制一套 host-side probe truth；对 media/speech，它仍遵循 `K-LENG-007` 的 engine-specific 协议进行 endpoint 探测。缺 endpoint 或缺 runtime authoritative local record 时必须直接视为未配置/不可达，不得伪造 loopback fallback。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

## D-LLM-005 — 语音引擎集成

Desktop 侧 speech engine 只暴露 runtime-aligned 语音能力：

- `setSpeechFetchImpl(proxyFetch)`：设置语音请求的 fetch 实现。
- `setSpeechRouteResolver(resolver)`：设置语音路由解析器。
- 路由解析：从 capability-scoped route binding 读取 connector/model/endpoint 配置，不再暴露 provider list。
- legacy speech provider-list surface 已下线，不提供替代接口。

公开 surface 固定为：
- `runtime.media.tts.list.voices`
- `runtime.media.tts.synthesize`
- `runtime.media.tts.stream`
- `runtime.media.stt.transcribe`

选路规则固定为：
- `audio.synthesize`：先走 `runtime.route.listOptions({ capability: 'audio.synthesize' })` 选 binding，再调用 `runtime.media.tts.listVoices/synthesize/stream`
- `voice_workflow.tts_v2v|voice_workflow.tts_t2v`：必须对对应 capability 独立执行 `runtime.route.listOptions -> resolve -> checkHealth -> describe`，再提交 runtime media job；不得复用 `audio.synthesize` 的 route truth
- 缺有效 binding 或缺 route-resolved model 时必须 fail-close，不得返回空 voice 列表作为静默 fallback
- AI Chat、Agent Chat、Runtime Config 对 text/audio/voice workflow 的 capability projection 必须共用 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）规定的 shared builder，不得在本地 heuristic 中重建 route metadata truth
- 本契约只拥有 runtime-aligned voice route/API truth；agent chat richer workflow 是否被
  admit、属于 `tts_v2v` 还是 `tts_t2v`、使用什么 voice identity、以及 workflow result
  如何回到当前 thread，固定由 `agent-chat-voice-workflow-contract.md`
  （`D-LLM-047` ~ `D-LLM-052`）拥有
- 本契约只拥有 runtime-aligned TTS route/API truth；agent chat resolved `voice`
  action consumption、`audio.synthesize` 首包 executor semantics、以及 playback-ready
  speech artifact outcome 固定由
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）拥有
- 本契约同样不拥有 broader voice session product semantics；explicit entry / exit、
  same-thread continuity、admitted listening modes、interruption、以及
  transcript / caption rules 固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有

## D-LLM-006 — 本地 AI 推理审计

`LocalRuntimeInferenceAuditPayload` 记录推理事件：

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_cloud`（映射到 Runtime 审计字段 `operation`）
- `source`：`local` / `cloud`（映射到 Runtime 审计载荷 `payload.source`）
- `modality`：`chat` / `image` / `video` / `tts` / `stt` / `embedding`
- `adapter`：`openai_compat_adapter` / `llama_native_adapter` / `media_native_adapter` / `media_diffusers_adapter` / `sidecar_music_adapter`
- `policyGate`：策略门控信息

**审计角色定位**：Desktop `LocalRuntimeInferenceAuditPayload` 是**展示层补充审计记录**，用于 UI 侧的推理事件追踪和本地调试。它不替代 Runtime 层的持久化审计：

- **Runtime K-AUDIT-001**（全局审计最小字段）和 **K-LOCAL-016**（本地审计）由 daemon 层写入，包含完整的 `request_id`、`trace_id`、`user_id`、`usage` 等运行时上下文字段。
- **Desktop D-LLM-006** 侧重于记录 renderer 可观测的推理决策信息（eventType、source、adapter、policyGate），不具备 runtime 上下文字段。
- 两者通过 `D-IPC-011` 的 `runtime_local_append_inference_audit` 命令桥接：Desktop 将审计载荷提交到 Tauri backend，最终存入 Runtime 审计存储。

## D-LLM-007 — 分层调试责任与门禁顺序

Desktop/mod 调试必须遵循固定分层门禁顺序：

- Runtime gate（K-GATE-040/K-GATE-060/K-GATE-070）未通过时，SDK 与 Desktop/mod 不得以 workaround 继续推进。
- SDK gate（S-GATE-020/S-GATE-080/S-GATE-090）未通过时，Desktop/mod 只能修复 SDK 对接问题，不得在 Desktop 侧 hardcode 补洞。
- Desktop/mod 仅在 Runtime+SDK 双绿灯后进入 E2E 排障。

禁止路径：

- 以 legacy 接口或 hardcode provider/model/route 规避上游未收敛问题。
- 在 Desktop 侧复制 Runtime/SDK 的路由或能力判定逻辑。

跨层引用：K-GATE-040、K-GATE-060、K-GATE-070、S-GATE-080、S-GATE-090、D-MOD-002。

## D-LLM-008 — Trace 连续性

LLM 适配器必须在跨模态链路保持统一 trace：

- 对外返回统一 `traceId`（text/image/video/stt/embedding/speech）；`promptTraceId` 仅作为文本兼容字段并与 `traceId` 语义对齐。
- Runtime 未返回 trace 时，Desktop 执行层必须生成可追踪 fallback trace，避免断链。
- 推理审计载荷必须包含 `traceId + modality + routeSource + reasonCode`，确保 Runtime↔SDK↔Desktop↔Mod 可检索。

跨层引用：K-AUDIT-001、S-ERROR-005、D-IPC-011、D-ERR-007。

## D-LLM-009 — Mod 行为门禁归属

Desktop 不得把任何特定 mod 设为内建发布门禁：

- Desktop 仓只保留 runtime mod smoke、安装生命周期和桥接一致性检查。
- 任意独立 mod 的 deterministic/live E2E 必须留在该 mod 自己的仓中维护。
- Desktop mod smoke 只验证 host/runtime contract，不替代 mod 仓的行为级 E2E。

跨层引用：K-GATE-060、S-GATE-080、S-GATE-090、D-MOD-007。

## D-LLM-010 — 设备画像匹配与引擎支持

推荐算法通过 `classify_host_support()` 判定每个引擎的设备兼容性。

- **Media 引擎**: 仅限 Windows x64 + NVIDIA GPU
- **Llama 引擎**: 支持 Darwin (Apple Silicon) 和 Linux
- **Speech 引擎**: 全平台通用
- **统一内存 (macOS/Metal)**: 当 VRAM 未知时，回退到 `available_ram_bytes`
- **独立 GPU (NVIDIA/AMD)**: 严格 VRAM 预算，无 CPU 回退路径

引擎支持矩阵变更必须同步更新此规则。

## D-LLM-011 — 推荐内存预算与层级分配

LLMfit 推荐路径计算内存预算并分配推荐层级。

- **内存预算**: `main_size_bytes + 0.5 GB` (最低), `× 1.2` (推荐)
- **量化推断**: 解析优先级 `entry > title > model_id > repo > tags`，识别已知 GGUF/SafeTensors 标记
- **参数提取**: 文本解析 (B/M 后缀) 优先于基于文件大小的 BPP 计算
- **信心分级**: High = size+quant+params 全已知; Medium = 仅 size 已知; Low = 无已知信息
- **上下文长度**: 从 tags 提取，未找到时回退到 4096
- **视觉检测**: 在 model_id/repo/title/tags 中匹配 `vision`, `-vl-`, `llava`, `pixtral`, `multimodal`, `onevision`
- **层级映射**: Perfect→Recommended, Good→Runnable, Marginal→Tight, TooTight→NotRecommended

仅 chat 能力模型进入 LLMfit 路径；image/video 在推荐入口处即拒绝。

## D-LLM-012 — 依赖解析阶段排序

依赖解析器按三阶段执行: Required → Optional → Alternatives。

- **Required 阶段**: 必须满足，失败则整体解析失败
- **Optional 阶段**: 不满足则跳过，不影响整体结果
- **Alternatives 阶段**: 选择最优匹配项，无匹配则标记未选中（无降级）
- **选择优先级**: 显式偏好 > 能力域偏好 > 全局 preferred IDs > 首个匹配
- **终止保证**: 单次遍历 O(N)，每个 option 仅评估一次（fit 结果缓存）
- **能力过滤**: `capability` 字段缺失视为匹配；存在时必须大小写不敏感匹配 filter

## D-LLM-013 — 模型注册表身份解析

模型注册表通过两级查找确定模型身份。

- **查找顺序**: (1) `local_model_id` 大小写不敏感匹配, (2) `(model_id_normalized, engine)` 元组匹配, (3) 新增记录
- **Upsert 语义**: 匹配到已有记录时更新而非插入，防止重复
- **能力索引**: 跳过 `status=Removed` 的模型；每次 upsert 后重建；按 capability 去重
- **文件元数据完整性**: `files` 列表存在与否决定推荐信心分级；回退条目从 `files \ entry` 推断

## D-LLM-014 — 下载原子性与暂存

HuggingFace 下载流程遵循 Staging → Verify → Commit 原子模式。

- **暂存目录**: `.resolved-staging/<slug>/`，所有文件下载到此处
- **原子提交**: 暂存目录验证成功后原子重命名为 `.resolved/`
- **备份机制**: 提交前备份已有模型目录；提交失败时回滚
- **哈希验证**: 每文件 SHA256 流式校验；不匹配触发暂存目录回滚（磁盘无残留部分模型）
- **Manifest 验证**: 写入后解析 + schema 校验；失败回滚暂存；仅验证通过后注册到 state.json
- **下载恢复**: HTTP Range header 支持断点续传；按文件级别跟踪进度
- **进度 ETA**: 指数移动平均 (α=0.2, 1-3s 窗口)；检测到进度回退时重置 EMA 状态

## D-LLM-065 — World Generate Runtime-Only Boundary

Desktop 消费 `world.generate` 时必须保持 runtime-only 路径：

- route resolve、submit、poll、fetch-world 均必须通过 runtime surface 完成。
- `connector_id` 继续是唯一合法的远端凭据路由句柄。
- Desktop 不得直接调用 World Labs upload / generate / operations / get-world
  HTTP endpoints。
- provider viewer URL 若被展示，只能作为外部 handoff；它不构成 Desktop 拥有
  provider execution truth。

## Fact Sources

- `tables/hook-capability-allowlists.yaml` — runtime facade capability 白名单
- `tables/error-codes.yaml` — LLM 相关错误码
- `tables/rule-evidence.yaml` — LLM 分层门禁与证据映射
