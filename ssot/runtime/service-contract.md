---
title: Nimi Runtime Service Skeleton
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Runtime Service (V0.1 必填骨架)

## 0. 文档定位（必填）

本文件用于把 `nimi-runtime` 从架构愿景推进到可编码合同。

- 当前状态：`FROZEN`
- 用途：runtime 独立实现前的接口与治理冻结草案
- 非目标：不覆盖 Desktop UI 与 World 业务规则
- Runtime Config 合同：`ssot/runtime/config-contract.md`
- 多模态补充合同：`ssot/runtime/multimodal-provider-contract.md`
- 多模态交付门禁：`ssot/runtime/multimodal-delivery-gates.md`

## 1. 目标与边界（必填）

**目标**：定义 `nimi-runtime` 作为独立本地服务的执行、安全、接口与审计合同。  
**边界**：只定义 runtime 服务面，不定义 realm 业务语义。

版本策略（strict-only）：
- `MUST`：runtime 协议执行采用 strict-only，不接受跨 `minor` 协商与过渡态。
- `MUST`：未上线阶段不引入 legacy 路径或双规则并存。

补充边界：
- App 可仅接入 runtime，不依赖 realm。
- ExternalPrincipal 访问 App 的授权属于 runtime 执行域，不等同于 realm 登录态。
- World 与 extension-app 的绑定关系属于 realm/world 业务域，不由 runtime 决策真相。

## 2. 进程与组件模型（必填）

### 2.1 进程拓扑

- `nimi serve`：主 daemon 启动入口（调度、鉴权、路由、审计）
- `inference-worker`：推理子进程（可多实例）
- `model-lifecycle-worker`：模型安装/卸载/健康
- `workflow-worker`：异步任务与 DAG 执行
- `audit-sink`：本地审计落盘与导出

### 2.2 生命周期状态机

`STOPPED -> STARTING -> READY -> DEGRADED -> STOPPING -> STOPPED`

约束：
- `MUST`：`STARTING` 失败必须回到 `STOPPED` 并写审计。
- `MUST`：`DEGRADED` 必须附带 `reasonCode` 和修复建议。
- `MUST`：`STOPPING` 不允许接收新写请求。

### 2.3 AI 执行平面（V1 冻结）

执行平面分层：
- `local-plane`：`LocalAI + Nexa`（本地模型推理覆盖）。
- `cloud-plane`：`nimiLLM`（统一云推理网关，覆盖核心 provider 全量模型能力）。
- `orchestrator-plane`：`workflow-worker`（多模型 DAG 编排与异步任务治理）。

冻结规则：
1. `MUST`：Runtime 对上只暴露统一 gRPC 合同，不暴露底层 provider 私有接口。
2. `MUST`：请求必须显式声明 `routePolicy(local-runtime|token-api)`。
3. `MUST`：禁止静默 fallback；所有回退必须返回 `routeDecision` 并写审计。
4. `MUST`：DAG 编排仅通过 `RuntimeWorkflowService`，不得复用 `RuntimeAiService` 假装编排。
5. `MUST`：底层 provider 替换不得改变 SDK 导入面语义与错误码集合。

### 2.4 实现语言决策（V1 锁定）

- `MUST`：`nimi-runtime` 控制平面实现语言锁定 Go（daemon + CLI 同二进制）。
- `MUST`：`desktop`（Rust）与 runtime 通过 gRPC/proto 协议边界协作，不跨进程复用 runtime 业务逻辑。
- `MUST`：语言重评估只在触发条件命中时进行，触发条件：
  1. 控制平面 SLO 长期不达标且确认瓶颈来自 Go runtime 特性。
  2. 主路径必须启用 in-process 零拷贝/共享内存通道。
  3. runtime 新增高风险本地沙箱执行器，现有语言约束无法满足安全目标。

## 3. 身份与鉴权（必填）

### 3.1 Principal 模型（最小集合）

App Principal：
- `appId`
- `appInstanceId`
- `deviceId`
- `sessionId`
- `issuedAt`
- `expiresAt`

