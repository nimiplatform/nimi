# Runtime SSOT 系统审计与全链路收敛实施计划（2026-02-27）

- 日期：2026-02-27
- 类型：implementation plan（一次性收敛，不引入兼容壳）
- 范围：`ssot/runtime` + `proto/runtime/v1` + `runtime` + `sdk` + `apps/desktop` + `docs/examples/providers`
- 目标：以 SSOT 为准绳，完成凭证平面、connector 绑定、runtime AI consume 链路的工业级一致性收敛。

## 1. 审计基线与方法

审计基线（规范真相）

1. `ssot/runtime/service-contract.md`
2. `ssot/runtime/config-contract.md`
3. `ssot/runtime/proto-contract.md`
4. `ssot/runtime/local-runtime.md`
5. `ssot/runtime/multimodal-provider-contract.md`
6. `ssot/runtime/multimodal-delivery-gates.md`

审计覆盖（实现与验证面）

1. runtime 协议与 AI 服务：`runtime/internal/protocol/envelope/*`、`runtime/internal/grpcserver/*`、`runtime/internal/services/ai/*`
2. runtime config/CLI/entrypoint：`runtime/internal/config/*`、`runtime/cmd/nimi/*`、`runtime/internal/entrypoint/*`
3. sdk runtime/mod：`sdk/src/runtime/*`、`sdk/src/mod/types/*`、`sdk/test/runtime/*`
4. desktop route/hook/speech/bootstrap/runtime-config/tauri-bridge：`apps/desktop/src/runtime/*`、`apps/desktop/src/shell/renderer/features/runtime-config/*`、`apps/desktop/src/shell/renderer/infra/bootstrap/*`、`apps/desktop/src-tauri/src/runtime_bridge/*`
5. examples：`docs/examples/providers/*`

## 2. 审计结论（摘要）

结论：当前存在“SSOT 内部冲突 + 跨组件实现漂移 + 测试门禁缺失”三类问题，尚未形成可发布的一致闭环。

高优先级问题（阻断级）

1. SSOT 与 proto 的 AI RPC 口径不一致（`service-contract` 仍列 `GenerateImage/GenerateVideo/SynthesizeSpeech/TranscribeAudio`，proto 已切为 `SubmitMediaJob/GetMediaJob/...`）。
2. SSOT 要求的 `AI_REQUEST_CREDENTIAL_*` reasonCode 未进入 `proto/runtime/v1/common.proto`，实现无法对齐。
3. SSOT 定义 `credentialSource=request-injected|runtime-config`，runtime 实现未解析/校验该字段，也没有请求期凭证执行链。
4. desktop 与 sdk/mod 类型面仍在传递 `localOpenAiApiKey` 明文字段，且 speech 主链可绕过 runtime 直接调用 provider。
5. runtime-compliance 未覆盖凭证来源与请求期凭证 fail-close 门禁。

## 2.1 外部复核处置（Claude B-1~B-8）

| ID | 处置结论 | 文档调整 |
|---|---|---|
| B-1（tauri-ipc 漏项） | 采纳 | WP4 涉及文件补充 `sdk/src/runtime/transports/tauri-ipc/index.ts`，并在实现审计中新增 tauri-ipc metadata 约束项 |
| B-2（Rust bridge 漏项） | 采纳 | 审计覆盖补充 `apps/desktop/src-tauri/src/runtime_bridge/*`；WP5 涉及文件与风险章节补充 Rust bridge 元数据链路，并要求记录 `generated/method_ids.rs` 是否需要改动及原因 |
| B-3（config 范围无落地） | 采纳 | WP3 显式纳入 `runtime/internal/config/config.go` 与 `config_test.go`，给出“请求期凭证不落盘”约束落点 |
| B-4（WP5/WP7 测试耦合） | 采纳 | 执行顺序改为“WP5 与 desktop 对应测试原子执行”，并在 WP5/WP7 交付中加入同步测试更新要求 |
| B-5（WP6 未说明 `_common.ts`） | 采纳 | WP6 涉及文件补充 `docs/examples/providers/_common.ts`，并明确“入口示例不依赖该包装层” |
| B-6（speech 收敛机制不清） | 采纳 | 在收敛目标新增 speech 调用链机制，明确走 `SubmitMediaJob/GetMediaJob/GetMediaArtifacts` 主链 |
| B-7（验收命令绝对路径） | 采纳 | Section 8 改为“仓库根目录执行”，去除机器相关绝对路径 |
| B-8（SSOT-006 行号精度） | 采纳 | SSOT-006 证据改为精确行号：`service-contract.md:11`、`workflow-dag.md:16` |