ExternalPrincipal：
- `externalPrincipalId`
- `externalPrincipalType`（`external-agent | external-app | external-service`）
- `issuer`（`runtime | control-plane`）
- `subjectAppId`
- `clientId`
- `signatureKeyId`
- `proofType`（`ed25519 | hmac-sha256`）
- `tokenId`
- `issuedAt`
- `expiresAt`

### 3.2 会话握手（V1 最小集合）

1. `registerApp`
2. `openSession`
3. `refreshSession`
4. `revokeSession`
5. `registerExternalPrincipal`
6. `openExternalPrincipalSession`（challenge + proof）
7. `revokeExternalPrincipalSession`

拒绝语义：
- `APP_NOT_REGISTERED`
- `EXTERNAL_PRINCIPAL_NOT_REGISTERED`
- `EXTERNAL_PRINCIPAL_PROOF_MISSING`
- `EXTERNAL_PRINCIPAL_PROOF_INVALID`
- `SESSION_EXPIRED`
- `PRINCIPAL_UNAUTHORIZED`

### 3.3 Browser/Mod 经 Local Broker 授权（FUTURE 占位）

目标：为未来“网页/mod 访问本地模型”保留接口语义；当前阶段仅做标注，不纳入 V1 实现与发布门槛。

`brokerGrant` 最小声明（由 realm 签名）：
- `iss`（固定 `nimi-realm`）
- `aud`（固定 `nimi-local-broker`）
- `origin`（`scheme + host + port` 精确绑定）
- `appId`
- `subjectUserId`
- `effectiveScopes`（仅允许最小 `runtime.*` 子集）
- `routePolicy`（固定 `local-runtime`）
- `exp`
- `jti`
- `keyId`

预留规则（启用该能力时再冻结）：
1. broker 校验签名、`iss/aud`、`exp`、`keyId`，失败拒绝（`APP_GRANT_INVALID`）。
2. broker 强校验 `origin` 绑定，并做 `jti` 防重放。
3. broker 首次授权走本地用户显式同意，后续受 `exp + scope + origin` 限制。
4. broker 仅下放 grant 权限子集，不提权。
5. broker 不接收/透传 `apiKey/token/providerSecret`，不代理 `token-api`。

## 4. 能力授权模型（必填）

### 4.1 能力分级

| 等级 | 含义 | 例子 |
|------|------|------|
| `standard` | 低风险调用 | 文本生成、只读查询 |
| `sensitive` | 用户数据相关 | 跨 App 数据读取、知识库写入 |
| `protected` | 平台受保护能力 | `runtime.app.send.cross_app`, `runtime.audit.export`, `runtime.model.remove`, `runtime.app_auth.policy.override` |

### 4.2 授权规则

- 默认最小权限。
- `sensitive/protected` 必须显式授权。
- 会话级授权与持久授权必须可区分。
- 未授权调用必须 `fail-close`。
- V1 固定 `protected` 初始集合为：`runtime.app.send.cross_app`, `runtime.audit.export`, `runtime.model.remove`, `runtime.app_auth.policy.override`。

### 4.3 App 授权统一模型（普通/高级同构）

规范来源：授权语义真相以 `platform/protocol.md §3.4` 为准；本节只定义 runtime 执行面约束。

核心职责：
- App：授权决策点（scope、preset、是否允许委托）。
- SDK：scope catalog 发布 + 协议封装层（请求/回调/错误映射）。
- Runtime：`app-auth/runtime.*` 的 token 签发与校验执行点（统一安全根）。
- Realm：`realm.*` 域授权执行点（runtime 不替代 realm 判定）。

普通模式（preset）：
- `readOnly`
- `full`
- `delegate`

高级模式（custom）：
- 自定义 scopes
- 自定义 resource selectors（如会话 ID、时间窗口）
- 自定义 TTL/配额限制
- 自定义委托边界（depth/可委托 scopes）

类型示例：
- `external-agent`：OpenClaw 等独立 AI Agent。
- `external-app`：基于聊天记录生成小说的工具类 App。
- `external-service`：自动化任务服务或第三方协同服务。

统一约束：
1. `MUST`：普通/高级共用同一 token 结构与校验链路。
2. `MUST`：同一 ExternalPrincipal 访问不同 App 使用不同 token。
3. `SHOULD`：默认一个 `externalPrincipal-app` 组合仅一个主 token，不强制 scope 拆 token。
4. `MUST`：`delegate` 仅允许签发权限子集的子 token。
5. `MUST`：父 token 撤销必须级联撤销所有子 token。
6. `MUST`：授权决策必须带同意证据（`subjectUserId + consentId + consentVersion + decisionAt`）。
7. `MUST`：若配置 `resourceSelectors`，runtime 必须在访问路径强制执行资源级约束。
8. `MUST`：子 token 的 `resourceSelectors` 必须是父 token 的子集。
9. `MUST`：runtime 仅接受 SDK 发布的 scope catalog 版本，不接受未登记 scope。
10. `MUST`：runtime 不得把 `realm.*` scope 视为本地可放行权限，必须以 realm 执行结果为准。
11. `MUST`：`preset=delegate` 默认 `maxDelegationDepth=1`，二次委托默认拒绝。
12. `MUST`：App 授权策略更新后，既有主 token 与子 token 必须立即失效。

## 5. 数据与凭证隔离（必填）

### 5.1 数据分层

- `realm-cache`：来自 realm 的缓存视图（只读优先）
- `per-app-user storage`：按 `appId + subjectUserId(authId)` 分区，作为本地多用户隔离最小单元
- `shared storage`：仅在用户授权后暴露，且必须携带 `subjectUserId(authId)` 参与授权判定

### 5.2 凭证策略

- 用户凭证由受信宿主持久化在受控 secret 存储（如 OS keychain 或等效机制，句柄引用，不回传明文）
- 访问凭证必须走授权检查
- 凭证轮转与吊销必须写审计
- FUTURE（local broker 启用时）：broker 路径不得接收、存储或转发云端 provider 凭证（`apiKey/token/providerSecret`）。

### 5.3 App Access Token 策略

- Runtime 只在签发时一次性返回 token secret。
- token 必须绑定：`domain(app-auth) + appId + subjectUserId + externalPrincipalId + effectiveScopes + resourceSelectors + policyVersion + issuedScopeCatalogVersion + consentRef + expiresAt`。
- Runtime 必须强制校验过期、撤销、scope、委托深度。
- Runtime 签发时必须校验请求 `scopeCatalogVersion` 已发布且可解析。
- Runtime 必须强制校验 `consentRef` 完整性和有效性。
- Runtime 必须校验 `token.policyVersion` 与当前策略版本一致，不一致即拒绝。
- Runtime 必须在策略更新时执行 token 链路即时撤销（主 token + 子 token）。
- Runtime 校验时必须以 `token.issuedScopeCatalogVersion + 当前撤销索引` 判定 scope 有效性；仅版本升高不得静默使旧 token 失效。
- 若 `issuedScopeCatalogVersion` 不可解析，必须拒绝（`CAPABILITY_CATALOG_MISMATCH`）。
- App 可选二次校验业务前置条件，但不能绕过 Runtime 校验结果。
- 不允许“仅靠 App 本地时间判断过期”的弱校验模式。

## 6. gRPC 契约（必填）

### 6.1 服务分组

- `RuntimeAuthService`
- `RuntimeGrantService`
- `RuntimeAiService`
- `RuntimeWorkflowService`
- `RuntimeModelService`
- `RuntimeKnowledgeService`
- `RuntimeAppService`
- `RuntimeAuditService`

### 6.1.1 L0 Envelope 到 gRPC 映射（必填）

`MUST`：L0 协议字段通过 gRPC metadata 透传，业务字段走 proto body。

- `x-nimi-protocol-version` -> `protocolVersion`
- `x-nimi-participant-protocol-version` -> `participantProtocolVersion`
- `x-nimi-participant-id` -> `participantId`
- `x-nimi-domain` -> `domain`
- `x-nimi-app-id` -> `appId`
- `x-nimi-trace-id` -> `traceId`
- `x-nimi-idempotency-key` -> `idempotencyKey`
- `x-nimi-caller-kind` -> `callerKind`（`desktop-core|desktop-mod|third-party-app|third-party-service`）
- `x-nimi-caller-id` -> `callerId`（如 `desktop`、`mod:<modId>`、`app:<appId>`）
- `x-nimi-surface-id` -> `surfaceId`（可选：页面/模块/入口标识）