## 2.2 第二轮复核处置（Claude B2-1~B2-7）

| ID | 处置结论 | 文档调整 |
|---|---|---|
| B2-1（`provider_resolver.go` 注入点不明确） | 采纳 | WP2 增补 `provider_resolver.go`，并冻结“validation 前置 + resolver 二次防线”的执行注入点 |
| B2-2（`provider_local.go` 未纳入） | 采纳 | WP2 增补 `provider_local.go` 与 local-route 不变量（local 仅接受 `runtime-config`） |
| B2-3（desktop TTS 入口不明确） | 采纳 | WP5 交付明确 TTS 收敛实现路径：`speech-service.ts/synthesize.ts` 改走 `runtime.media.tts.synthesize()`，不新增 `invoke-tts.ts` |
| B2-4（与 desktop 计划重叠） | 采纳 | Section 7 新增跨计划执行关系：本计划 WP5 为跨组件主计划，desktop 计划作为 WP5 细化清单并行归档 |
| B2-5（Rust bridge secret 泄漏审计缺失） | 采纳 | WP5/WP7 与风险章节新增 Rust bridge 错误与日志脱敏审计项（覆盖 `error_map.rs`） |
| B2-6（example smoke 缺少前提） | 采纳 | Section 8 将 example smoke 标记为手动验收并补充 runtime/凭证前置条件 |
| B2-7（WP1 baseline 更新遗漏） | 采纳 | WP1 交付与 Section 8 proto gates 补充 baseline 快照更新步骤 |

## 2.3 第三轮复核处置（Claude B3-1~B3-5）

| ID | 处置结论 | 文档调整 |
|---|---|---|
| B3-1（WP2 注入策略精度） | 采纳 | 在 5.6/WP2 冻结 Go 实现策略为 `context` 传播（provider 接口签名不变），并将 `artifact_methods.go/media_job_methods.go` 纳入调用站点核验范围 |
| B3-2（5.5 层次表述） | 采纳 | 5.5 第 1-2 条改为“hook 走 SDK 高层 API，由 SDK 内部映射 SubmitMediaJob” |
| B3-3（`Debug` derive 泄漏向量） | 采纳 | WP5/WP7 补充 `RuntimeBridgeMetadata` Debug 脱敏约束（移除默认 derive 或自定义 redacted Debug），并加入测试门禁 |
| B3-4（baseline 更新副作用） | 采纳 | Section 8 `buf build -o` 前补充“一次性执行”注释，后续常规验收默认跳过 |
| B3-5（WP4“同一套”语义） | 采纳 | WP4 改为“语义等价约束”，并在 WP7 增加 node-grpc/tauri-ipc metadata 输出一致性测试要求 |

## 2.4 第四轮复核处置（Claude B4-1）

| ID | 处置结论 | 文档调整 |
|---|---|---|
| B4-1（`localOpenAiApiKey` 影响面低估） | 采纳 | WP4/WP5 文件清单扩展为 `sdk/src/mod` + `apps/desktop/src` 全量 31 文件分层清单（主改 + 级联），并在 WP7/Section 8 增加源码扫描门禁 |

## 3. SSOT 内部一致性审计（文档层）