`MUST`：`callerKind/callerId/surfaceId` 仅用于审计与统计归因，不得用于授予额外权限或绕过 scope 校验。
`MUST`：`token-api` 路由必须通过 transport profile 的等效安全上下文显式传递 `credentialSource`，不得依赖推断；该约束不要求新增 L0 envelope 字段。

### 6.1.2 Schema 真相源（必填）

- `ssot/runtime/proto-contract.md`：字段级合同与 `.proto` 骨架真相（service/message/enum）。
- 本文：执行语义与治理约束真相（状态机/错误语义/审计/默认超时）。
- 变更规则：涉及字段变更先改 `ssot/runtime/proto-contract.md`，涉及语义变更先改本文对应章节。

### 6.1.3 Runtime Transport Profile（V1 + FUTURE）

- `node-grpc`（V1）：可信进程（desktop main / native app / node service）直连 runtime gRPC，可用 `local-runtime|token-api`。
- `tauri-ipc`（V1）：desktop renderer 通过 tauri Rust bridge 访问 runtime gRPC（协议一致，bridge 负责 metadata/base64/allowlist 校验）。
- `local-broker`（FUTURE）：不可信面（desktop mod / browser page）通过 IPC/loopback broker 访问 runtime。

约束：
1. `MUST`：V1 仅允许 `node-grpc` 与 `tauri-ipc` 两个 profile；两者必须映射同一 Runtime RPC 合同。
2. `MUST`：`tauri-ipc` 仅作为 desktop renderer 面的受控桥接，不改变 runtime 授权与审计判定。
3. FUTURE（local-broker 启用时）再执行 grant/origin/local-only 等强约束与契约测试。

### 6.2 最小 RPC 面（V1 最小集合）

说明：`ssot/runtime/proto-contract.md` 已覆盖本节 8 个 service 的 message/service 骨架；本文件继续承担执行语义与治理规则真相。

| Service | RPC（最小集合） |
|--------|----------------|
| `RuntimeAuthService` | `RegisterApp`, `OpenSession`, `RefreshSession`, `RevokeSession`, `RegisterExternalPrincipal`, `OpenExternalPrincipalSession`, `RevokeExternalPrincipalSession` |
| `RuntimeGrantService` | `AuthorizeExternalPrincipal`, `ValidateAppAccessToken`, `RevokeAppAccessToken`, `IssueDelegatedAccessToken`, `ListTokenChain` |
| `RuntimeAiService` | `Generate`, `StreamGenerate`, `Embed`, `GenerateImage`, `GenerateVideo`, `SynthesizeSpeech`, `TranscribeAudio` |
| `RuntimeWorkflowService` | `SubmitWorkflow`, `GetWorkflow`, `CancelWorkflow`, `SubscribeWorkflowEvents` |
| `RuntimeModelService` | `ListModels`, `PullModel`, `RemoveModel`, `CheckModelHealth` |
| `RuntimeKnowledgeService` | `BuildIndex`, `SearchIndex`, `DeleteIndex` |
| `RuntimeAppService` | `SendAppMessage`, `SubscribeAppMessages` |
| `RuntimeAuditService` | `ListAuditEvents`, `ExportAuditEvents`, `ListUsageStats`, `GetRuntimeHealth`, `SubscribeRuntimeHealthEvents` |

每个 RPC 必填：
- 请求/响应 schema
- `reasonCode` 集合
- 幂等规则
- 超时默认值
- 大 payload 传输语义（V1 固定：仅 gRPC streaming/分块，不支持 shared memory 通道）

App 授权链路 reasonCode 最小集合：
- `APP_AUTHORIZATION_DENIED`
- `APP_GRANT_INVALID`
- `APP_TOKEN_EXPIRED`
- `APP_TOKEN_REVOKED`
- `APP_SCOPE_FORBIDDEN`
- `APP_SCOPE_CATALOG_UNPUBLISHED`
- `APP_SCOPE_REVOKED`
- `APP_DELEGATION_FORBIDDEN`
- `APP_DELEGATION_DEPTH_EXCEEDED`
- `APP_RESOURCE_SELECTOR_INVALID`
- `APP_RESOURCE_OUT_OF_SCOPE`
- `APP_CONSENT_MISSING`
- `APP_CONSENT_INVALID`
- `EXTERNAL_PRINCIPAL_PROOF_MISSING`
- `EXTERNAL_PRINCIPAL_PROOF_INVALID`
- `APP_MODE_DOMAIN_FORBIDDEN`
- `APP_MODE_SCOPE_FORBIDDEN`
- `APP_MODE_WORLD_RELATION_FORBIDDEN`
- `APP_MODE_MANIFEST_INVALID`
- `PROTOCOL_ENVELOPE_INVALID`
- `PROTOCOL_DOMAIN_FIELD_CONFLICT`
- `CAPABILITY_CATALOG_MISMATCH`

### 6.3 App 授权 RPC 关键字段（必填）

`AuthorizeExternalPrincipal` 请求必须包含：
- `domain=app-auth`
- `appId`
- `externalPrincipalId`
- `externalPrincipalType`
- `subjectUserId`（即 authId，参与 `appId + subjectUserId` 分区）
- `policyMode`（`preset|custom`）
- `preset`（当 `policyMode=preset`）
- `scopes`
- `resourceSelectors`（可选）
- `consentId`
- `consentVersion`
- `decisionAt`
- `policyVersion`
- `canDelegate`
- `maxDelegationDepth`
- `ttlSeconds`
- `idempotencyKey`
- `scopeCatalogVersion`
  - 来源：SDK scope catalog 生成管线发布版本

`AuthorizeExternalPrincipal` 响应必须包含：
- `tokenId`
- `appId`
- `subjectUserId`
- `externalPrincipalId`
- `effectiveScopes`
- `resourceSelectors`
- `consentRef`（`subjectUserId + consentId + consentVersion`）
- `policyVersion`
- `issuedScopeCatalogVersion`
- `canDelegate`
- `expiresAt`
- `secret`（仅签发时一次性返回）

组合约束：
1. `MUST`：`domain=app-auth` 时不得携带 `primitive`。
2. `MUST`：写操作请求必须携带 `idempotencyKey`。
3. `MUST`：字段缺失或 domain/字段冲突必须拒绝并返回 `PROTOCOL_ENVELOPE_INVALID`。
4. `MUST`：`scopes` 必须来自请求 `scopeCatalogVersion` 对应目录；目录不可解析时拒绝（`CAPABILITY_CATALOG_MISMATCH`）。
5. `MUST`：`realm.*` scope 不得在 runtime 侧直接放行，需由 realm 域执行结果确认。
6. `MUST`：策略更新后旧 `policyVersion` 的 token 必须拒绝（`APP_GRANT_INVALID` 或 `APP_TOKEN_REVOKED`）。
7. `MUST`：`preset=delegate` 下二次委托请求必须拒绝（`APP_DELEGATION_DEPTH_EXCEEDED`）。
8. `MUST`：签发阶段仅接受状态为 `published` 的 `scopeCatalogVersion`，未发布版本拒绝（`APP_SCOPE_CATALOG_UNPUBLISHED`）。
9. `MUST`：命中已撤销或已移除 scope 时必须拒绝（`APP_SCOPE_REVOKED`）。
10. `MUST`：校验阶段使用 `token.issuedScopeCatalogVersion` 解析 scopes；仅 catalog 升版不得导致 token 自动失效。
11. `MUST`：`token.subjectUserId` 与当前请求声明用户不一致时拒绝（`APP_GRANT_INVALID`）。

### 6.3.1 App Mode 违规语义（必填）

模式真相来自 `appMode + mode manifest`，执行顺序固定为“先域后 scope”。