| ID | 问题 | 证据 | 影响 | 处理动作 |
|---|---|---|---|---|
| SSOT-001 | AI RPC 列表与 proto 不一致 | `ssot/runtime/service-contract.md:286-295` vs `proto/runtime/v1/ai.proto:370-379` | 规范无法唯一指导实现与测试 | 以 proto 为真相，更新 service-contract 的 AI RPC 表述与语义章节 |
| SSOT-002 | 声明了 `AI_REQUEST_CREDENTIAL_*` 但 proto 未定义 | `ssot/runtime/service-contract.md:448-451,483-487` vs `proto/runtime/v1/common.proto:38-48` | 错误码无法落地，测试与审计无法对齐 | 在 `common.proto` 新增 4 个 reasonCode，并更新生成代码 |
| SSOT-003 | `credentialSource` 要求存在，但元数据字段名未冻结 | `ssot/runtime/service-contract.md:263,474-481` | SDK/runtime/desktop 各自猜测字段名，导致漂移 | 在 service-contract 冻结 transport profile 凭证字段名与语义 |
| SSOT-004 | Local Runtime/provider 文档出现 Rust 文件级实现清单，与 runtime Go 事实冲突 | `ssot/runtime/providers/localai.md:127-131`、`ssot/runtime/providers/nexa.md:262-265`；`runtime/AGENTS.md` 明确 runtime 为 Go | 文档指向错误实现面，执行计划会偏航 | 删除/改写 Rust 实现清单，改为真实 Go+desktop 边界 |
| SSOT-005 | 失效引用路径 | `ssot/runtime/local-runtime.md:310-311` 引用 `docs/L0-protocols/*`、`docs/L1-foundation/*`（当前仓不存在） | traceability 断链 | 修正为仓内有效路径（`ssot/*` 或 `docs/runtime/*`） |
| SSOT-006 | frontmatter 重复分隔符 | `ssot/runtime/service-contract.md:11`（line 10 已闭合 frontmatter 后再次出现 `---`）、`ssot/runtime/workflow-dag.md:16`（重复 `---`） | SSOT lint 稳定性风险 | 统一 frontmatter 格式，移除多余 `---` |

## 4. 实现对齐审计（代码层）

### 4.1 Runtime

1. 未解析 `credentialSource` 与请求期凭证：`runtime/internal/protocol/envelope/envelope.go:19-49`。
2. 协议拦截器未校验 token-api 凭证来源语义：`runtime/internal/grpcserver/interceptor_protocol.go:19-63`。
3. AI 请求校验未覆盖请求期凭证 fail-close：`runtime/internal/services/ai/validation_helpers.go:14-122`。
4. provider 凭证仅从环境变量加载：`runtime/internal/services/ai/provider.go:45-79,150-168`。
5. cloud 调用路径无请求级凭证注入：`runtime/internal/services/ai/provider_cloud.go:53-139`。
6. 审计拦截器未记录凭证来源/凭证引用指纹：`runtime/internal/grpcserver/interceptor_audit.go:51-78`。
7. runtime-compliance 未覆盖凭证来源门禁：`runtime/cmd/runtime-compliance/main.go:362-439`。
8. CLI/entrypoint metadata 结构无凭证来源扩展：`runtime/internal/entrypoint/runtime.go:139-152`、`runtime/internal/entrypoint/stream_metadata_helpers.go:71-134`。
9. 路由分发层未表达凭证来源与 route 组合合法性（仅按模型前缀分流）：`runtime/internal/services/ai/provider_resolver.go:10-23`。

### 4.2 SDK

1. `RuntimeMetadata` 无 first-class 凭证来源字段，仅 `extra` 泛化透传：`sdk/src/runtime/types.ts:149-161`。
2. metadata merge 未建立凭证语义：`sdk/src/runtime/core/metadata.ts:13-32`。
3. node-grpc 可透传任意 `x-nimi-*`，但无 typed guard：`sdk/src/runtime/transports/node-grpc/index.ts:113-120`。
4. runtime client 仅校验 route/fallback，未校验 token-api 凭证来源：`sdk/src/runtime/core/client.ts:89-109`。
5. runtime client tests 未覆盖凭证来源与请求凭证：`sdk/test/runtime/runtime-client.test.ts:161-349`。
6. tauri-ipc transport 仅透传 metadata，未建立 `x-nimi-credential-*` 字段约束：`sdk/src/runtime/transports/tauri-ipc/index.ts:233-243,343-349`。

### 4.3 Desktop