规则：
1. `MUST`：`Lite`（`realm-only`）请求命中 `runtime.*` 域时拒绝（`APP_MODE_DOMAIN_FORBIDDEN`，`actionHint=remove_runtime_scopes_or_switch_mode_full`）。
2. `MUST`：`Core-only`（`runtime-only`）请求命中 `realm.*` 域时拒绝（`APP_MODE_DOMAIN_FORBIDDEN`，`actionHint=remove_realm_scopes_or_switch_mode_full`）。
3. `MUST`：模式与 scope 不一致时拒绝（`APP_MODE_SCOPE_FORBIDDEN`）。
4. `MUST`：`worldRelation=extension` 与 `appMode=lite` 组合拒绝（`APP_MODE_WORLD_RELATION_FORBIDDEN`）。
5. `MUST`：manifest 字段冲突（`runtimeRequired/realmRequired/appMode`）拒绝（`APP_MODE_MANIFEST_INVALID`）。
6. `MUST`：模式违规必须 fail-fast，不得继续执行后续授权或业务调用。

### 6.4 RuntimeAiService 合同（必填）

目标：把 AI 推理路径提升到“可直接编码 + 可直接测试”的合同精度。

> REF-ERRATA (2026-02-26): 本节定义的是 V1 baseline。多厂商多模态 canonical 字段、async job、一等 artifact metadata、provider coverage 规则，以 `ssot/runtime/multimodal-provider-contract.md` 为准。

#### 6.4.1 `Generate`（unary）

请求最小字段：
- `traceId`
- `appId`
- `subjectUserId`（authId）
- `modelId`
- `modal`（`text|image|video|tts|stt|embedding`）
- `input`
- `systemPrompt`（可选）
- `tools`（可选）
- `temperature/topP/maxTokens`（按 modal 可选）
- `routePolicy`（`local-runtime|token-api`）
- `timeoutMs`
- `idempotencyKey`

响应最小字段：
- `output`
- `finishReason`（`stop|length|tool_call|content_filter|error`）
- `usage`（`inputTokens/outputTokens/computeMs`）
- `routeDecision`（`local-runtime|token-api`）
- `modelResolved`
- `traceId`

#### 6.4.2 `StreamGenerate`（server streaming）

统一流事件 envelope：
- `eventType`（`started|delta|tool_call|tool_result|usage|completed|failed`）
- `sequence`（单调递增）
- `traceId`
- `timestamp`
- `payload`

约束：
1. `MUST`：`started` 仅出现一次且必须是首事件。
2. `MUST`：`completed|failed` 二选一且只能出现一次，必须是末事件。
3. `MUST`：`sequence` 必须连续；缺口视为流损坏并记审计。
4. `MUST`：`usage` 至少在结束前出现一次。
5. `MUST`：工具调用必须成对（`tool_call -> tool_result`）。

#### 6.4.3 AI 错误码最小集合

- `AI_MODEL_NOT_FOUND`
- `AI_MODEL_NOT_READY`
- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_ROUTE_UNSUPPORTED`
- `AI_ROUTE_FALLBACK_DENIED`
- `AI_INPUT_INVALID`
- `AI_OUTPUT_INVALID`
- `AI_STREAM_BROKEN`
- `AI_CONTENT_FILTER_BLOCKED`
- `AI_REQUEST_CREDENTIAL_REQUIRED`
- `AI_REQUEST_CREDENTIAL_MISSING`
- `AI_REQUEST_CREDENTIAL_INVALID`
- `AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN`

#### 6.4.4 超时默认值（V1 固定）

- `Generate(text)`：`30_000ms`
- `StreamGenerate(text)`：首包 `10_000ms`，全程 `120_000ms`
- `GenerateImage`：`120_000ms`
- `GenerateVideo`：`300_000ms`
- `SynthesizeSpeech`：`45_000ms`
- `TranscribeAudio`：`90_000ms`
- `Embed`：`20_000ms`

#### 6.4.5 路由与回退（无 legacy）

1. `MUST`：请求必须显式声明 `routePolicy`。
2. `MUST`：仅允许 `local-runtime` 与 `token-api` 两种路由源。
3. `MUST`：禁止静默 fallback；发生回退必须返回 `routeDecision` 并写审计。
4. `MUST`：当调用方声明 `fallback=deny` 时，回退请求必须拒绝（`AI_ROUTE_FALLBACK_DENIED`）。
5. `MUST`：`token-api` 路由必须校验凭证可用性与配额。
6. `MUST`：`RuntimeAiService` 只处理单模型调用；跨节点编排请求必须拒绝并引导走 workflow 接口（`AI_ROUTE_UNSUPPORTED` + actionHint）。

#### 6.4.6 Token-API 请求期凭证合同（MUST）

1. `MUST`：`token-api` 调用必须绑定显式凭证来源，允许值：
   1. `credentialSource=request-injected`（受信宿主在请求期注入 provider secret；例如 desktop 先解析 `connectorId` 再注入）
   2. `credentialSource=runtime-config`（runtime/cli/headless 使用进程配置凭证）
2. `MUST`：`credentialSource` 属于 transport profile 字段（metadata 或 profile 等效安全上下文），不是 `.proto` body 中的明文字段。
3. `MUST`：desktop/mod 执行面默认使用 `credentialSource=request-injected`；缺少请求期凭证时必须拒绝，不得静默降级到进程级凭证。
4. `MUST`：runtime 执行面不得要求调用方提供 `connectorId`，也不得承担 `connectorId -> secret` 解析职责。
5. `MUST`：请求期 secret 轮换必须在下一次请求生效，不得要求 runtime 重启。
6. `MUST`：当 `credentialSource=request-injected` 时，不得回退到 daemon 启动时读取的 provider API key。
7. `MUST`：审计事件必须记录凭证来源与请求凭证引用指纹（不可逆），用于排查“配置凭证”与“请求凭证”漂移。
8. `MUST`：以下失败语义必须可识别并 fail-close：
   1. `AI_REQUEST_CREDENTIAL_REQUIRED`
   2. `AI_REQUEST_CREDENTIAL_MISSING`
   3. `AI_REQUEST_CREDENTIAL_INVALID`
   4. `AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN`

### 6.5 RuntimeModelService 合同（必填）

`PullModel` 请求最小字段：
- `traceId`
- `appId`
- `modelRef`
- `source`（`hf|official|custom`）
- `digest`（可选但建议）
- `idempotencyKey`

`PullModel` 响应最小字段：
- `taskId`
- `accepted`
- `reasonCode`
- `traceId`

`ListModels` 返回最小字段：
- `modelId`
- `version`
- `status`（`installed|pulling|failed|removed`）
- `capabilities`
- `lastHealthAt`

约束：
1. `MUST`：`RemoveModel` 仅允许 `protected` 权限调用。
2. `MUST`：`PullModel` 失败必须可恢复重试，不得产生半安装状态。
3. `MUST`：模型健康异常必须产出 `reasonCode + actionHint`。

## 7. 异步任务与 DAG（必填）

### 7.1 任务状态机

`accepted -> queued -> running -> completed | failed | canceled`

### 7.2 DAG 约束

- 节点依赖必须无环。
- 任一关键节点失败时必须短路。
- 每个节点必须产出进度事件。
- 重试策略必须显式配置（次数、退避策略）。

### 7.3 DAG 接口独立性（必填）

1. `MUST`：DAG 入口固定为 `SubmitWorkflow/GetWorkflow/CancelWorkflow/SubscribeWorkflowEvents`。
2. `MUST`：DAG 执行结果以 `taskId` 追踪，不复用 `Generate/StreamGenerate` 返回结构。
3. `MUST`：DAG 节点可调用 `RuntimeAiService`，但调度语义由 `RuntimeWorkflowService` 独占。
4. `MUST`：第三方复杂 App 的多模型协作场景必须落在 workflow 域，不允许在 SDK 侧手工链式拼接绕过 runtime 编排。

## 8. GPU 仲裁与资源治理（必填）

### 8.1 调度维度

- `app`
- `capability`
- `priority`
- `quota`

### 8.2 必填规则

- 每个 app 必须有最大并发上限。
- 高优先任务可抢占低优先队列（可配置）。
- 必须有饥饿保护（最长等待阈值）。
- OOM/驱动异常必须进入 `DEGRADED` 并可恢复。
- 配额与治理必须由 runtime 统一执行，作用范围覆盖 desktop/mod/third-party 全部调用方。

## 9. 审计与可观测（必填）

### 9.1 审计事件最小集合

- 推理调用
- 模型安装/移除
- workflow 提交/完成
- 权限拒绝
- 跨 App 消息
- 凭证读取/轮转/吊销
- app 授权策略创建/更新
- scope catalog 版本切换（published）
- scope 撤销命中拒绝
- app token 签发/校验/撤销
- delegated token 签发/级联撤销
- app 资源级拒绝（out-of-scope）
- app 同意证据校验失败
- app mode 违规拒绝
- runtime 健康状态变化
- runtime 调用统计聚合刷新

### 9.2 审计字段（MUST）

- `appId`
- `domain`
- `principalId`
- `principalType`
- `externalPrincipalType`
- `capability`
- `tokenId`
- `parentTokenId`
- `subjectUserId`
- `consentId`
- `consentVersion`
- `policyVersion`
- `resourceSelectorHash`
- `callerKind`
- `callerId`
- `surfaceId`
- `reasonCode`
- `traceId`
- `timestamp`

### 9.3 Runtime 调用统计合同（必填）

目标：以 runtime 为唯一统计口径，覆盖 desktop/mod/third-party 全部调用来源。

最小维度：
- `callerKind`（`desktop-core|desktop-mod|third-party-app|third-party-service`）
- `callerId`
- `appId`
- `subjectUserId`
- `capability`（ai/workflow/model/app-auth/...）
- `modelId`（可选）
- `window`（minute/hour/day）

最小指标：
- `requestCount`
- `successCount`
- `errorCount`
- `inputTokens/outputTokens`
- `computeMs`
- `queueWaitMs`

约束：
1. `MUST`：所有 runtime 写/推理调用必须可归因到 `callerKind + callerId`。
2. `MUST`：统计由 runtime 统一生成；desktop 仅消费展示，不做二次口径推导。
3. `MUST`：统计查询必须支持按 `appId/callerKind/capability/window` 过滤。
4. `SHOULD`：支持统计摘要上报 realm 做跨设备运营分析。

## 10. 稳定性与性能预算（必填）

### 10.1 SLO 候选

- daemon 冷启动 `p95 <= 3s`
- 健康恢复 `p95 <= 10s`
- 非推理控制请求 `p95 <= 50ms`

### 10.2 资源预算

- CPU
- 内存
- VRAM
- 磁盘

## 11. 发布门槛（必填）

`MUST`：发布候选前必须通过 `go run ./cmd/runtime-compliance --gate`，并在 `dev/report/*.md` 归档对应证据。

注意：

1. runtime-compliance 仅覆盖 runtime 基础门槛，不覆盖多厂商多模态完整兼容。
2. 任何多模态发布候选必须额外通过 `ssot/runtime/multimodal-delivery-gates.md` 的 G0-G7 全部门禁。

基础门槛最小集合：

- gRPC schema 冻结并通过 breaking-change 检查
- strict-only 版本协商（跨 minor 拒绝、compatMode=strict 强校验）
- 鉴权与授权链路
- ExternalPrincipal -> App 授权链路（preset + custom）
- token 委托链路（subset + ttl + depth + cascade revoke）
- `delegate` preset 二次委托拒绝
- 资源级约束（resourceSelectors subset + out-of-scope deny）
- 同意证据链路（consent required + consent invalid deny）
- App 策略更新后 token 即时失效
- App mode 违规（domain/scope/worldRelation/manifest）
- App mode 违规 `actionHint` 映射
- `Generate/StreamGenerate` 请求响应 schema
- 流事件 envelope（started/delta/usage/completed/failed）
- AI 错误码映射（provider timeout/unavailable/filter/stream broken）
- AI 路由策略（explicit route + no silent fallback）
- 模型管理 contract（pull/list/remove/health）
- 调用归因 metadata（`callerKind/callerId/surfaceId`）
- `ListUsageStats` 口径一致性（desktop/mod/third-party）
- `GetRuntimeHealth/SubscribeRuntimeHealthEvents` 合同
- DAG 状态机
- GPU 仲裁
- 审计字段完整性
- local-runtime 与 token-api 路由回归

## 12. 待定项（必填）

- FUTURE：Web/Mod 通过 local broker 访问本地模型能力（realm 签名 grant + origin 绑定 + local-only 路由）暂不纳入当前阶段实现。