1. route resolver 仍解析并返回 `localOpenAiApiKey`：`apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts:31-34,248-249,321-324`。
2. token-api 路由不要求 token 存在（fail-open）：`apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts:274-324`；测试明确允许空 token：`apps/desktop/test/runtime-route-resolver-v11.test.ts:19-40`。
3. bootstrap route binding 把 `localOpenAiApiKey` 下发到 mod/hook：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts:51,66`。
4. data capability 路由探测仍消费 connector `tokenApiKey`：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/runtime-route-capabilities.ts:241-243`。
5. 连接器模型探测直接用 `Authorization: Bearer <token>`，token 进入缓存键推导：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils.ts:122-134,296-340`。
6. chat runtime 调用未传 `credentialSource`/请求期凭证：`apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts:35-53`。
7. speech 主链直接调用 speechEngine 并传 apiKey，绕过 runtime consume：`apps/desktop/src/runtime/hook/services/speech/synthesize.ts:137-142`、`apps/desktop/src/runtime/hook/services/speech-service.ts:177-181`。
8. renderer defaults/store 仍持有 `localOpenAiApiKey`：`apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-defaults.ts:48,65`、`apps/desktop/src/shell/renderer/app-shell/providers/store-types.ts:26-40,112-123`。
9. tauri Rust bridge 在主调用链中透传 metadata，但尚未显式绑定凭证来源字段合同：`apps/desktop/src-tauri/src/runtime_bridge/metadata.rs:14-25,156-179`、`apps/desktop/src-tauri/src/runtime_bridge/unary.rs:53-57`、`apps/desktop/src-tauri/src/runtime_bridge/stream.rs:145-149`。

### 4.4 SDK Mod 类型面

1. route binding 对 mod 暴露明文 key 字段：`sdk/src/mod/types/llm.ts:58-60,72-74`。
2. runtime-hook LLM API 大量输入含 `localOpenAiApiKey`：`sdk/src/mod/types/runtime-hook/llm.ts:31-37,49-54,63-67,76-81,88-93`。

### 4.5 Examples

1. 文档与脚本仍引导“runtime 进程环境变量注入 API key”主路径：`docs/examples/providers/README.md:8-18`。
2. `deepseek-chat.ts`/`bytedance-tts.ts` 通过 `_common` 包装运行，不是单文件直观 SDK 用法：`docs/examples/providers/deepseek-chat.ts:21-27`、`docs/examples/providers/bytedance-tts.ts:22-28`、`docs/examples/providers/_common.ts:58-104`。

## 5. 收敛目标（最终态定义）

### 5.1 凭证平面

1. `daemon-config plane`：仅用于 runtime/cli/headless，来源 `apiKeyEnv`。
2. `request-credential plane`：仅用于 desktop/mod token-api，凭证在请求期注入，下一请求即时生效。

### 5.2 Connector 边界

1. `connectorId` 仅存在于 host（desktop）语义层。
2. runtime 不接收、不解析 `connectorId`。
3. runtime 仅消费“已注入凭证 + endpoint + credentialSource”。

### 5.3 传输合同（冻结）

在 transport profile metadata 冻结以下字段：

1. `x-nimi-credential-source`：`request-injected|runtime-config`
2. `x-nimi-provider-endpoint`：可选
3. `x-nimi-provider-api-key`：仅 `request-injected` 场景必填

约束：审计与日志禁止落明文 key，仅允许不可逆指纹。

### 5.4 调用路径

1. Chat 与 Embedding 分别走 `RuntimeAiService.Generate/Embed`。
2. Image/Video/TTS/STT 统一走 `RuntimeAiService.SubmitMediaJob`，并通过 `GetMediaJob/SubscribeMediaJobEvents/GetMediaArtifacts` 完成结果获取。
3. speech 不再主路径直连 provider，`speechEngine` 不再承担 cloud provider 直连职责。
4. mod 与 renderer 不持有明文 provider key。

### 5.5 Speech 收敛机制（明确）

1. TTS：desktop hook 侧调用 `runtime.media.tts.synthesize(input)`，由 SDK 内部映射为 `SubmitMediaJob{ modal=MODAL_TTS }` 并提交 runtime。
2. STT：desktop hook 侧调用 `runtime.media.stt.transcribe(input)`，由 SDK 内部映射为 `SubmitMediaJob{ modal=MODAL_STT }` 并提交 runtime。
3. 结果回传统一通过 media job artifact（音频字节、文本转写、provider 元数据）而非 desktop 直连 provider SDK。
4. desktop 入口固定为 `speech-service.ts -> synthesize.ts -> runtime-ai-bridge -> runtime.media.tts.synthesize()`，不新增 `invoke-tts.ts` 平行执行链。
5. 本轮不新增 speech 专用 RPC；若发现 proto 缺口，先在 SSOT/proto 明确后再改实现，不在 desktop 私有链路旁路补洞。

### 5.6 凭证校验注入点（冻结）

1. 第一防线：请求入口（envelope/interceptor/validation）校验 `credentialSource` 必填与 `routePolicy × credentialSource` 合法组合。
2. 第二防线：`provider_resolver` 在路由分发前再次拒绝非法组合，防止绕过前置校验进入 provider 层。
3. local-route 硬约束：仅允许 `runtime-config`；`request-injected` 与 local 路由组合必须 fail-close。
4. Go 实现策略冻结为 `context` 凭证传播（interceptor/envelope 注入 -> provider 读取），本轮不修改 provider 接口签名。

## 6. 一次性实施工作包（No-MVP）

### WP0：SSOT 冻结修复

涉及文件

1. `ssot/runtime/service-contract.md`
2. `ssot/runtime/config-contract.md`
3. `ssot/runtime/proto-contract.md`
4. `ssot/runtime/local-runtime.md`
5. `ssot/runtime/providers/localai.md`
6. `ssot/runtime/providers/nexa.md`
7. `ssot/runtime/workflow-dag.md`

交付

1. 修复 RPC/ReasonCode/引用路径/frontmatter 一致性。
2. 冻结凭证 metadata 字段名。

### WP1：Proto 与 ReasonCode 收敛

涉及文件

1. `proto/runtime/v1/common.proto`
2. `runtime/gen/runtime/v1/*`
3. `sdk/src/runtime/generated/runtime/v1/*`

交付

1. 新增 `AI_REQUEST_CREDENTIAL_REQUIRED`、`AI_REQUEST_CREDENTIAL_MISSING`、`AI_REQUEST_CREDENTIAL_INVALID`、`AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN`。
2. 生成代码零漂移。
3. 更新 `runtime/proto/runtime-v1.baseline.binpb` 快照，保证后续 `buf breaking` 基线一致。

### WP2：Runtime 凭证来源与请求期凭证执行链

涉及文件

1. `runtime/internal/protocol/envelope/envelope.go`
2. `runtime/internal/grpcserver/interceptor_protocol.go`
3. `runtime/internal/services/ai/validation_helpers.go`
4. `runtime/internal/services/ai/service.go`
5. `runtime/internal/services/ai/provider.go`
6. `runtime/internal/services/ai/provider_cloud.go`
7. `runtime/internal/services/ai/provider_resolver.go`
8. `runtime/internal/services/ai/provider_local.go`
9. `runtime/internal/grpcserver/interceptor_audit.go`
10. `runtime/internal/services/ai/artifact_methods.go`
11. `runtime/internal/services/ai/media_job_methods.go`

交付

1. token-api 强制校验 `credentialSource`。
2. `request-injected` 缺失请求期凭证即 fail-close。
3. 在 `validation_helpers`/请求入口前置校验“`routePolicy × credentialSource` 组合合法性”。
4. 在 `provider_resolver` 增加二次防线校验，禁止非法组合进入 provider 分发。
5. local-route 不变量：仅接受 `runtime-config`；`request-injected + local-runtime` 直接拒绝，`provider_local` 不消费请求期 secret。
6. `runtime-config` 与 `request-injected` 两类路径严格隔离，不允许静默回落。
7. `artifact_methods` 与 `media_job_methods` 保持 context 透传调用，不引入 provider 接口签名分叉。
8. 审计记录凭证来源与不可逆指纹。

### WP3：Runtime CLI/Entrypoint 对齐

涉及文件

1. `runtime/internal/entrypoint/runtime.go`
2. `runtime/internal/entrypoint/stream_metadata_helpers.go`
3. `runtime/cmd/nimi/command_helpers.go`
4. `runtime/cmd/nimi/ai_text_commands.go`
5. `runtime/cmd/nimi/ai_artifact_commands.go`
6. `runtime/internal/config/config.go`
7. `runtime/internal/config/config_test.go`

交付

1. CLI/headless 默认注入 `credentialSource=runtime-config`。
2. entrypoint metadata 能表达凭证来源与请求期凭证字段。
3. config 层明确“请求期凭证不落盘”，仅保留 daemon-config 平面（`apiKeyEnv`/`secretRef`）表达。

### WP4：SDK Runtime/Mod 类型与调用面收敛

涉及文件

1. `sdk/src/runtime/types.ts`
2. `sdk/src/runtime/core/metadata.ts`
3. `sdk/src/runtime/core/client.ts`
4. `sdk/src/runtime/transports/node-grpc/index.ts`
5. `sdk/src/runtime/transports/tauri-ipc/index.ts`
6. `sdk/src/mod/types/llm.ts`
7. `sdk/src/mod/types/runtime-hook/llm.ts`
8. `sdk/src/mod/hook/llm-client.ts`
9. `sdk/src/mod/internal/host-types.ts`
10. `sdk/src/mod/internal/runtime-access.ts`
11. `sdk/src/mod/ai/index.ts`

交付

1. runtime metadata 增加 typed 凭证字段（非 `extra` 旁路）。
2. mod 类型面移除 `localOpenAiApiKey` 暴露。
3. token-api 请求在 SDK 层前置校验凭证来源必填。
4. node-grpc 与 tauri-ipc 对凭证 metadata 字段执行语义等价的 typed 过滤与保留键约束（允许 TypeScript/Rust 各自实现）。
5. `sdk/src/mod` 执行层（types + client + runtime-access + ai entry）同步移除 `localOpenAiApiKey` 透传，避免类型变更后实现层编译断裂。

### WP5：Desktop 路由/Hook/Tauri-Bridge/Speech 全链路收敛

涉及文件

1. `apps/desktop/src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11.ts`
2. `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts`
3. `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-data-capabilities/runtime-route-capabilities.ts`
4. `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils.ts`
5. `apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts`
6. `apps/desktop/src/runtime/llm-adapter/execution/invoke-text.ts`
7. `apps/desktop/src/runtime/hook/services/speech/synthesize.ts`
8. `apps/desktop/src/runtime/hook/services/speech-service.ts`
9. `apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-defaults.ts`
10. `apps/desktop/src/shell/renderer/app-shell/providers/store-types.ts`
11. `apps/desktop/src-tauri/src/runtime_bridge/metadata.rs`
12. `apps/desktop/src-tauri/src/runtime_bridge/unary.rs`
13. `apps/desktop/src-tauri/src/runtime_bridge/stream.rs`
14. `apps/desktop/src-tauri/src/runtime_bridge/error_map.rs`
15. `apps/desktop/src/runtime/llm-adapter/execution/types.ts`
16. `apps/desktop/src/runtime/llm-adapter/execution/kernel-turn.ts`
17. `apps/desktop/src/runtime/llm-adapter/execution/health-check.ts`
18. `apps/desktop/src/runtime/execution-kernel/contracts/types.ts`
19. `apps/desktop/src/runtime/hook/contracts/types.ts`
20. `apps/desktop/src/runtime/hook/contracts/facade.ts`
21. `apps/desktop/src/runtime/hook/hook-runtime.service.ts`
22. `apps/desktop/src/runtime/hook/services/llm-service.ts`
23. `apps/desktop/src/runtime/hook/services/speech/types.ts`
24. `apps/desktop/src/runtime/hook/services/speech/stream.ts`
25. `apps/desktop/src/shell/renderer/features/runtime-config/state/v11/storage/defaults.ts`
26. `apps/desktop/src/shell/renderer/features/runtime-config/effects/hydration.ts`
27. `apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery.ts`
28. `apps/desktop/src/shell/renderer/bridge/runtime-bridge/types.ts`
29. `apps/desktop/src/shell/renderer/app-shell/providers/store-slices/runtime-slice.ts`
30. `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts`
31. `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts`
32. `apps/desktop/src/shell/renderer/mod-ui/host/runtime-query/field-bindings.ts`

交付

1. route 结果从 `localOpenAiApiKey` 改为 `credentialRefId`。
2. connectorId 仅用于 host 内部解析，mod 不见明文 key。
3. speech consume 并入 runtime AI consume 主链（`SubmitMediaJob` 族 RPC）。
4. renderer 状态与默认值去明文化。
5. tauri Rust bridge 与 SDK transport 对齐凭证 metadata 合同，确保 `x-nimi-credential-*` 字段可控透传且不污染保留键。
6. 与 desktop 对应测试（至少 `runtime-route-resolver-v11`、runtime bridge invoke、speech route）在同一变更原子同步更新，避免中间态编译/测试断裂。
7. 明确记录 `apps/desktop/src-tauri/src/runtime_bridge/generated/method_ids.rs` 的处置结论（改动或不改动及理由），避免 bridge 范围漂移。
8. TTS 收敛入口明确落在 `speech-service.ts/synthesize.ts`：以 `runtime.media.tts.synthesize()` 替换 `speechEngine.synthesize()` 主路径，不新增 `invoke-tts.ts`。
9. 完成 Rust bridge 错误/日志脱敏审计：确保 `x-nimi-provider-api-key` 不出现在 bridge error/panic/tracing 输出。
10. `RuntimeBridgeMetadata` 禁止 secret 可见的默认 `Debug` 输出（移除 derive 或实现 redacted Debug）。
11. `apps/desktop/src` 级联调用面同步清零 `localOpenAiApiKey`（含 llm-adapter/hook/bootstrap/store/bridge/runtime-config/mod-ui），避免仅改主入口导致大面积编译断裂。

### WP6：Examples 教学链路重写

涉及文件

1. `docs/examples/providers/deepseek-chat.ts`
2. `docs/examples/providers/bytedance-tts.ts`
3. `docs/examples/providers/README.md`
4. `docs/examples/providers/_common.ts`

交付

1. 单文件直观示例，不依赖 `_common` 深包装执行链。
2. 示例流程展示“保存 connector -> 获取 connectorId -> 调用 generate/tts”。
3. 移除“runtime 启动时注入 API key 才能调用”的教程主叙事。
4. `_common.ts` 删除或降级为非入口辅助（不参与主示例执行链）。

### WP7：测试与门禁升级

涉及文件

1. `runtime/internal/services/ai/*_test.go`
2. `runtime/internal/protocol/envelope/*_test.go`
3. `runtime/internal/grpcserver/*_test.go`
4. `runtime/cmd/runtime-compliance/main.go`
5. `sdk/test/runtime/runtime-client.test.ts`
6. `apps/desktop/test/runtime-route-resolver-v11.test.ts`
7. `apps/desktop/test/runtime-bridge-invoke.test.ts`
8. `apps/desktop/test/runtime-bootstrap-speech-route-resolver.test.ts`
9. 新增 desktop route/credential 注入专项测试
10. 新增 runtime route/credential 组合矩阵测试（覆盖 `provider_resolver` 与 local-route 不变量）
11. `sdk/test/mod/mod-runtime-context.test.ts`
12. `apps/desktop/test/runtime-daemon-state.test.ts`
13. `apps/desktop/test/runtime-bridge-config.test.ts`
14. `apps/desktop/test/runtime-config-split-contract.test.ts`

交付

1. 新增 request-credential fail-close 测试矩阵。
2. 运行时合规模块新增凭证来源门禁条目。
3. 删除或重写“空 token 也可通过”回归测试。
4. 覆盖 tauri-ipc + Rust bridge 元数据透传/约束一致性用例。
5. 覆盖 Rust bridge error payload 脱敏用例（断言错误文本不含 `x-nimi-provider-api-key` 明文值）。
6. 覆盖 `RuntimeBridgeMetadata` Debug 脱敏用例（或等价静态门禁），防止 `extra` 中 secret 被调试输出。
7. 覆盖 node-grpc 与 tauri-ipc 在同一 metadata 输入下的语义一致性断言。
8. 源码扫描门禁：`apps/desktop/src` 与 `sdk/src/mod` 中业务字段 `localOpenAiApiKey` 为 0（迁移兼容分支除外）。

## 7. 执行顺序（单次收敛）

1. 先做 `WP0 + WP1`（规范与 proto 真相统一）。
2. 在 `WP4/WP5` 开始前冻结影响面清单：`rg -l "localOpenAiApiKey" sdk/src/mod apps/desktop/src` 输出文件必须全部纳入本轮变更。
3. 同步推进 `WP2 + WP3 + WP4`（runtime/sdk 协议执行面打通，含 config 平面边界收敛）。
4. 执行 `WP5 + WP7(desktop子集)` 原子变更（desktop 消费面、tauri bridge、speech 链路与对应测试同步收敛）。
5. 完成 `WP6`（示例教学链路改写）。
6. 完成 `WP7` 其余门禁（runtime/sdk/compliance 全量收口）。

说明：全部工作在同一轮收敛，不发布中间态，不保留 legacy 并存路径。

跨计划关系：

1. `dev/plan/desktop-ai-consumption-remediation-implementation-plan-2026-02-27.md` 作为 WP5 的 desktop 细化清单使用。
2. 本计划（runtime-ssot-system-audit）是跨组件主计划，优先约束 SSOT/proto/runtime/sdk/desktop 的统一收敛语义。
3. desktop 计划与本计划 WP5 重叠文件必须在同一执行分支原子提交，禁止双计划分叉改同一文件。

## 8. 验收门禁命令

```bash
# 在仓库根目录执行（$PROJECT_ROOT）

# SSOT gates
pnpm check:ssot-frontmatter
pnpm check:ssot-links
pnpm check:ssot-boundary
pnpm check:ssot-proto-first

# Scope gates（应为 0；迁移兼容分支除外）
if rg -n "localOpenAiApiKey" sdk/src/mod apps/desktop/src; then
  echo "[FAIL] localOpenAiApiKey still exists in sdk/src/mod or apps/desktop/src"
  exit 1
fi

# Proto gates
cd proto
buf lint
buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb
buf generate
# 仅 WP1 合并后执行一次；后续常规验收默认跳过，避免静默覆盖 baseline。
buf build -o ../runtime/proto/runtime-v1.baseline.binpb
cd ..
pnpm proto:drift-check

# Runtime gates
cd runtime
go test ./...
go run ./cmd/runtime-compliance --gate
cd ..

# SDK gates
pnpm --filter @nimiplatform/sdk test
pnpm check:sdk-coverage

# Desktop gates
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec tsx --test \
  test/runtime-route-resolver-v11.test.ts \
  test/runtime-bridge-invoke.test.ts \
  test/runtime-bootstrap-speech-route-resolver.test.ts
cd apps/desktop/src-tauri
cargo test runtime_bridge
cd ../../..

# Example smoke（手动验收，非 CI 强制门禁）
# 前置条件：
# 1) runtime daemon 已启动并可访问；
# 2) connector/凭证已配置（request-injected 或 runtime-config 任一可用路径）；
# 3) 测试账号具备可用 provider 配额。
npx tsx docs/examples/providers/deepseek-chat.ts
npx tsx docs/examples/providers/bytedance-tts.ts
```

## 9. 风险与约束

1. `request-injected` 需要在受信宿主进程中解析并注入，必须避免 renderer/mod 直接持有 secret。
2. metadata 传递请求期 secret 时，日志与审计链必须严格脱敏。
3. 本计划不考虑兼容性，允许直接移除 `localOpenAiApiKey` 暴露字段与旧测试断言。
4. tauri-ipc 与 Rust bridge 属于 desktop 主调用链，若凭证字段约束只在 node-grpc 生效会导致链路语义失真，必须双端同测同改。
5. speech 从直连 provider 迁移到 runtime media-job 主链时，需同步处理超时、轮询/订阅、artifact 解析，否则会出现功能回归与时序死锁风险。
6. Rust bridge 当前透传 metadata（含请求期凭证字段）；若错误映射或日志链路未脱敏，存在 secret 泄漏风险，必须以测试门禁锁定。
7. 本计划 WP5 与 desktop 专项计划改动面重叠，若不做单分支原子执行会导致同文件漂移与回归冲突。
8. `RuntimeBridgeMetadata` 的 Debug 输出若未脱敏，将成为 secret 泄漏放大器；必须在代码与测试中双重约束。
9. 若 WP4/WP5 未覆盖 `localOpenAiApiKey` 的级联调用文件，`tsc --noEmit` 将在中后段集中爆错，造成执行节奏与工时预估失真。

## 10. 完成定义（DoD）

1. SSOT 内部冲突项（SSOT-001~006）全部关闭。
2. runtime 在 `token-api` 路径下对 `credentialSource` 与请求期凭证执行 fail-close。
3. sdk/desktop/mod 类型面不再向非受信调用方暴露明文 API key。
4. speech 与 chat/embedding/image/video 统一由 runtime AI consume 链路承载。
5. examples、测试、compliance 门禁与 SSOT 语义一致并可重放。
6. `sdk/src/mod` 与 `apps/desktop/src` 的业务链路中 `localOpenAiApiKey` 字段清零（迁移兼容分支除外）。
