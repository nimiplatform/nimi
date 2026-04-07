# Nimi Platform 技术规范

> 本文档由 `scripts/generate-spec-human-doc.mjs` 自动生成，是 `spec/` 目录的人类可读版本。
> 生成时间: 2026-04-07
>
> 权威规则定义位于 spec/ 原始文件中。如需修改，请编辑原始文件后重新生成。

---

## 目录

1. [概述](#1-概述)
2. [认证体系](#2-认证体系)
3. [连接器系统](#3-连接器系统)
4. [AI 推理管道](#4-ai-推理管道)
5. [流式处理](#5-流式处理)
6. [媒体任务系统](#6-媒体任务系统)
7. [安全与审计](#7-安全与审计)
8. [错误处理模型](#8-错误处理模型)
9. [SDK 架构](#9-sdk-架构)
10. [Desktop 架构](#10-desktop-架构)
11. [Future 能力规划](#11-future-能力规划)
12. [附录：参考表](#12-附录参考表)

---

## 1. 概述

Nimi Runtime 是一个 gRPC 守护进程，负责 AI 推理执行、模型管理和身份认证。它运行在用户本地设备上，对外通过 gRPC 提供服务，由 TypeScript SDK 和桌面应用消费。

### 整体架构

```
┌──────────────────────────────────────────────────┐
│                  Desktop / Web App               │
│                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │  Realm   │  │ Runtime  │  │   Mod    │      │
│   │   SDK    │  │   SDK    │  │   SDK    │      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘      │
└────────┼─────────────┼─────────────┼─────────────┘
         │ HTTP/WS     │ gRPC/IPC    │ Host Inject
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────────────────────────┐
   │  Realm   │  │      Nimi Runtime (Go)       │
   │  Server  │  │                              │
   └──────────┘  │  ┌────────┐  ┌────────────┐  │
                 │  │ Auth   │  │ AI Service │  │
                 │  │ Core   │  │            │  │
                 │  └────────┘  └──────┬─────┘  │
                 │                     │        │
                 │           ┌─────────┴──────┐ │
                 │           │                │ │
                 │     ┌─────┴──┐    ┌────────┴┐│
                 │     │nimillm │    │ llama   ││
                 │     │(remote)│    │(local)  ││
                 │     └────────┘    └─────────┘│
                 └──────────────────────────────┘
```

### 当前覆盖范围

本轮规范覆盖 Runtime 的 **AI 执行平面 + 认证核心**，包含五个服务：

**K-RPC-001 — 服务范围**

Runtime kernel 的 RPC 覆盖范围为全量 proto 服务：

**Phase 1（AI 执行平面 + Auth Core）：**

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalService`
- `RuntimeAuthService`
- `RuntimeGrantService`

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeKnowledgeService`（`K-KNOW-*`）
- `RuntimeAppService`（`K-APP-*`）

其中每个服务的完整方法列表如下：

**K-RPC-002 — AIService 方法集合（design 权威）**

`AIService` 方法固定为：

1. `ExecuteScenario`
2. `StreamScenario`
3. `SubmitScenarioJob`
4. `GetScenarioJob`
5. `CancelScenarioJob`
6. `SubscribeScenarioJobEvents`
7. `GetScenarioArtifacts`
8. `ListScenarioProfiles`
9. `GetVoiceAsset`
10. `ListVoiceAssets`
11. `DeleteVoiceAsset`
12. `ListPresetVoices`
13. `UploadArtifact`

说明：

- text/image/video/audio 等多模态输入能力属于现有 scenario 的输入扩展，不新增顶层 `multimodal.generate` RPC
- `TEXT_GENERATE` 的多模态 uplift 继续复用 `ExecuteScenario` / `StreamScenario`
- 大媒体 upload-first ingress 通过 `UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用
- duplex realtime session 不属于 `AIService`，统一走独立 `RuntimeAiRealtimeService`
- app-facing `runtime.route.describe(...)` metadata projection 由 `K-RPC-015` ~ `K-RPC-021` 约束；Phase 1 不得为其新增 daemon 顶层 RPC method

**K-RPC-003 — ConnectorService 方法集合（design 权威）**

`ConnectorService` 方法固定为：

1. `CreateConnector`
2. `GetConnector`
3. `ListConnectors`
4. `UpdateConnector`
5. `DeleteConnector`
6. `TestConnector`
7. `ListConnectorModels`
8. `ListProviderCatalog`
9. `ListModelCatalogProviders`
10. `UpsertModelCatalogProvider`
11. `DeleteModelCatalogProvider`
12. `ListCatalogProviderModels`
13. `GetCatalogModelDetail`
14. `UpsertCatalogModelOverlay`
15. `DeleteCatalogModelOverlay`

ConnectorService 当前与 proto `RuntimeConnectorService` 对齐（见 `tables/rpc-migration-map.yaml` 中 `mapping_status=aligned`）。

**K-RPC-004 — RuntimeLocalService 方法集合**

`RuntimeLocalService` 是本地模型控制面的唯一稳定 RPC 面。local model / artifact 的清单、状态、health、audit、import/install/download、orphan adopt/scaffold 与 transfer/progress 必须全部由该服务持有；desktop 不得再拥有并回写第二套本地模型真源。

`RuntimeLocalService` 方法按四层分级：

**Tier 1 — 核心生命周期：**

1. `ListLocalAssets`
2. `InstallVerifiedAsset`
3. `ImportLocalAsset`
4. `ImportLocalAssetFile`
5. `RemoveLocalAsset`
6. `StartLocalAsset`
7. `StopLocalAsset`
8. `CheckLocalAssetHealth`
9. `WarmLocalAsset`

**Tier 2 — 目录、伴随资产、intake 与 transfer：**

10. `ListVerifiedAssets`
11. `SearchCatalogModels`
12. `ResolveModelInstallPlan`
13. `CollectDeviceProfile`
14. `ScanUnregisteredAssets`
15. `ScaffoldOrphanAsset`
16. `ListLocalTransfers`
17. `PauseLocalTransfer`
18. `ResumeLocalTransfer`
19. `CancelLocalTransfer`
20. `WatchLocalTransfers`

**Tier 3 — 服务/节点/依赖/审计：**

21. `ListLocalServices`
22. `InstallLocalService`
23. `StartLocalService`
24. `StopLocalService`
25. `CheckLocalServiceHealth`
26. `RemoveLocalService`
27. `ListNodeCatalog`
28. `ResolveProfile`
29. `ApplyProfile`
30. `ListLocalAudits`
31. _(reserved for stable RPC numbering)_
32. _(reserved for stable RPC numbering)_
33. `AppendInferenceAudit`
34. `AppendRuntimeAudit`

**Tier 4 — 引擎进程管理（K-LENG-004）：**

35. `ListEngines`
36. `EnsureEngine`
37. `StartEngine`
38. `StopEngine`
39. `GetEngineStatus`

`WarmLocalAsset` 的语义限定为 runtime-owned 的”就绪/预热”路径：允许解析已安装 local model / local service，并在首次真实请求前触发最小执行以加载模型。对于 chat/text，本地模型在 `status in {installed, active}` 时可被选择，runtime 在首次真实 text 请求前负责 warm，不得要求 desktop 先行维持第二套 start/stop 真源。

---

## 2. 认证体系

Nimi Runtime 的认证分为四个层次：**Token 验证**（AuthN）、**访问控制**（AuthZ）、**会话管理**（AuthService）和**授权签发**（GrantService）。这四层严格分工，各有明确的输入输出边界。

### 2.1 Token 验证（AuthN）

当请求携带 `Authorization: Bearer <jwt>` 头时，Runtime 会验证 JWT 的合法性。这是所有安全决策的基础。

验证规则的核心设计是**严格拒绝 + 不降级**：携带了 Authorization 头但 JWT 无效时，Runtime 不会把请求降级为匿名访问，而是直接拒绝。只有完全没有 Authorization 头的请求才被视为匿名。

**K-AUTHN-001 — Bearer token 输入模型**

- gRPC metadata 认证头键固定为 `authorization`（HTTP `Authorization` 在 gRPC 层归一化为该键）。
- `authorization` 仅接受 `Bearer <jwt>` 形式。
- 无 `Authorization` 视为 anonymous，不报错。
- `authorization` 存在但格式非法，必须 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`，不得降级为 anonymous。

**K-AUTHN-002 — 必校验 claims**

Realm JWT 最小必校验集合：

- `iss`
- `aud`
- `sub`
- `exp`
- `iat`

如存在 `nbf`，必须参与时序校验。

**K-AUTHN-003 — 算法与 Header 约束**

- 仅允许配置白名单算法（Phase 1 默认 `RS256`/`ES256`）。
- `alg=none` 必须拒绝。
- `kid` 缺失必须拒绝。

JWKS（JSON Web Key Set）的缓存策略采用乐观缓存 + 按需刷新：正常情况使用缓存的公钥，只在遇到未知 `kid` 时才刷新一次。刷新失败不降级。

**K-AUTHN-004 — JWKS 缓存与刷新**

- JWKS 读取采用缓存优先，缓存 miss 或 `kid` miss 触发单次刷新。
- 刷新失败时不得降级为 anonymous，必须返回 `UNAUTHENTICATED`。
- 必须具备失败回退窗口：可在短 TTL 内继续使用最近一次成功快照（仅用于已命中 `kid`）。
- `auth.jwt.jwksUrl` 是 Runtime 验签公钥的唯一来源；`publicKeyPath` 不属于有效验签链路。
- `auth.jwt.jwksUrl` 默认必须使用 `https`；仅当 host 为 loopback（`localhost` / `127.0.0.0/8` / `::1`）时允许 `http`，用于本地开发与桌面集成。

**K-AUTHN-005 — 时钟偏差**

- `exp`/`nbf` 校验必须应用固定时钟偏差窗口（Phase 1: `±60s`）。
- 超过窗口后 token 视为无效，不允许软容忍。

所有 AuthN 失败统一返回同一个错误码，不泄露具体失败原因（格式错误、签名校验失败、过期等对外表现一致）：

**K-AUTHN-007 — 失败语义统一**

所有 AuthN 失败（格式、验签、claims、会话撤销）统一：

- gRPC code: `UNAUTHENTICATED`
- reason code: `AUTH_TOKEN_INVALID`

> **注脚**：K-AUTHSVC-013 为 ExternalPrincipal 场景定义了细分码 `AUTH_TOKEN_EXPIRED`（proof JWT 过期）和 `AUTH_UNSUPPORTED_PROOF_TYPE`（不支持的 proof_type），作为本规则在 ExternalPrincipal 上下文的例外。通用 AuthN 路径仍统一使用 `AUTH_TOKEN_INVALID`。

AuthN 通过后，向下游投影最小身份上下文，后续的 AuthZ 层只消费这个投影结果，不重复解析 JWT：

**K-AUTHN-008 — 上下文投影**

AuthN 成功后向下游投影最小身份上下文：

- `subject_user_id`（来自 `sub`）
- `issuer`
- `audience`
- `session_id`（若存在）

下游 AuthZ 仅消费投影结果，不重复实现 JWT 解析逻辑。

### 2.2 访问控制（AuthZ）

AuthZ 在 AuthN 通过后执行，负责判断"这个用户能不能访问这个资源"。核心原则是**信息隐藏**：当用户无权访问某个资源时，系统表现为"资源不存在"而非"无权限"，避免泄露资源存在性。

**K-AUTH-001 — 身份模型**

- 有效 Realm JWT：可访问 `LOCAL_MODEL` 与 owner=`sub` 的 `REMOTE_MANAGED`。
- 无 JWT：可访问 `LOCAL_MODEL`、system-owned remote connector，以及 inline 路径；其中 anonymous 创建的 machine-global connector 以 `owner_type=SYSTEM`、`owner_id="machine"` 持久化。
- 携带 `Authorization` 但 JWT 无效：必须 `UNAUTHENTICATED`，不降级匿名。

`JWT` 的有效性判定由 `K-AUTHN-002`（必校验 claims）、`K-AUTHN-003`（算法约束）、`K-AUTHN-004`（JWKS）与 `K-AUTHN-005`（时钟偏差）定义。

**K-AUTH-002 — 信息隐藏**

以下场景统一返回 `NOT_FOUND`：

- remote connector 不存在。
- remote connector owner 不匹配。
- 无 JWT 访问 user-owned remote connector 路径。

对于 Connector 相关操作，AuthZ 定义了固定的管理 RPC 门禁和 AI 推理资源校验顺序：

**K-AUTH-004 — 管理 RPC 身份门禁**

- `Create`：有效 JWT 时创建 user-owned remote connector；JWT 缺失时允许创建 machine-global remote connector。
- `Update/Delete`：user-owned remote connector 仍必须有效 JWT；`owner_id="machine"` 的 machine-global remote connector 允许 anonymous 与 authenticated 调用方管理。
- `Get/List/Test/ListConnectorModels`：JWT 可缺失；缺失时 user-owned remote 语义按信息隐藏处理，system-owned remote connector 继续可见。

**K-AUTH-005 — AI consume 资源校验顺序**

`connector_id` 路径在 JWT 通过后，必须按固定顺序：

1. owner
2. status
3. credential

该顺序不可调整，避免越权侧信道泄露。此评估顺序由 K-KEYSRC-004 的 step 定义强制执行。

AuthN 与 AuthZ 之间有明确的分层边界：AuthN 失败直接返回 `UNAUTHENTICATED`，不进入 AuthZ 评估。

**K-AUTH-007 — AuthN 与 AuthZ 分层**

- AuthN（验签/会话有效性）失败统一返回 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`，不进入 AuthZ 评估。
- AuthZ 规则（owner/status/credential）仅在 AuthN 通过后执行。

### 2.3 会话管理（AuthService）

`RuntimeAuthService` 负责应用注册、会话开启/续签/撤销，以及外部主体（如第三方 OAuth）的会话管理。它**只管理会话生命周期，不做授权决策**。

**K-AUTHSVC-001 — 服务职责**

`RuntimeAuthService` 负责应用会话与外部主体会话生命周期，不承载授权决策（授权由 `RuntimeGrantService` 负责）。

**K-AUTHSVC-002 — 方法集合（权威）**

`RuntimeAuthService` 方法固定为：

1. `RegisterApp`
2. `OpenSession`
3. `RefreshSession`
4. `RevokeSession`
5. `RegisterExternalPrincipal`
6. `OpenExternalPrincipalSession`
7. `RevokeExternalPrincipalSession`

会话 TTL 必须落在服务端配置的合法区间内，超出即拒绝（fail-close）。撤销操作是幂等的，不泄露"会话是否曾存在"的信息。

**K-AUTHSVC-004 — OpenSession / RefreshSession TTL 约束**

- `ttl_seconds` 必须落在服务端配置区间 `[sessionTtlMinSeconds, sessionTtlMaxSeconds]` 内（默认 `[60, 86400]` 秒，可通过 `K-DAEMON-009` 配置）。
- 超出区间必须 fail-close（`INVALID_ARGUMENT`）。
- `RefreshSession` 仅对仍有效的 `session_id` 生效。

**K-AUTHSVC-005 — Revoke 幂等语义**

- `RevokeSession` 与 `RevokeExternalPrincipalSession` 必须幂等。
- 重复撤销返回 `OK`，不得泄露“是否曾存在”细节。

### 2.4 授权签发（GrantService）

`RuntimeGrantService` 负责授权签发、访问校验和委托链管理。可以理解为"谁有权做什么"的决策中心。

**K-GRANT-001 — 服务职责**

`RuntimeGrantService` 负责授权签发、访问校验、委托链管理。其输入依赖 `RuntimeAuthService` 会话与外部主体身份。

**K-GRANT-002 — 方法集合（权威）**

`RuntimeGrantService` 方法固定为：

1. `AuthorizeExternalPrincipal`
2. `ValidateAppAccessToken`
3. `RevokeAppAccessToken`
4. `IssueDelegatedAccessToken`
5. `ListTokenChain`

授权支持委托链（delegation chain）：一个 token 可以签发子 token，但子 token 的权限必须是父 token 权限的子集，且有深度限制。

**K-GRANT-005 — Delegation 约束**

- `IssueDelegatedAccessToken` 只能在父 token 允许委托时成功。
- 子 token 的 scope/resource selector 必须是父 token 能力的子集。
- `max_delegation_depth` 超限必须拒绝。默认值为 `3`（可通过 `K-DAEMON-009` 的 `maxDelegationDepth` 配置覆盖）。

**K-GRANT-006 — Revoke 与链路可见性**

- `RevokeAppAccessToken` 必须幂等。
- `ListTokenChain` 必须可观测父子链路，不得返回环。

---

## 3. 连接器系统

Connector（连接器）是 Nimi Runtime 中最核心的抽象之一。它代表一个"AI 推理目标描述符"——告诉系统要去哪里执行 AI 推理。

### 3.1 为什么需要连接器？

用户可能使用多种 AI 服务：本地运行的开源模型（如 Qwen、LLaMA）、远程 API（如 OpenAI、Gemini、DeepSeek）。连接器统一了这些不同来源的管理方式：每个推理目标都是一个 Connector，有统一的 CRUD 接口和身份校验流程。

连接器本身是**薄描述**——它只记录"去哪里"和"用什么凭据"，不承载用户路由策略。

### 3.2 两种连接器

连接器分为两种：

- **LOCAL_MODEL**：本地模型，由系统预设。固定 6 个（对应 6 种能力类别），不能通过 CRUD 新建或删除
- **REMOTE_MANAGED**：远程托管，由用户创建。用户提供 API Key 和 endpoint，Runtime 托管凭据

```protobuf
message Connector {
  string connector_id = 1;                // ULID
  ConnectorKind kind = 2;                 // LOCAL_MODEL | REMOTE_MANAGED
  ConnectorOwnerType owner_type = 3;      // SYSTEM | REALM_USER
  string owner_id = 4;                    // SYSTEM 常量或 JWT sub
  string provider = 5;                    // local | gemini | openai | ...
  string endpoint = 6;                    // local 固定空串；remote 非空
  string label = 7;
  ConnectorStatus status = 8;             // ACTIVE | DISABLED
  bool has_credential = 11;              // 展示用，非门禁
  LocalConnectorCategory local_category = 12;
}
```

关键约束：
- `provider/kind/owner_type/owner_id` 创建后不可变
- Runtime 是 API Key **托管者**，不是分发者——凭据不出 runtime 进程

**K-AUTH-003 — Connector owner 固定映射**

- authenticated `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_REALM_USER`
- anonymous machine-global `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_SYSTEM` 且 `owner_id="machine"`
- `LOCAL_MODEL -> CONNECTOR_OWNER_TYPE_SYSTEM`

### 3.3 本地模型类别

本地连接器对应 6 种固定的能力类别，每种类别映射到不同的 AI 能力：

**K-LOCAL-001 — 固定 category（Phase 1）**

`LocalConnectorCategory` 固定 6 个：

1. `LLM`
2. `VISION`
3. `IMAGE`
4. `TTS`
5. `STT`
6. `CUSTOM`

**K-LOCAL-002 — capability 映射（Phase 1）**

- `LLM` 承载 `CHAT` 与 `EMBEDDING`。
- `VISION` 表示“可接受视觉输入”的能力标记，不是独立执行模态。
- `IMAGE/TTS/STT` 与同名执行模态映射。
- `CUSTOM` 的 capability 来自模型元数据声明。

local category / local manifest token 到 canonical capability token 的正式映射以 `tables/capability-vocabulary-mapping.yaml` 为唯一事实源；本规则只定义语义边界，不复制第二套映射表。

其中 CUSTOM 类型的模型需要提供 `local_invoke_profile_id`，缺失则标记为不可用：

**K-LOCAL-003 — CUSTOM 可用性门槛**

`local_invoke_profile_id` 是 `LocalAssetRecord` 的可选 string 字段，由 `InstallLocalAsset` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

### 3.4 连接器 CRUD 操作

**创建**：只能创建 REMOTE_MANAGED 连接器，必须提供 API Key。endpoint 为空时使用 provider 默认值。

**K-RPC-007 — CreateConnector 字段契约**

`CreateConnector` 必须满足：

- 请求体不暴露 `kind`；`CreateConnector` 成功创建的结果 `Connector.kind` 固定为 `REMOTE_MANAGED`
- `api_key` 必填且非空
- `endpoint` 为空时按 provider 默认值注入
- `label` 为空时使用默认 label
- 成功写入时 `status=ACTIVE`，`created_at=updated_at=now`

**更新**：至少修改一个可变字段。凭据或 endpoint 变化时自动失效远程模型缓存。

**K-RPC-008 — UpdateConnector 字段契约**

`UpdateConnector` 必须满足：

- 至少一个可变字段（`endpoint/label/api_key/status`）
- `status=UNSPECIFIED` 非法
- `api_key` 与 `label` 显式空串非法
- 合法请求一律刷新 `updated_at`

**删除**：采用三步补偿流程（标记 pending → 删凭据 → 删记录），支持幂等重试。删除不影响已提交的 ScenarioJob。

**K-RPC-009 — DeleteConnector 补偿契约**

`DeleteConnector` 必须满足：

- 级联删除 credential
- 执行 `DELETE_PENDING` 补偿流程（可重试、可启动恢复）

### 3.5 存储与可靠性

连接器数据存储在本地文件系统：

- 注册表：`~/.nimi/runtime/connector-registry.json`
- 凭据：`~/.nimi/runtime/credentials/<connector_id>.key`
- 权限：均为 `0600`

所有写入使用原子操作（写临时文件 → fsync → rename → fsync 父目录），全局写串行化保证一致性。

Runtime 启动时执行重扫补偿：回填 `has_credential`、清理孤儿凭据、恢复 `delete_pending` 残留。

---

## 4. AI 推理管道

当一个 AI 推理请求到达 Runtime，它会经历一条固定的处理管道。这个管道的设计原则是**评估顺序不可调整**——每个检查步骤的顺序都是固定的，避免越权侧信道泄露。

### 4.1 凭据路由：两条路径

请求可以通过两种方式指定凭据来源，二选一，不能混用：

1. **Managed 路径**：提供 `connector_id`，使用 Runtime 托管的连接器凭据
2. **Inline 路径**：通过 metadata 直接提供 provider type/endpoint/API key（临时使用，不持久化）

**K-KEYSRC-001 — 路径模型**

AI consume 的显式 key-source 只允许二选一路径：

- `connector_id` 路径（managed remote）— **推荐路径**，凭据由 Runtime ConnectorService 托管（K-CONN-001: custodian not distributor）
- inline 路径（`x-nimi-key-source=inline` + inline metadata）— **escape hatch**，凭据通过 gRPC metadata 直传

local connector 不属于 AI consume 的执行入口；Phase 1 中它仅作为本地 category 的目录 / probe facade（见 `K-LOCAL-004`）。

`tables/provider-capabilities.yaml` 中的 `runtime_plane: local | remote` 保持其 provider capability 语义，不等同于本文件的路由策略 `LOCAL | CLOUD`。

若 `connector_id` 与 inline metadata 都未提供，请求不进入 managed / inline 路径，继续按 runtime config 或 anonymous local 默认路由评估。

**Inline 路径定位声明（K-KEYSRC-001）**：inline 路径是为以下场景设计的 escape hatch，非推荐的常规使用路径：
- 开发调试：开发者临时使用自有 API key 测试，无需预配置 connector
- 外部 Agent 直连：第三方 agent 通过 SDK 直连 Runtime，不经过 Desktop connector 管理 UI
- 临时/一次性调用：无需持久化凭据的场景

Desktop 端（D-SEC-009）始终使用 managed connector 路径，renderer 不接触原始 API key。inline 路径的凭据安全由调用方负责（Runtime 仅在 K-AUDIT-005/K-AUDIT-017 层面对审计记录执行脱敏，不对 inline 凭据做额外安全保护）。

**K-KEYSRC-002 — 互斥规则**

`connector_id` 与任一 inline 凭据字段同时出现，必须拒绝（`AI_REQUEST_CREDENTIAL_CONFLICT`）。

### 4.2 请求评估顺序

请求按以下固定顺序逐步评估，任何一步失败立即返回错误：

**K-KEYSRC-004 — 评估顺序（AI consume）**

请求按固定顺序评估：

1. 解析 body + metadata（空 `connector_id` 归一化为未提供）
2. JWT 校验（若携带）
3. `app_id` 非空校验
4. key-source 与互斥校验
5. connector 加载
6. owner/status/credential 校验（credential 由 ConnectorService 在本步骤解密并注入执行上下文；下游执行模块如 nimiLLM 通过执行上下文获取凭据，不直接访问存储）。"执行上下文" 为请求作用域的参数结构（如 `nimillm.RemoteTarget`），承载 `provider_type`/`endpoint`/`credential` 三元组。接口定义由实现层决定，spec 仅约束：下游模块不直接访问 CredentialStore
7. remote endpoint 安全校验
8. inline endpoint 安全校验
9. `model_id` 校验链路
10. 路由执行 + 审计

这个顺序的设计意图是：先做认证（步骤 2-3），再做授权（步骤 5-6），最后做安全校验（步骤 7-8）和路由（步骤 9-10）。每一步只在前置条件满足后才执行。

### 4.3 远程执行（nimillm 模块）

nimillm 是 Runtime 内部的远程执行模块，处理所有需要调用外部 AI API 的请求。它的职责边界非常清晰：

- 只负责**执行**（发送请求到 provider 并返回结果）
- 不负责认证、凭据持久化、连接器 CRUD
- 入口互斥校验由上游完成，nimillm 不重建第二套入口规则

Provider 适配分两层：先按 `provider_type` 选择 backend family，同 family 内允许 channel 分流，但**禁止跨 provider 自动 fallback**。

### 4.4 本地执行（local-model 子系统）

本地执行采用三层抽象：

**K-LOCAL-007 — 资产三层抽象**

本地资产系统采用三层抽象：

- **Asset**（`LocalAssetRecord`）：用户与 App/Mod 可见的统一资产抽象。每条记录携带 `local_asset_id`（ULID）、`kind`（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`）、`logical_model_id`、`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements` 。passive asset（如 `vae`、`clip`、`lora`、`controlnet`）不需要独立 Service 或 Node；其 workflow 槽位由 profile entry 的 `engineSlot` 声明，不属于 asset record 自身。
- **Service**（`LocalServiceDescriptor`）：某个 runnable asset 当前绑定的执行实例。一个 Service 代表一个可访问 endpoint，可以是 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。仅 runnable asset（chat/image/video/tts/stt）需要 Service 绑定。
- **Node**（`LocalNodeDescriptor`）：能力投影视图。从 Service × capabilities 生成，携带 adapter/engine/policy_gate 等运行时路由信息。Node 是能力发现入口，不是规范真相源。passive asset 不参与 Node 生成。

Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service）：

**K-LOCAL-008 — Phase 1 绑定约束**

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。
- Step A（request-routed single-worker switch）在当前约束下是合法的：
  - 请求必须显式绑定目标 model / local asset
  - 同一 runtime state root 下，supervised llama 可在一次请求前把唯一 resident worker 切换到目标 Model
  - 该切换不放宽 `Model:Service = 1:1`；它只改变当前 resident worker 绑定到哪一个 Model
- Step B（bounded multi-worker residency）当前不在本规则许可范围内：
  - 若同一 runtime state root 允许多个 supervised llama worker 并存，必须先完成新的 spec cutover，明确 Service 拓扑、Engine truth、residency budget 与 eviction 语义
  - 在完成 cutover 前，runtime 不得把“多 worker 并驻”当作默认合法能力启用

#### 4.4.1 本地引擎

Phase 1 支持两种 OpenAI-compatible 引擎：

**K-LENG-001 — 引擎类型枚举**

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `speech`：本地语音引擎族，负责 `audio.transcribe`、`audio.synthesize`、`voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`media.diffusers` 仅允许作为 `media` 的 runtime 内部 fallback driver；不是 public engine target。若要把 `media.diffusers` 升格为 matrix-supported canonical backend family，必须在同一轮 cutover 中同步修订 `K-LENG-004`、`K-MMPROV-010`、`K-PROV-002` 的对应规则。
`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

`engine=media` 可承载多个 `backend_class`：

- `native_binary`：原生二进制受管 backend（当前：`stablediffusion-ggml`）
- `python_pipeline`：受管 Python pipeline backend（候选：`diffusers`）

`backend_class` 与 public `engine` 正交；`backend_class` 不是 public engine target，也不是 provider alias。

**K-LENG-002 — 运行模式**

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`
- `SUPERVISED`

`sidecar` 当前只允许 `ATTACHED_ENDPOINT`；`llama`、`media` 与 `speech` 允许 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。

所有引擎通过标准 OpenAI-compatible HTTP API 通信：

**K-LENG-006 — Local 协议基线**

`llama` 使用 canonical text/understanding API：

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

`media` 与 `media.diffusers` 使用 runtime 私有 canonical media HTTP API：

- `GET /healthz`
- `GET /v1/catalog`
- `POST /v1/media/image/generate`
- `POST /v1/media/video/generate`

补充：

- 对 runtime-owned managed image backend supervised 路径，`local-media` 是唯一 app-facing execution endpoint；runtime / sdk / desktop 不得直接把该路径投射成 `llama` provider HTTP consume surface。
- runtime 允许在 `local-media` 内部执行 dynamic managed-image profile materialization；若需要额外内部导入步骤，必须保持为 runtime 私有实现，不得改变 app-facing canonical media consume path。

`speech` 使用 runtime 私有 canonical speech HTTP API：

- `GET /healthz`
- `GET /v1/catalog`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `POST /v1/voice/clone`
- `POST /v1/voice/design`

`sidecar` 使用 Nimi music canonical HTTP API：

- `POST /v1/music/generate`

协议约束：

- `media` / `media.diffusers` 不得再通过 OpenAI-compatible provider 语义暴露给上层。
- `speech` 不得把 voice workflow 伪装为 OpenAI-compatible TTS 成功语义。
- `llama` 只承载文本与理解能力；`media` / `media.diffusers` 只承载图像/视频生成能力；`speech` 只承载语音与 voice workflow 能力。
- 用户层不得直接暴露 workflow、companion model 拼装或 pipeline DAG。

健康探测使用 `GET /v1/models` 判定引擎可达性：

**K-LENG-007 — 健康探测协议**

`llama` 健康探测：

- `GET /v1/models` 成功仅说明进程可达。
- 对 `text.generate` / `text.embed` 至少还需一次最小执行或等价 warmup 成功，才能视为 ready。
- supervised `llama` 在首次最小执行 / warmup 失败时，必须保留失败阶段、退出码或 stderr 摘要等结构化细节；不得仅因 `/v1/models` 可达就把模型提升为 ready。
- 对 supervised `llama`，`/v1/models` 缺失目标模型只说明“当前 resident worker 未加载该模型”；对非当前 resident 的已验证模型，不得仅据此投影为 `UNHEALTHY`。
- 对 `image.understand` / `audio.understand` 还必须验证 companion artifact（如 `mmproj`）完整。

`media` / `media.diffusers` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 存在至少一个与目标 `logical_model_id` 可比对的 ready entry，才算健康。
- catalog 不得暴露静态伪 model list。
- `media.diffusers` 作为 fallback 时，必须在探测结果中暴露 fallback 原因，不得静默替换。
- `engine=media` 的 image 资产若 backend/profile 解析到 `stablediffusion-ggml` 或其它实际受管 native-binary image backend，则 health 归因、bootstrap 目标与 host support 判断必须跟随实际受管 backend；不得因为 public engine 仍是 `media` 就错误要求 attached endpoint。
- 若 host 不满足 daemon-managed image backend 的硬件前提，health / registration detail 必须直接暴露 canonical matrix compatibility 原因，不得仅返回 `managed diffusers backend unavailable` 或其它泛化 backend 缺失错误。

`speech` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 暴露目标 `logical_model_id` 的 ready entry，才算健康。
- `audio.transcribe` 必须至少验证 STT driver 与主 artifact 完整。
- `audio.synthesize` 必须至少验证 TTS driver 与主 artifact 完整。
- `voice_workflow.tts_v2v` / `voice_workflow.tts_t2v` 必须验证 workflow driver 可用；缺失 `qwen3tts` 等必要 bundle 时必须 fail-close。

`sidecar` 当前不进入标准 supervised 健康探测，attached endpoint 的可用性由实际 music 请求 fail-close。

`llama` daemon-managed image backend 名称当前固定只允许：

- `llama-cpp`
- `whisper-ggml`
- `stablediffusion-ggml`

runtime 不得把任意 backend 名称直接透传给受管 `llama` 引擎 CLI。

引擎配置优先级（高覆盖低）：RPC 请求参数 > 环境变量 > 配置文件 > 引擎默认值：

**K-LENG-008 — 配置来源优先级**

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数
2. 环境变量
3. 配置文件
4. 引擎默认值

配置结构必须围绕 `llama` / `media` / `speech` / `sidecar` 组织，不得继续保留 `localai` / `nexa` / `nimi_media` 为 public 配置入口。

#### 4.4.2 设备画像

安装本地模型前，系统可以采集设备画像来评估硬件兼容性：

**K-DEV-001 — 设备画像结构**

设备画像（`LocalDeviceProfile`）包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `os` | string | 操作系统标识（`linux`/`darwin`/`windows`） |
| `arch` | string | CPU 架构（`amd64`/`arm64`） |
| `total_ram_bytes` | int64 | 主机总内存（字节） |
| `available_ram_bytes` | int64 | 主机当前可用内存（字节） |
| `gpu` | `LocalGpuProfile` | GPU 信息（available/vendor/model/VRAM/memory_model） |
| `python` | `LocalPythonProfile` | Python 运行时（available/version） |
| `npu` | `LocalNpuProfile` | NPU 信息（available/ready/vendor/runtime/detail） |
| `disk_free_bytes` | int64 | 可用磁盘空间（字节） |
| `ports` | `[]LocalPortAvailability` | 端口可用性列表 |

`CollectDeviceProfile` RPC 返回当前设备的完整画像快照。

`LocalGpuProfile` 追加以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `total_vram_bytes` | int64? | GPU 总显存（字节）；无法可靠探测时为空 |
| `available_vram_bytes` | int64? | GPU 当前可用显存（字节）；无法可靠探测时为空 |
| `memory_model` | enum | `discrete | unified | unknown` |

**K-DEV-002 — GPU 检测策略**

GPU 检测按以下优先级执行（首个成功即返回）：

1. NVIDIA 命令行探测：`nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits` 成功
   - `available=true`
   - `vendor=nvidia`
   - `memory_model=discrete`
   - `model/total_vram_bytes/available_vram_bytes` 按返回值填充
2. Apple Silicon / unified memory 主机：
   - `vendor=apple`
   - `model` 必须尽量填充 Apple 芯片型号（如 `Apple M4 Max`），当前允许通过 `sysctl machdep.cpu.brand_string` 或等价 OS probe 获取
   - `memory_model=unified`
   - `total_vram_bytes/available_vram_bytes` 允许复用 host RAM 指标
3. 以上均未命中：
   - `available=false`
   - `memory_model=unknown`
   - `total_vram_bytes/available_vram_bytes` 为空

**K-DEV-007 — 硬件-引擎兼容性判定**

安装计划解析（`ResolveModelInstallPlan`）根据以下规则生成 warnings：

| 引擎名特征 | 硬件要求 | 不满足时 warning |
|---|---|---|
| 包含 `cuda`/`nvidia`/`gpu` | `gpu.available=true` | `WARN_GPU_REQUIRED` |
| 包含 `python`/`py` | `python.available=true` | `WARN_PYTHON_REQUIRED` |
| 包含 `npu` | `npu.available=true && npu.ready=true` | `WARN_NPU_REQUIRED` |

warning 不阻止安装，仅在 `InstallPlanDescriptor.warnings` 中输出。

#### 4.4.3 模型获取

本地模型有三种获取方式：

- **Verified 安装**：从进程内硬编码的可信模型列表安装（`InstallVerifiedModel`）
- **手动安装**：用户提供完整元数据直接安装（`InstallLocalModel`）
- **Manifest 导入**：从本地文件系统读取模型清单导入（`ImportLocalModel`）

安装前可执行预检（`ResolveModelInstallPlan`），生成硬件兼容性 warnings：

**K-LOCAL-012 — 安装计划解析**

`ResolveModelInstallPlan` 在安装前执行预检：

1. 采集设备画像（`K-DEV-001`）。
2. 按 `K-DEV-007` 执行硬件-引擎兼容性检查，生成 warnings。
3. 判定 `install_available`：
   - `engine_runtime_mode=ATTACHED_ENDPOINT` 且 endpoint 显式提供且合法 → `true`。
   - `engine_runtime_mode=SUPERVISED` 且引擎二进制可达 → `true`。
   - 否则 → `false`，`reason_code` 说明原因。
4. 填充 `LocalProviderHints`（引擎特定适配信息）。
5. 返回 `LocalInstallPlanDescriptor`（含 warnings 和 reason_code）。

#### 4.4.4 依赖解析

Mod 可以声明对本地模型的依赖，分为四类：

**K-LOCAL-013 — 依赖解析模型**

`LocalExecutionDeclarationDescriptor` 定义四类执行条目声明：

| 类型 | 语义 | 缺失行为 |
|---|---|---|
| `required` | 必须满足 | 解析失败，reason_code 报错 |
| `optional` | 可选增强 | 跳过，生成 warning |
| `alternatives` | 互选组（多选一） | 按 `preferred_entry_id` 优先选择；全部不可用则失败 |
| `preferred` | 全局偏好映射（`capability → entry_id`） | 仅影响 alternatives 中的选择优先级 |

解析过程：

1. 遍历 `required` → 全部必须可满足。
2. 遍历 `optional` → 尽力满足。
3. 遍历 `alternatives` → 按 preferred > 声明顺序选择。
4. 输出 `LocalExecutionPlan`，含 `selection_rationale` 与 `preflight_decisions`。

依赖解析后通过四阶段 Apply 管道部署：

**K-LOCAL-014 — Apply 管道四阶段**

`ApplyProfile` 执行 profile 解析结果中的 `LocalExecutionPlan`，分四阶段：

| 阶段 | 名称 | 动作 |
|---|---|---|
| 1 | `preflight` | 设备画像重新采集，校验硬件兼容性与端口可用性 |
| 2 | `install` | 执行 `InstallVerifiedAsset` / `ImportLocalAsset` / `InstallLocalService`，持久化状态 |
| 3 | `bootstrap` | 执行 `StartLocalService`（ATTACHED_ENDPOINT 模式为连接验证） |
| 4 | `health` | 执行健康探测（`K-LENG-007`），确认服务可用 |

每个阶段产出 `LocalExecutionStageResult{stage, ok, reason_code, detail}`。

**K-LOCAL-015 — Apply 失败回滚**

Apply 管道任一阶段失败时：

- 逆序清理已完成阶段的副作用（已安装的 model/service 执行 remove）。
- 结果 `rollback_applied=true`。
- 回滚本身失败时，结果同时携带原始失败和回滚失败的 reason_code，不做二次回滚。
- 回滚不触发删除外部资产（如已下载的模型文件），仅清理 runtime 内部注册状态。

> **Phase 1 注释**：ATTACHED_ENDPOINT 模式下，stage 3（bootstrap）仅验证 endpoint 连接可达，stage 4（health）必须遵循 `K-LENG-007` 的 engine-specific 探测协议。对 `media`，固定为 `GET /healthz` + `GET /v1/catalog`；对 `speech`，固定为 `GET /healthz` + `GET /v1/catalog`。回滚的实际影响范围为 stage 2 的注册清理（`InstallVerifiedAsset`/`ImportLocalAsset`/`InstallLocalService` 产生的状态记录）。

#### 4.4.5 适配器路由与策略门控

本地 Node 的 adapter 按 provider × capability 矩阵路由：

**K-LOCAL-017 — 适配器路由规则**

Node 的 `adapter` 字段按以下规则确定（以 `tables/local-adapter-routing.yaml` 为事实源）：

| Engine | Capability | Adapter |
|---|---|---|
| `llama` | `chat` / `text.generate` | `llama_native_adapter` |
| `llama` | `embedding` / `embed` / `text.embed` | `llama_native_adapter` |
| `llama` | `image.understand` / `audio.understand` | `llama_native_adapter` |
| `media` | `image.generate` / `image.edit` | `media_native_adapter` |
| `media` | `video.generate` / `i2v` | `media_native_adapter` |
| `speech` | `audio.transcribe` | `speech_native_adapter` |
| `speech` | `audio.synthesize` | `speech_native_adapter` |
| `speech` | `voice_workflow.tts_v2v` | `speech_native_adapter` |
| `speech` | `voice_workflow.tts_t2v` | `speech_native_adapter` |
| `sidecar` | `music` / `music.generate` | `sidecar_music_adapter` |
| `*`（任意） | `*`（任意） | `openai_compat_adapter` |

匹配顺序：精确匹配优先于通配符。

策略门控可条件性禁止特定组合（如当前引擎不支持目标 capability）：

**K-LOCAL-018 — 策略门控（Policy Gate）**

策略门控用于条件性禁止特定 provider × capability 组合：

- `LocalNodeDescriptor.policy_gate` 字段描述门控规则标识（如 `media.video.unsupported`）。
- 门控触发时：Node 的 `available=false`，`reason_code` 说明原因。
- 对 host 已知但 capability 不受支持的 provider × capability 组合，runtime 必须设置 `<provider>.<capability>.unsupported` 风格的 policy gate，并且不得继续暴露 native adapter。
- 门控信息通过 `LocalProviderHints` 透传给审计与调用方。
- 类型映射：`LocalProviderHints.media.policy_gate` 可承载门控规则标识符；`LocalProviderHints.media` 承载 `family/driver/device` 等执行提示；`AppendInferenceAuditRequest.policy_gate` 为 `google.protobuf.Struct`（结构化门控上下文，含 gate/reason/detail）。两者表达不同粒度，不要求类型对齐。

#### 4.4.6 流式降级

当本地 provider 不支持流式生成时，系统可以降级为非流式生成并分片模拟推送，但必须在审计和终帧 metadata 中标记 `stream_simulated=true`：

**K-LENG-011 — 流式降级检测**

当 `stream=true` 请求返回以下信号时，视为引擎不支持流式：

- HTTP 404/405/501
- 响应 Content-Type 非 `text/event-stream`
- 响应体特征匹配：包含 `"error"` 且状态码指示不支持

降级处理：

- 回退为非流式请求（`stream=false`）。
- 将完整响应按 24 字符分片（最后一片可短于 24 字符），模拟流式推送。
- 终帧 metadata 必须标识 `stream_simulated=true`。
- 审计必须标记 `stream_fallback_simulated`。
- 分片模拟的事件语义仍需满足 `K-STREAM-002` 与 `K-STREAM-003`。

#### 4.4.7 model_id 前缀路由

AI 执行路径根据 model_id 前缀确定引擎：

**K-LOCAL-020 — model_id 前缀路由**

当 AI 执行路径接收到 local model 请求时，按 `model_id` 前缀确定引擎：

| 前缀 | 引擎选择 |
|---|---|
| `llama/` | 仅匹配 `llama` 引擎的已安装模型 |
| `media/` | 仅匹配 `media` 引擎的已安装模型 |
| `speech/` | 仅匹配 `speech` 引擎的已安装模型 |
| `sidecar/` | 仅匹配 `sidecar` 引擎的已安装模型 |
| `local/` | 按 host + capability 做 engine-first 路由：`text.generate/text.embed/image.understand/audio.understand -> llama`，`image.generate/image.edit/video.generate/i2v -> media`，`audio.transcribe/audio.synthesize/voice_workflow.tts_v2v/voice_workflow.tts_t2v -> speech`，仅当 `media` 不支持当前 family 或 artifact completeness 不满足时，才允许 runtime 内部回退到 `media.diffusers` |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`llama/qwen2.5-7b-instruct` 匹配 `model_id=qwen2.5-7b-instruct` 且 `engine=llama`；`media/flux.1-schnell` 匹配 `model_id=flux.1-schnell` 且 `engine=media`；`sidecar/musicgen` 匹配 `model_id=musicgen` 且 `engine=sidecar`）。

对 canonical local image product path，`local/*` 到 `media` 的 image 路由必须继续服从 `K-LENG-004` / `K-LENG-012` 的统一 matrix resolver 语义：

- 单文件 `*.gguf` 主模型 -> `gguf_image`
- 单文件 `*.safetensors` 主模型且不满足 workflow bundle 判据 -> `safetensors_native_image`
- `model_index.json` 或等价 workflow bundle completeness 命中 -> `workflow_safetensors_image`
- `artifact_roles` 只描述 bundle 内部角色，不得因为“任意非空”就把单文件 safetensors 升级成 workflow topology
- 命中 `safetensors_native_image` 或 `workflow_safetensors_image` 但 `product_state != supported` 时，runtime 必须保持 `SUPERVISED` 契约并以 `AI_LOCAL_MODEL_UNAVAILABLE + compatibility detail` fail-close，不得改投 `ATTACHED_ENDPOINT`

fallback 补充：

- `local/*` 默认路由不得跨 family 静默换模型；fallback 只允许在同一 logical model 的声明引擎集合内发生。
- 若 `media` 与其内部 `media.diffusers` fallback 都不可执行，runtime 必须 fail-close，不得伪装 ready 或静默退回 cloud/provider alias。

未知前缀（如 `ollama/`）视为无前缀，按 `model_id` 全文精确匹配（不剥除前缀）。

#### 4.4.8 Node 目录生成

Node 是 Service × capability 笛卡尔积的计算视图，每次查询实时生成：

**K-LOCAL-019 — Node 目录生成规则**

`ListNodeCatalog` 从已安装且活跃的 Service 实时生成 Node 列表：

1. 遍历所有 `status=ACTIVE` 的 Service。
2. 对每个 Service 的 `capabilities` 做笛卡尔积：每个 capability 生成一个 Node。
3. 每个 Node 填充：
   - `node_id`：`<service_id>:<capability>` 格式。
   - `provider`：仅作为兼容字段存在时，必须从 engine 投影；engine 才是本地执行真相源。
   - `adapter`：按 `K-LOCAL-017` 路由。
   - `available`：健康且未被策略门控（`K-LOCAL-018`）。
   - `llama` node 必须同时满足 bundle 可解析、主 artifact 完整、以及对应能力 probe 成功。
   - `media` node 必须通过 canonical media catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。若 runtime 内部回退到 `media.diffusers`，必须在 `provider_hints.media` 中暴露 fallback driver 与原因。
   - `speech` node 必须通过 canonical speech catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。
   - `media` node 的 `provider_hints.extra` 必须暴露 runtime host 支持面（如 `runtime_support_class=supported_supervised|attached_only|unsupported`），供目录层解释为何当前 host 只能 attached；该判定必须基于实际受管 backend，而不是仅按 public engine=`media` 粗暴复用统一 host classification。对于 `image.generate` / `image.edit` 且 backend/profile 解析到 `stablediffusion-ggml` 或其它实际受管 native-binary image backend 的资产，host support 必须跟随对应 managed image supervised 支持面。
   - `provider_hints.extra.local_default_rank` 必须暴露当前 host + capability 下的默认 local engine 排序，供 Desktop/SDK 与 runtime 对齐默认路由。
   - `provider_hints`：引擎特定适配信息。
4. 支持按 `capability`/`service_id`/`provider` 过滤。

#### 4.4.9 搜索结果排序

目录搜索结果的排序规则：

**K-LOCAL-021 — SearchCatalogModels 结果排序**

`SearchCatalogModels` 结果固定排序：

1. `verified=true` 在前，`verified=false` 在后。
2. 同组内按 `title ASC`（大小写不敏感）。

recommendation 可以作为结果元数据附带返回，但不得改写该排序规则。

### 4.5 Provider 白名单

每个 provider 有固定的默认 endpoint、是否支持 managed/inline 两种路径、对应的执行模块，以及聚合后的 canonical capability 列表。这些信息由以下两个 YAML 表定义：

| Provider | 默认 Endpoint | 需显式 Endpoint |
|---|---|---|
| anthropic | https://api.anthropic.com | 否 |
| aws_polly | — | 是 |
| azure | — | 是 |
| azure_speech | — | 是 |
| bedrock | — | 是 |
| cohere | — | 是 |
| dashscope | https://dashscope.aliyuncs.com/compatible-mode/v1 | 否 |
| deepseek | https://api.deepseek.com/v1 | 否 |
| elevenlabs | https://api.elevenlabs.io | 否 |
| fireworks | — | 是 |
| fish_audio | https://api.fish.audio | 否 |
| flux | — | 是 |
| gemini | https://generativelanguage.googleapis.com/v1beta/openai | 否 |
| glm | https://open.bigmodel.cn/api/paas/v4 | 否 |
| google_cloud_tts | — | 是 |
| google_veo | — | 是 |
| groq | https://api.groq.com/openai/v1 | 否 |
| hunyuan | https://api.hunyuan.cloud.tencent.com/v1 | 否 |
| ideogram | — | 是 |
| kimi | https://api.moonshot.cn/v1 | 否 |
| kling | — | 是 |
| loudly | https://soundtracks.loudly.com | 否 |
| luma | — | 是 |
| minimax | https://api.minimax.chat/v1 | 否 |
| mistral | https://api.mistral.ai/v1 | 否 |
| mubert | https://music-api.mubert.com/api/v3 | 否 |
| nimillm | — | 是 |
| openai | https://api.openai.com/v1 | 否 |
| openai_compatible | — | 是 |
| openrouter | https://openrouter.ai/api/v1 | 否 |
| perplexity | — | 是 |
| pika | — | 是 |
| qianfan | https://qianfan.baidubce.com/v2 | 否 |
| runway | — | 是 |
| siliconflow | — | 是 |
| soundverse | https://api.soundverse.ai | 否 |
| spark | https://spark-api-open.xf-yun.com/v1 | 否 |
| stability | https://api.stability.ai | 否 |
| stepfun | https://api.stepfun.ai/v1 | 否 |
| suno | https://apibox.erweima.ai | 否 |
| together | — | 是 |
| volcengine | https://ark.cn-beijing.volces.com/api/v3 | 否 |
| volcengine_openspeech | https://openspeech.bytedance.com/api/v1 | 否 |
| xai | https://api.x.ai/v1 | 否 |

| Provider | 执行模块 | Managed | Inline | Endpoint 要求 |
|---|---|---|---|---|
| anthropic | nimillm | 是 | 是 | default_or_explicit |
| aws_polly | nimillm | 是 | 是 | explicit_required |
| azure | nimillm | 是 | 是 | explicit_required |
| azure_speech | nimillm | 是 | 是 | explicit_required |
| bedrock | nimillm | 是 | 是 | explicit_required |
| cohere | nimillm | 是 | 是 | explicit_required |
| dashscope | nimillm | 是 | 是 | default_or_explicit |
| deepseek | nimillm | 是 | 是 | default_or_explicit |
| elevenlabs | nimillm | 是 | 是 | default_or_explicit |
| fireworks | nimillm | 是 | 是 | explicit_required |
| fish_audio | nimillm | 是 | 是 | default_or_explicit |
| flux | nimillm | 是 | 是 | explicit_required |
| gemini | nimillm | 是 | 是 | default_or_explicit |
| glm | nimillm | 是 | 是 | default_or_explicit |
| google_cloud_tts | nimillm | 是 | 是 | explicit_required |
| google_veo | nimillm | 是 | 是 | explicit_required |
| groq | nimillm | 是 | 是 | default_or_explicit |
| hunyuan | nimillm | 是 | 是 | default_or_explicit |
| ideogram | nimillm | 是 | 是 | explicit_required |
| kimi | nimillm | 是 | 是 | default_or_explicit |
| kling | nimillm | 是 | 是 | explicit_required |
| local | local-model | 是 | 否 | empty_string_only |
| loudly | nimillm | 是 | 是 | default_or_explicit |
| luma | nimillm | 是 | 是 | explicit_required |
| minimax | nimillm | 是 | 是 | default_or_explicit |
| mistral | nimillm | 是 | 是 | default_or_explicit |
| mubert | nimillm | 是 | 是 | default_or_explicit |
| nimillm | nimillm | 是 | 是 | explicit_required |
| openai | nimillm | 是 | 是 | default_or_explicit |
| openai_compatible | nimillm | 是 | 是 | explicit_required |
| openrouter | nimillm | 是 | 是 | default_or_explicit |
| perplexity | nimillm | 是 | 是 | explicit_required |
| pika | nimillm | 是 | 是 | explicit_required |
| qianfan | nimillm | 是 | 是 | default_or_explicit |
| runway | nimillm | 是 | 是 | explicit_required |
| siliconflow | nimillm | 是 | 是 | explicit_required |
| soundverse | nimillm | 是 | 是 | default_or_explicit |
| spark | nimillm | 是 | 是 | default_or_explicit |
| stability | nimillm | 是 | 是 | default_or_explicit |
| stepfun | nimillm | 是 | 是 | default_or_explicit |
| suno | nimillm | 是 | 是 | default_or_explicit |
| together | nimillm | 是 | 是 | explicit_required |
| volcengine | nimillm | 是 | 是 | default_or_explicit |
| volcengine_openspeech | nimillm | 是 | 是 | default_or_explicit |
| xai | nimillm | 是 | 是 | default_or_explicit |

---

## 5. 流式处理

Runtime 有两类流式模式：场景流（StreamScenario）与任务状态订阅（SubscribeScenarioJobEvents）。

### 5.1 建流边界

流的建立有一个关键的分界点：AI 推理管道的全部 10 步评估通过后，流才算建立。

- **建流前**出错：走普通 gRPC error，和 unary RPC 一样
- **建流后**出错：优先通过终帧事件通知（`done=true + reason_code`），而非中断流

这意味着客户端可以简单地判断：如果收到了第一个流事件，说明认证、授权、凭据校验都已通过，后续错误只可能来自上游 provider。

**K-STREAM-002 — 阶段边界**

`StreamScenario`（TEXT_GENERATE/SPEECH_SYNTHESIZE）的建流边界固定为：

- K-KEYSRC-004 定义的 10 步评估链中，step 1-9（校验阶段）全部通过后，stream 才算建立；step 10（路由执行）即为流式推理的开始。
- 建流前错误统一走 gRPC error。
- 建流后业务/上游错误优先走终帧事件（`done=true + reason_code`）。

### 5.2 文本流事件

文本流的事件约定简单明确：

- 中间帧：`done=false`，必须携带非空的 `text_delta`
- 终帧：`done=true`，必须携带 `usage` 统计（token 用量）。如果上游不提供统计，填 `-1`
- 终帧可以携带最后一段 `text_delta`（即最后一个 chunk 和 done 可以合并）

**K-STREAM-003 — 文本流事件约束**

- `done=false` 事件：`text_delta` 必须非空。
- `done=true` 终帧：必须携带 `usage`；若上游缺失 token 统计则填 `-1`。
- `done=true` 终帧可携带最后一段 `text_delta`。

### 5.3 语音流事件

语音流的事件约定类似，但音频数据和状态信号严格分离：

- 中间帧：`done=false`，必须携带非空的 `audio_chunk`
- 成功终帧：`done=true`，`audio_chunk` 为空
- 失败终帧：`done=true`，`reason_code` 必填

**K-STREAM-004 — 语音流事件约束**

- `done=false` 事件：`audio_chunk` 必须非空。
- `done=true` 成功：`reason_code=REASON_CODE_UNSPECIFIED`，`audio_chunk` 为空。
- `done=true` 失败：`reason_code` 必填，`audio_chunk` 为空。

### 5.4 状态事件流

ScenarioJob 状态事件流不使用 `done=true` 语义。当任务到达终态后，服务端正常关闭流（gRPC OK）。

**K-STREAM-005 — 状态事件流约束**

`SubscribeScenarioJobEvents` 不使用 `done=true` 语义；终态事件后 server 正常关闭流（gRPC OK）。

---

## 6. ScenarioJob 系统

图像生成、视频生成、TTS/STT 等场景类 AI 任务采用异步模式：通过 `SubmitScenarioJob` 提交任务，然后通过轮询或事件流获取结果。

### 6.1 核心设计：凭据快照

ScenarioJob 的一个关键设计是**凭据快照**。任务提交时，系统会快照当前的 provider type、endpoint 和凭据。之后所有对这个 job 的操作（查询状态、获取结果、取消）都使用快照凭据，**不依赖连接器的当前状态**。

这意味着：
- 用户在任务执行期间删除连接器，不影响任务的可观测性和可控性
- 任务到达终态后，快照凭据会被清理（内存清零 + 持久化删除）

**K-JOB-003 — 凭据快照**

`SubmitScenarioJob` 必须快照：

- `provider_type`
- `endpoint`
- `credential`

这三个字段对应 `K-KEYSRC-004` step 6 执行上下文三元组（`provider_type`/`endpoint`/`credential`）。快照在 job 创建时从执行上下文复制，后续轮询/取消/结果获取使用 job 快照，不依赖 connector 当前状态。

**K-JOB-004 — 凭据快照清理**

job 到达终态后必须清理快照凭据（best-effort 内存清零 + 持久化删除）。

**K-JOB-005 — connector 删除兼容**

`DeleteConnector` 不得影响已提交 job 的可观测性与可控性；job 查询/取消/取结果能力以 job 元数据为准。

### 6.2 任务状态机

ScenarioJob 有以下状态，其中四个是终态：

| 状态 | 终态 |
|---|---|
| SUBMITTED | 否 |
| QUEUED | 否 |
| RUNNING | 否 |
| COMPLETED | 是 |
| FAILED | 是 |
| CANCELED | 是 |
| TIMEOUT | 是 |

事件流在任一终态后可正常关闭。

---

## 7. 安全与审计

### 7.1 Endpoint 安全

所有出站的 AI API 请求都必须经过 endpoint 安全校验，包括 managed 连接器的 endpoint 和 inline 路径的 endpoint。校验不是一次性的——**每次实际出站请求前都必须执行**，防止 TOCTOU（Time-of-check to time-of-use）攻击。

**K-SEC-002 — Phase 1 安全基线**

1. 默认仅允许 `https://`
2. `http://` 仅在满足以下全部条件时允许：
   - 目标地址为 loopback（`localhost`、`127.0.0.0/8`、`::1`）
   - 显式开启 `allow_loopback_provider_endpoint=true`
3. 无条件拒绝的高风险地址（不受任何开关影响）：
   - 链路本地：`169.254.0.0/16`、`169.254.169.254`、`fe80::/10`
   - 私网：`fc00::/7`
4. 条件拒绝的 loopback 地址（`allow_loopback_provider_endpoint=false` 时拒绝）：
   - `localhost`、`127.0.0.0/8`、`::1`
5. DNS 解析后按实际 IP 网段重新校验（解析结果可能落入上述拒绝范围）

**K-SEC-003 — TOCTOU 防护**

- 必须 pin 已校验 IP 作为实际拨号目标。
- TLS `ServerName` 与 HTTP `Host` 仍使用原始域名。
- 当 DNS 返回多个已校验的 safe IP 时，transport 必须允许在这些 pinned IP 之间做连接级 failover；不得因为只固定第一个 safe IP 而把同一 hostname 的后续 safe 地址全部浪费掉。

### 7.2 审计

所有管理操作和推理操作都必须记录审计事件（成功和失败）。审计记录包含最小字段集：

**K-AUDIT-001 — 通用审计底线字段**

所有审计路径（AI 执行、auth/grant、lifecycle 等）最小字段固定包含：

- `trace_id`
- `app_id`
- `domain`
- `operation`
- `reason_code`
- `timestamp`

任何审计事件至少包含上述 6 个字段。domain 专属扩展字段由各自规则定义（如 AI 执行扩展见 `K-AUDIT-018`）。

审计数据有严格的安全要求：必须脱敏（不记录明文凭据），必须有保留期限（禁止无限保留）。

**K-AUDIT-005 — 安全治理基线**

- 审计存储必须受 retention 策略控制（时长可配置，禁止无限保留）。
- 审计写入必须执行敏感字段脱敏（例如凭据、token、secret、authorization 原文）。
- 禁止采集可还原的明文凭据片段；如确需排障只能记录不可逆摘要或前后缀掩码。

---

## 8. 错误处理模型

### 8.1 双层错误模型

Nimi 的错误由两层组成，二者正交：

- **gRPC Code**：表示失败的阶段/类型（如 `NOT_FOUND`、`UNAUTHENTICATED`、`INTERNAL`）
- **ReasonCode**：表示具体的业务原因（如 `AI_CONNECTOR_DISABLED`、`AUTH_TOKEN_INVALID`）

同一个 ReasonCode 在不同场景下可能对应不同的 gRPC Code。例如 `AI_CONNECTOR_CREDENTIAL_MISSING` 在 consume 场景返回 `FAILED_PRECONDITION`，在 test-connector 场景返回 `OK + ok=false`。

**K-ERR-001 — 双层错误模型**

错误由两层组成：

- gRPC Code：表示失败阶段
- ReasonCode：表示业务原因

两者正交，不要求一一映射。

### 8.2 关键映射规则

以下是几个最重要的错误映射规则：

**K-ERR-004 — 关键映射约束**

- owner 不匹配 / 无 JWT 访问 remote：`NOT_FOUND` + `AI_CONNECTOR_NOT_FOUND`
- connector disabled：`FAILED_PRECONDITION` + `AI_CONNECTOR_DISABLED`
- credential 缺失：
  - consume / list-models：`FAILED_PRECONDITION` + `AI_CONNECTOR_CREDENTIAL_MISSING`
  - test-connector：`OK + ok=false + AI_CONNECTOR_CREDENTIAL_MISSING`

**K-ERR-005 — ListConnectorModels(remote) 特殊映射**

Provider 上游失败（401/429/5xx/timeout）统一映射：`UNAVAILABLE` + `AI_PROVIDER_UNAVAILABLE`。

### 8.3 错误传递机制

错误在不同类型的 RPC 中传递方式不同：

**K-ERR-003 — 传递机制**

- Unary：`Status.details` 的 `google.rpc.ErrorInfo` 携带 ReasonCode
- 生成流式：建流前同 Unary；建流后优先终帧 `reason_code`
- 状态事件流：不使用终帧语义，致命错误走 gRPC status

### 8.4 分页与过滤

`ListConnectors` 和 `ListConnectorModels` 支持分页。页面大小默认 50，最大 200。排序规则是固定的——本地连接器排在前面，远程连接器按创建时间倒序。

**K-PAGE-001 — page_size**

`ListConnectors` / `ListConnectorModels` 的分页默认值：

- 默认 `50`
- 最大 `200`
- 超上限按最大值裁剪

以上值与 K-PAGE-005 通用默认值一致。Connector 相关 List RPC 的排序与过滤规则详见 K-PAGE-003 / K-PAGE-004。

**K-PAGE-003 — 排序稳定性**

`ListConnectors` 固定排序：

1. kind：`LOCAL_MODEL` 在前，`REMOTE_MANAGED` 在后
2. local：`local_category` 升序，同 category 按 `connector_id ASC`
3. remote：`created_at DESC`，同值 `connector_id ASC`

`ListConnectorModels`：`model_id ASC`

---

## 9. SDK 架构

在 Nimi 的整体架构中，SDK 扮演的角色是**唯一合法网关**：Desktop 和 Web 应用不直接发 gRPC 调用，也不直接拼 HTTP 请求，一切对 Runtime 和 Realm 的访问必须经过 `@nimiplatform/sdk`。这不是一个便利性选择——SDK 承担了传输声明、错误投影、导入隔离三项关键职责，把"调用底层服务"从一个全局不确定行为收窄为五条受控通道。

```
┌─────────────────────────────────────────────────────────────┐
│                   Desktop / Web / Mod                       │
│                                                             │
│  @nimiplatform/sdk                                          │
│  ┌──────────┐ ┌────────────┐ ┌───────┐ ┌───────┐ ┌──────┐  │
│  │ runtime  │ │ai-provider │ │ realm │ │ scope │ │ mod  │  │
│  └────┬─────┘ └─────┬──────┘ └───┬───┘ └───┬───┘ └──┬───┘  │
│       │ gRPC/IPC     │ wraps     │ HTTP/WS  │ memory │ host │
└───────┼──────────────┼───────────┼──────────┼────────┼──────┘
        ▼              ▼           ▼          ▼        ▼
  ┌───────────┐   (delegates   ┌────────┐  (local)  (injected
  │  Runtime  │    to runtime) │ Realm  │           by desktop)
  │   (Go)    │                │ Server │
  └───────────┘                └────────┘
```

下面的规范从"为什么分五个子路径"出发，依次展开传输层设计、错误投影模型和导入边界，最后简述每个子路径的领域特征。

### 9.1 为什么是五个子路径？

五个子路径看似只是目录划分，实际上反映了五种**根本不同的传输模型和信任假设**：

- **runtime** — 通过 gRPC 或 Tauri IPC 与本地守护进程通信，延迟极低，但需要显式声明传输通道
- **ai-provider** — 封装 AI SDK v3 协议，把标准化的 `generateText` / `embed` 调用翻译为 Runtime gRPC 方法；它是**协议适配层**，不做路由决策
- **realm** — 通过 HTTP/WebSocket 与远程 Realm 服务器通信，延迟和可靠性特征与 gRPC 截然不同
- **scope** — 纯 in-memory 权限目录，无网络通信，维护 register / publish / revoke 最小闭环
- **mod** — Mod 不拥有自己的客户端，一切能力通过 host 注入获得

如果把它们合并为一个入口，transport 切换逻辑、错误码映射、安全边界就会交织在一起，制造出"能调通但偶尔莫名失败"的隐藏耦合。五条子路径让每种通信模式有独立的初始化和失败语义。

**S-SURFACE-001 — SDK 子路径集合**

公开 SDK 子路径固定为：

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/mod`
- `@nimiplatform/sdk/types`

SDK 必须维持单一 package layout；公开子路径只允许在 `@nimiplatform/sdk` 包内投影，不得漂移为多 package 或多根布局。

其中 `@nimiplatform/sdk` 根入口是 app 级组合面与第一方 docs/examples 的推荐入口；子路径继续作为显式 low-level escape hatch 或专用 domain 入口保留。

执行命令：

- `pnpm check:sdk-single-package-layout`

各子路径的方法投影遵循结构化治理。Runtime SDK 的对外方法按 service 分组，与 `spec/runtime/kernel/tables/rpc-methods.yaml` 的设计名对齐——投影表 `tables/runtime-method-groups.yaml` 是唯一事实源：

**S-SURFACE-002 — Runtime SDK 对外方法投影**

Runtime SDK 对外方法投影按服务分组，方法集合必须与 `spec/runtime/kernel/tables/rpc-methods.yaml` 对应服务对齐，采用 design 名称。服务完整列表与方法集合以 `tables/runtime-method-groups.yaml` 为唯一事实源（S-SURFACE-009），每个 group 独立追踪对齐状态与 phase。

app-facing route metadata / projection surface 是例外的 host-typed logical surface，遵循 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`），不得被误写成新增 daemon 顶层 RPC 投影。

**S-SURFACE-009 — Runtime 方法投影表治理**

`tables/runtime-method-groups.yaml` 是 SDK 对外方法投影的结构化事实源，采用”显式维护 + 一致性校验”模式：

- 显式维护：表内只列当前 SDK 对外投影集合，不要求机械等于 runtime kernel 全量 proto 面。
- 一致性校验：每个 group 必须声明对应 runtime service，且方法名必须在 `spec/runtime/kernel/tables/rpc-methods.yaml` 中可解析；校验脚本负责阻断漂移。

遗留接口名（`listTokenProviderModels`、`TokenProvider*` 系列）已被禁用，公共契约层不得暴露这些旧名称：

**S-SURFACE-003 — Runtime SDK 禁用旧接口名**

SDK 对外契约层禁止出现以下旧接口名：

- `listTokenProviderModels`
- `checkTokenProviderHealth`
- `TokenProvider*`

Realm、Scope、Mod 三个子路径各有最小稳定导出面：Realm 使用实例化 facade 入口（无全局配置），Scope 暴露 in-memory catalog + publish/revoke 语义，Mod 暴露 host 注入 facade + hook client：

**S-SURFACE-004 — Realm/Scope/Mod 稳定导出面**

- Realm SDK 以实例化 facade 为唯一入口，不允许全局配置入口。
- Scope SDK 以 in-memory catalog + publish/revoke 语义为最小稳定面。
- Mod SDK 以 host 注入 facade + hook 客户端为最小稳定面。

### 9.2 Transport 层：显式声明与分离

为什么 transport 必须显式声明？因为 `node-grpc` 和 `tauri-ipc` 的行为差异远超一个 adapter 能隐藏的范围：gRPC 有独立连接池、HTTP/2 多路复用、超时语义；IPC 走 Tauri 进程间通道，无网络栈。如果让 SDK "自动检测"使用哪种 transport，调用者在调试失败时将无法判断问题出在网络层还是 IPC 层。

```typescript
import { createPlatformClient } from '@nimiplatform/sdk';

// app 主路径使用 createPlatformClient；底层 runtime 子路径保留为 escape hatch
const { runtime } = await createPlatformClient({
  appId: 'my-app',
  runtimeTransport: { type: 'tauri-ipc' },   // 或 node-grpc + endpoint
});
```

**S-TRANSPORT-001 — Runtime Transport 显式声明**

Runtime SDK transport 必须满足以下构造边界：

- `node-grpc`
- `tauri-ipc`

规则：

- Node.js first-run surface 允许默认 `node-grpc` transport，目标地址为 `process.env.NIMI_RUNTIME_ENDPOINT || '127.0.0.1:46371'`。
- 非 Node.js surface 禁止隐式默认 transport，必须显式传入 `node-grpc` 或 `tauri-ipc`。
- 默认 transport 只解决本地 runtime 发现问题，不得引入 SDK 级全局单例。

在请求结构上，SDK 严格分离 metadata 与 body：`connectorId` 在请求体中，而 provider endpoint、api_key 走传输 metadata。这种分离确保业务参数和基础设施凭据不混在同一层。

**S-TRANSPORT-002 — Metadata 投影边界**

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/api_key 在 transport metadata
- Runtime 鉴权 token 不属于业务 metadata；必须通过 transport auth 通道注入到 gRPC metadata `authorization`

幂等键透传：SDK 支持通过 `options.idempotencyKey` 传递 `x-nimi-idempotency-key` metadata（`K-DAEMON-006`）。缺省时不设置该 header，runtime 不做去重。

流式场景有一条关键约束：**SDK 不自动重连断开的流**。流中断后，调用方必须显式重建订阅。设计意图是避免"悄悄重连但丢了中间消息"的数据完整性问题。

**S-TRANSPORT-003 — 流式行为边界**

- SDK 不得隐式重连续流。
- 中断后必须由调用方显式重建订阅。

Realm 侧的传输设计同样强调实例隔离——每个 `new Realm(options)` 独立维护 endpoint/token/header，禁止共享全局 `OpenAPI` 运行时配置。这意味着同一进程中可以同时持有多个 Realm 实例，指向不同服务器，互不干扰。

**S-TRANSPORT-004 — Realm 请求引擎边界**

Realm SDK 必须通过实例级配置完成 endpoint/token/header 合并，不允许共享全局 OpenAPI 运行态配置。

SDK 与 Runtime 之间的版本兼容采用 **fail-close** 策略：major 版本不兼容直接报错，不存在"部分可用"的中间态。minor/patch 差异允许通过 capability 检测做受控降级，兼容结果必须对上层可读（用于提示和治理）。

**S-TRANSPORT-005 — SDK/Runtime 版本兼容边界**

SDK 与 Runtime 的版本协商必须显式可判定：

- major 不兼容必须 fail-close，不允许静默降级为”部分可用”。
- minor/patch 差异允许通过能力探测或方法可用性检查做受控降级。
- 版本兼容判断结果必须可被上层读取（用于提示与治理），不得仅写日志。

发现机制：

- 版本信息通过初始连接的 metadata 交换获取。
- 方法可用性通过已知方法集合（`runtime-method-groups.yaml`）静态判定，不依赖运行时反射。
- 降级仅限于 Phase 2 deferred 方法标记为不可用，不改变 Phase 1 方法语义。

**Runtime 侧协议**：Runtime 通过 gRPC response header metadata `x-nimi-runtime-version` 暴露 semver 版本（`K-DAEMON-011`）。SDK 从首次成功 RPC 的 response metadata 中提取并缓存版本。Desktop 通过 `runtime_bridge_status` 的 `daemonVersion` 字段获取版本（`D-IPC-002`/`D-IPC-014`），两条路径语义等价。若 metadata 缺失（旧版 Runtime），SDK 按 best-effort 处理：假设兼容，首次方法不可用错误时报告版本问题。

**blocked vs deferred 语义区分**：

- `blocked`：Phase 1 服务但 proto 依赖未就绪，SDK 返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`。blocked 服务的方法一旦 proto 发布即可实现，不需要版本协商。当前无 blocked 服务（ConnectorService proto 已就绪，`S-RUNTIME-050`）。
- `deferred`：Phase 2 服务（如 WorkflowService），在版本兼容降级中标记为不可用。deferred 服务的可用性取决于 runtime 版本支持。

可观测性作为辅助能力附着在传输层：SDK 支持向下游传播调用链 trace ID（通过 metadata/header），但可观测性输出**绝不包含明文凭据**（api key / token），且不改变请求的成功/失败语义。

**S-TRANSPORT-006 — Trace 与可观测性边界**

- SDK 必须支持将调用链 trace 标识透传到下游（如 metadata/header）。
- 任何可观测性输出禁止包含明文凭据（api key/token）。
- 可观测性是辅助面，不得改变请求成功/失败语义与重试判定。

### 9.3 错误投影：三层重试模型

SDK 的错误模型是整个 Nimi 错误体系中最复杂的一环，因为它必须同时处理三种来源的错误：Runtime gRPC 错误（带 ReasonCode）、Realm HTTP 错误、以及 SDK 自身产生的本地错误。

核心设计洞察是**双层投影 + 三层重试**：

```
错误来源                           投影结果
─────────────────────────────────────────────────
Runtime gRPC → status + ReasonCode → 直接投影
Realm HTTP   → status + body       → 直接投影
SDK 本地     → 参数/环境/边界违规   → SDK_* 错误码
                                    (独立于 Runtime ReasonCode)

重试决策树
─────────────────────────────────────────────────
                 错误发生
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Transport 层              Application 层
   (gRPC status)             (ReasonCode)
        │                       │
  UNAVAILABLE ─── 可重试   AI_PROVIDER_UNAVAILABLE ─── 可重试
  DEADLINE_EXCEEDED 可重试 AI_PROVIDER_TIMEOUT ──────── 可重试
  RESOURCE_EXHAUSTED 可重试 AI_STREAM_BROKEN ────────── 可重试
  ABORTED ── ReasonCode    SESSION_EXPIRED ─────────── 可重试
             优先判断
        │                       │
        └───────────┬───────────┘
                    ▼
              Internal 层
           (SDK 连接恢复)
                    │
         SDK transport 错误 ─── 内部透明重试
         OPERATION_ABORTED ──── 永不重试
```

**S-ERROR-001 — 双层错误投影**

SDK 错误投影分两层：

- 上游运行时错误（gRPC/HTTP + reason_code）
- SDK 本地错误（参数校验、环境、边界违规）

Runtime ReasonCode 的权威来源是 `spec/runtime/kernel/tables/reason-codes.yaml`。SDK 文档不得重新分配 ReasonCode 的数值——只做投影，不做重定义。

**S-ERROR-002 — ReasonCode 事实源**

Runtime 相关 ReasonCode 以 `spec/runtime/kernel/tables/reason-codes.yaml` 为权威。
SDK 文档不得重新分配 Runtime ReasonCode 数值。

执行命令：

- `pnpm check:reason-code-constants`

SDK 本地错误码有独立的事实源 `tables/sdk-error-codes.yaml`，与 Runtime ReasonCode 不混用。Realm 本地配置错误使用 `SDK_REALM_*` 族，版本和方法兼容错误使用 `SDK_RUNTIME_*` 族——兼容错误不能降级为通用网络错误或空成功。

**S-ERROR-003 — SDK 本地错误码事实源**

SDK 本地错误码唯一事实源为 `tables/sdk-error-codes.yaml`。

**S-ERROR-005 — Realm 本地配置错误投影**

Realm SDK 的本地配置错误（实例参数校验、请求引擎配置非法）必须使用 `SDK_REALM_*` family。
具体 code 名称以 `tables/sdk-error-codes.yaml` 为权威，不在 domain 文档重复枚举。

**S-ERROR-006 — 版本与方法兼容错误投影**

SDK 在版本协商或方法可用性检查阶段触发的本地错误必须使用 `SDK_RUNTIME_*` 本地错误码：

- 版本不兼容（如 major 断裂）必须返回显式不兼容错误码。
- 方法在目标 runtime 不可用时必须返回显式方法不可用错误码。
- 不允许将上述兼容性错误降级为通用网络错误或空成功响应。

重试语义分三层协同工作。Transport 层的重试判断基于 gRPC status code（`UNAVAILABLE`、`DEADLINE_EXCEEDED`、`RESOURCE_EXHAUSTED`、`ABORTED`），但 `ABORTED` 的重试被 ReasonCode 优先级约束。流中断永不自动重连（如 S-TRANSPORT-003 所定义）。

**S-ERROR-004 — 重试语义**

重试语义必须与底层 transport code 协同：

- `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `RESOURCE_EXHAUSTED` / `ABORTED`（其中 `ABORTED` 受 ReasonCode 优先级约束，见下文）可标记为 retryable
- 流中断不做自动重连

ReasonCode 优先级：当 ReasonCode 为 `OPERATION_ABORTED`（SDK 合成码，不在 runtime reason-codes.yaml 中）时，即使 transport code 为 `ABORTED`，也不可重试（S-ERROR-008 优先）。
ReasonCode 级 retryable 判定优先于 transport code 级判定。

Application 层通过公开的 `isRetryableReasonCode()` 函数标记可重试的应用级 ReasonCode，与 transport 层互补、不重叠。可重试集合包括 Runtime 侧的 `AI_PROVIDER_UNAVAILABLE`、`AI_PROVIDER_TIMEOUT`、`AI_STREAM_BROKEN`、`SESSION_EXPIRED`，以及 SDK 合成的 `RUNTIME_UNAVAILABLE`、`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`。

**S-ERROR-007 — 应用层 Retryable ReasonCode**

公开 `isRetryableReasonCode()` 函数标记面向上层消费者（如 ai-provider）的
可重试应用级 ReasonCode。此集合与 S-ERROR-004 的 transport 级 retryable 是互补关系，不重叠。

retryable 集合分两类来源：

Runtime ReasonCode（权威源：`spec/runtime/kernel/tables/reason-codes.yaml`）：

- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_PROVIDER_RATE_LIMITED`
- `AI_STREAM_BROKEN`
- `SESSION_EXPIRED`

SDK 合成 ReasonCode（SDK 本地生成，不在 runtime reason-codes.yaml 中）：

- `RUNTIME_UNAVAILABLE`
- `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`

Internal 层是 SDK 内部的连接恢复重试（auto mode），使用独立的可重试集合，仅包含 SDK transport 错误码。这层重试对外不可见，且 `OPERATION_ABORTED` 在任何层级都**永不重试**。

**S-ERROR-008 — Runtime 内部连接恢复重试**

Runtime 内部 transparent retry（auto 连接模式）使用独立 retryable 集合，
包含 SDK transport 错误码（`SDK_RUNTIME_NODE_GRPC_UNARY_FAILED` 等）。
此集合仅用于内部连接恢复，不暴露为公开 API。
`OPERATION_ABORTED` 永不重试。

### 9.4 导入边界与模块隔离

SDK 的五个子路径之间有**物理级导入隔离**，而非仅靠文档约定。设计意图是：Mod 开发者引入 `@nimiplatform/sdk/mod` 时，不能通过 import chain 间接访问到 runtime 或 realm 的私有客户端——这是安全边界，不只是代码组织偏好。

**S-BOUNDARY-001 — 子路径导入边界**

各 SDK 子路径禁止跨域私有实现导入，所有跨域依赖必须通过公开导出面完成。
`S-BOUNDARY-001` 是所有 surface 的基线规则，可与特化规则叠加绑定。

Runtime 与 Realm 之间的边界尤其关键：SDK 内部代码不得将 gRPC transport 和 REST client 混入同一个私有入口点。显式分离防止凭据和传输配置的意外交叉泄漏。

**S-BOUNDARY-002 — Runtime/Realm 边界**

SDK 内部禁止将 runtime transport 与 realm REST client 混合为单一私有入口；必须维持显式边界。

Mod SDK 的隔离更为严格——Mod 不得绕过 host 注入直接访问 runtime/realm 的私有客户端。所有对平台资源的依赖必须通过注入的 host facade 流转。

**S-BOUNDARY-003 — Mod 边界**

Mod SDK 不得绕过 host 注入直接访问 runtime/realm 私有客户端。

作为迁移清理的一部分，以下旧入口被明确禁止：`createNimiClient`、全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值。所有配置必须走现代的实例级模式。

**S-BOUNDARY-004 — 禁止旧入口**

禁止出现：

- `createNimiClient`
- 全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值

执行命令：

- `pnpm check:no-create-nimi-client`
- `pnpm check:no-global-openapi-config`

### 9.5 各子路径领域概述

**SDK 根入口** `createPlatformClient()` 是 app 级组合面。它把 Runtime 与 Realm 的实例化、auth/session 注入和第一方高层 domains 收敛到一个入口，作为 docs/examples/第一方 app 的推荐主路径。

**Runtime SDK** 是最重的 low-level 子路径。`new Runtime(options)` 仍是允许的 escape hatch，用于显式 transport、测试和协议级控制；构造后提供与 Runtime 守护进程完整的方法投影：连接器 CRUD、AI 推理触发、认证管理、Grant 操作等。方法按 service 分组（如 S-SURFACE-002 / S-SURFACE-009 所定义），每个方法调用携带显式的 metadata/body 分离。重试策略按上述三层模型执行。

**AI Provider** 是 Runtime SDK 上层的协议适配。它实现 AI SDK v3 的 `LanguageModelV1` / `EmbeddingModelV1` 接口，将标准化调用（`generateText`、`embed`、`generateMedia`）翻译为对应的 Runtime gRPC 方法。AI Provider **只做协议转换**——路由决策由 Desktop 的 LLM 适配器或调用方完成。

**Realm SDK** 通过 HTTP/WebSocket 与远程 Realm 服务器通信。每个 `new Realm(options)` 实例独立配置 endpoint、token、headers（如 S-TRANSPORT-004 所定义）；它同样保留为 low-level escape hatch，而 app 主路径优先经由 `createPlatformClient()` 获取 Realm 实例。Realm SDK 的认证模型允许 `NO_AUTH` 模式用于公开数据读取。本地配置错误使用 `SDK_REALM_*` 族错误码。

**Scope SDK** 维护纯内存的权限目录。核心 API 是 `register` / `publish` / `revoke` 三操作，不涉及网络通信。Scope catalog 是进程级的——各 Runtime 实例共享同一个 catalog 实例。

**Mod SDK** 设计为最小权限。Mod 通过 host 注入获得 facade 和 hook client，不能直接构造 Runtime 或 Realm 客户端（如 S-BOUNDARY-003 所定义）。Mod 可用的能力由 Desktop 的 Hook 能力模型（见 10.6）中的 capability allowlist 控制。
---

## 10. Desktop 架构

Nimi Desktop 是一个 Tauri + React 应用，它把 Runtime（Go 守护进程）、Realm（远程平台）和 Mod（第三方扩展）三个世界粘合成一个统一的用户体验。与传统 Electron 应用不同，Desktop 选择 Tauri 的核心原因是 Rust 后端提供了真正的本地能力：进程管理、安全存储、TCP 端口绑定——这些在浏览器沙箱中无法实现。

Desktop 规范由 13 个契约域组成，从启动序列到安全策略形成完整的应用生命周期。每个域都有独立的规则集，但域间存在明确的依赖关系——例如启动序列依赖 IPC 桥接，数据同步依赖认证会话。

```
┌──────────────────────────────────────────────────────────────┐
│                    Nimi Desktop (Tauri)                       │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │UI Shell │  │  State   │  │   Hook   │  │ Mod Runtime  │  │
│  │ (React) │  │(Zustand) │  │ (5 subs) │  │ (8 stages)   │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │            │             │                │          │
│  ┌────┴────────────┴─────────────┴────────────────┴───────┐  │
│  │              IPC Bridge (Tauri invoke)                  │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │            Tauri Backend (Rust)                      │     │
│  │   daemon mgmt · secure store · proxy fetch · OAuth  │     │
│  └──────────┬─────────────────────────┬────────────────┘     │
└─────────────┼─────────────────────────┼──────────────────────┘
              │                         │
    ┌─────────┴──────────┐    ┌────────┴────────┐
    │  Runtime (Go gRPC) │    │  Realm (HTTP)   │
    │  localhost only     │    │  remote server  │
    └────────────────────┘    └─────────────────┘
```

### 10.1 启动序列：八阶段异步初始化

Desktop 的启动不是一个简单的 `init()` 调用——它是一条 8 阶段的异步依赖链。为什么不能一次性初始化？因为每个阶段都有明确的前置条件：Platform Client 需要 Realm URL（来自 Runtime Defaults），DataSync 需要 Platform Client，Runtime Host 需要 DataSync，Mod 注册需要 Runtime Host。任何阶段失败都有精确的错误边界，不会"半初始化"。

```
阶段依赖链
─────────────────────────────────────────────────────
① Runtime Defaults (IPC)
   ↓ realm URL + execution params
② Platform Client 初始化
   ↓ API client ready
③ DataSync Facade 初始化
   ↓ initApi(realm, proxyFetch)
④ Auth Session 引导
   ↓ token ready / anonymous
⑤ Runtime Host 装配
   ↓ HTTP context + capabilities
⑥ Mod 注册
   ↓ 部分失败不阻塞
⑦ External Agent 桥接
   ↓ tier-1 actions registered
⑧ Bootstrap 完成
   ↓ bootstrapReady = true
```

**D-BOOT-001 — Runtime Defaults 加载**

启动序列的首个异步操作。通过 IPC 桥接调用 `runtime_defaults` 获取 `RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、revocationUrl、jwtIssuer、jwtAudience）和 `RuntimeExecutionDefaults`（provider、model 与可透传的 runtime execution 字段）。

Desktop 只允许使用 canonical runtime 配置路径 `.nimi/config.json`；legacy 路径 `.nimi/runtime/config.json` 已硬切移除，不得在 bootstrap 或 backend fallback 中回流。

- `runtime_defaults` 读取不要求 daemon 已运行。
- packaged desktop 必须先完成 bundled runtime staging。release 模式下不允许依赖 `PATH`、用户手工 binary、或产品语义上的 `NIMI_RUNTIME_BINARY` 覆盖。
- 若 bundled runtime staging / 版本校验失败，Desktop shell 必须继续 bootstrap，但将 runtime 标记为 unavailable 并暴露结构化错误。
- 只有 source development 的 runtime 模式才允许 `go run ./cmd/nimi` / `PATH` 解析流程。
- 只有 shell 级致命错误才进入 `D-BOOT-008` 错误路径。
- 后续依赖：DataSync 初始化、Platform Client 初始化。
- `runtime_defaults.realm.accessToken` 仅是 operator/debug override 输入，不是 canonical persisted login source。

### Runtime JWT Config Sync

在 `D-BOOT-001` 之后、业务初始化之前，Desktop 必须将 Realm JWT 验签参数写入 Runtime 配置：

- 写入目标：`auth.jwt.jwksUrl`、`auth.jwt.revocationUrl`、`auth.jwt.issuer`、`auth.jwt.audience`（K-DAEMON-009）。
- 数据来源：`runtime_defaults.realm.{jwksUrl,revocationUrl,jwtIssuer,jwtAudience}`。
- 写入流程：`runtime_bridge_config_get` → 合并配置 → `runtime_bridge_config_set`。
- 若 runtime 当前 unavailable（例如 bundled runtime staging 失败），必须跳过该步骤，不得阻断 app shell。

重启分支（基于 `reasonCode`）：

- `CONFIG_APPLIED`：继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=true`：Desktop 自动执行 `runtime_bridge_restart` 后继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=false`：bootstrap fail-close，返回明确错误要求用户手动重启外部 Runtime。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=false`：继续 bootstrap（配置已落盘，等待后续启动生效）。

执行命令：

- `pnpm check:desktop-no-legacy-runtime-config-path`

**D-BOOT-002 — Platform Client 初始化**

使用 `D-BOOT-001` 获取的 realmBaseUrl 与 resolved bootstrap auth session 初始化 SDK 根导出的 `createPlatformClient()`。

- 必须在 DataSync 初始化之前完成。
- resolved bootstrap auth session 的优先级：env override → `auth_session_load` 读取的共享持久会话 → anonymous。

**D-BOOT-003 — DataSync Facade 初始化**

调用 `dataSync.initApi()` 注入 realm 配置和 proxy fetch 实例。

- `fetchImpl` 使用 `createProxyFetch()` 以绕过浏览器 CORS（参考 `D-IPC-004`）。
- 热状态通过 `globalThis.__NIMI_DATA_SYNC_API_CONFIG__` 跨 HMR 持久化。

阶段 ④ 在启动期间执行 token 交换或匿名回退——这是认证状态的初始决策点。阶段 ⑤ 组装 HTTP context provider、runtime host 能力、mod SDK host 和核心数据能力。阶段 ⑥ 从本地 manifest 注册 mod，**部分 mod 注册失败不阻塞整体启动**，采用降级模式继续。阶段 ⑦ 注册 tier-1 external agent actions 并启动 action bridge。

**D-BOOT-004 — Runtime Host 装配**

受 `enableRuntimeBootstrap` feature flag 门控（参考 `tables/feature-flags.yaml`）。

- 设置 HTTP context provider（runtime defaults + store token + proxy fetch）。
- 通过 SDK Runtime client 调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。成功后 Runtime 记录 app 注册信息，后续请求可通过 AppMode gate（K-AUTHSVC-009）。失败（如 `APP_MODE_MANIFEST_INVALID`）时中断 bootstrap，进入 D-BOOT-008 错误路径。
- 构建 runtime host capabilities（local LLM health check、execution kernel turn、OpenAPI context lock、hook runtime）。
- 装配 mod SDK host。
- 配置 speech route resolver 和 missing data capability resolver。
- 确保 core world data capabilities 与 host-only Agent LLM data capabilities（route / memory）已注册，供 mods 调用。
- host-only Agent chat route capability 必须遵循 `D-LLM-002` fail-close 语义；host-only Agent memory capability 必须遵循 `D-DSYNC-011` cache-only + fail-close 语义。
- local route bootstrap / hydration / health merge 时，RuntimeLocalService local model list/status 是唯一 readiness 真源；host-local snapshot 只能补充展示元数据。
- 当 selected local model 与 runtime authoritative local record 缺失、degraded、或状态冲突时，Desktop 可以保留原选择用于显示，但必须把 binding 视为 unavailable/not-sendable，不得继续 fail-open 发送。

**D-BOOT-005 — Runtime Mods 注册**

调用 `registerBootstrapRuntimeMods` 从本地清单注册 mods。

- 返回 `runtimeModFailures` 和 `manifestCount`。
- 部分 mod 注册失败不中断启动序列（degraded mode）。

**D-BOOT-006 — External Agent 桥接**

注册 tier-1 external agent actions 并启动 action bridge。

- 调用 `registerExternalAgentTier1Actions(hookRuntime)`。
- 调用 `startExternalAgentActionBridge()` 和 `resyncExternalAgentActionDescriptors()`。

**D-BOOT-007 — Auth Session 引导**

调用 `bootstrapAuthSession` 执行 token 交换或匿名回退。

- 成功时设置 `auth.status = 'authenticated'`。
- 失败时设置 `auth.status = 'anonymous'`。
- source=`persisted` 且 bootstrap 期间发生 unauthorized / decrypt / schema 失败时，必须清空共享 auth session 文件。
- `auth.status = 'anonymous'` 时，desktop shell 仍进入主壳并默认落到 `AI Runtime`；外层主导航隐藏，右上角提供显式 `Login` 入口，登录页可返回当前 Runtime 子页。

阶段 ⑧ 设置 `bootstrapReady` / `bootstrapError` 标志，失败时清除 auth 状态。整个启动链有一个关键的幂等性守卫：`bootstrapPromise` 单例确保 bootstrap 全局只执行一次——即使在 HMR（热模块替换）场景下重复触发也安全。

**D-BOOT-008 — Bootstrap 完成 / 错误处理**

正常路径：
- `bootstrapReady = true`、`bootstrapError = null`。
- 日志级别：有 mod 失败时 `warn`，否则 `info`。

错误路径（仅 shell-fatal）：
- `bootstrapReady = false`、`bootstrapError = message`。
- 清除 auth session。
- 日志级别：`error`。

packaged desktop release 校验补充：

- release metadata 读取失败、bundled runtime staging 失败、或 runtime 自报版本与 packaged desktop 不一致，不得由 renderer / backend 合成 fallback release info。
- 这些错误属于 runtime unavailable / release invalid，可通过 `desktopReleaseError` 和设置页状态呈现；是否进入 shell-fatal 只取决于后续是否仍有必须依赖 runtime exact match 的 bootstrap 步骤被触发。

**D-BOOT-009 — 幂等性守卫**

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

### 10.2 IPC 桥接：为什么不直接 HTTP？

Desktop 为什么不让 Renderer 直接发 HTTP 请求？三个原因：浏览器沙箱有 CORS 限制、无法访问本地文件系统、无法绑定 TCP 端口。Tauri IPC 把这些限制绕过——所有跨进程通信走 `window.__TAURI__.invoke()`，由 Rust 后端代理执行。

IPC 层的基础设施先于具体命令。统一的 `invoke()` 入口先检查 `hasTauriInvoke`（即 `window.__TAURI__` 是否存在），然后为每次调用生成 `invokeId`、写入结构化日志、统一错误归一化。这意味着所有 IPC 命令自动获得可观测性，无需各命令自行实现。

**D-IPC-009 — Invoke 基础设施**

所有 IPC 调用通过 `invoke()` / `invokeChecked()` 统一入口：

- 前置检查 `hasTauriInvoke()`（`window.__TAURI__` 存在性）。
- 前置检查 `hasTauriInvoke()`（Tauri runtime presence；不得依赖 `withGlobalTauri`）。
- 生成 `invokeId`（`${command}-${timestamp}-${random}`）。
- 结构化日志：invoke-start、invoke-success、invoke-failed。
- 错误归一化：`toBridgeUserError()` 将 Tauri 错误转为用户可读消息。

### IPC Infrastructure Commands

- `get_system_resource_snapshot`：采集系统资源快照（CPU/内存/GPU），供设备画像使用。
- `log_renderer_event`：renderer 侧结构化日志转发到 Tauri backend logger（D-TEL-006 桥接入口）。

高容量模块（如 local-ai 和 external-agent）采用动态 `import()` 懒加载，避免主 bundle 体积膨胀：

**D-IPC-010 — 懒加载桥接模块**

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- local runtime bridge loader — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

在此基础设施之上，IPC 命令按功能域分组：

**Runtime Defaults 命令** — `runtime_defaults` 返回 realm 和运行时执行默认值，采用防御性解析：

**D-IPC-001 — Bootstrap / Auth Session 命令**

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、revocationUrl、jwtIssuer、jwtAudience）
- `runtime: RuntimeExecutionDefaults`（provider、model 与可透传的 runtime execution 字段）

所有字段通过 `parseRuntimeDefaults` 防御性解析。

共享 auth session 命令集：
- `auth_session_load`：读取并解密 `~/.nimi/auth/session.v1.json`，返回 normalized shared desktop auth session 或 `null`。corrupt / invalid schema 文件必须在读取时删除。
- `auth_session_save`：原子覆写共享 auth session 文件；renderer 只提交 normalized user + tokens，backend 负责加密与落盘。
- `auth_session_clear`：删除共享 auth session 文件。

**Daemon 生命周期命令** — status、start、stop、restart，报告 `launchMode`：

**D-IPC-002 — Daemon 生命周期命令**

Daemon 管理命令集：`runtime_bridge_status`、`runtime_bridge_start`、`runtime_bridge_stop`、`runtime_bridge_restart`。

返回 `RuntimeBridgeDaemonStatus`：
- `running: boolean`
- `managed: boolean`
- `launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID'`
- `grpcAddr: string`
- `version?: string`（release 模式下必须来自 bundled runtime 执行 `nimi version --json` 的自报版本，不得取自 manifest 猜测值）

**Runtime 健康状态 UI 映射**（对应 Runtime K-DAEMON-001 五态）：

| Runtime 状态 | UI 指示器 | 可用操作 | 超时预期 |
|---|---|---|---|
| `STOPPED` | 灰色/离线标记 | start | — |
| `STARTING` | 加载动画/启动中 | — (等待) | 120s 启动超时（对齐 K-LENG-004 SUPERVISED 最差情形） |
| `READY` | 绿色/就绪标记 | stop, restart | — |
| `DEGRADED` | 黄色/降级警告 | stop, restart | —（Phase 1 通过 `running=true` 统一覆盖 READY/DEGRADED，DEGRADED 独立检测需 daemon 暴露结构化健康状态，Phase 2 增强） |
| `STOPPING` | 加载动画/停止中 | — (等待) | 10s 停机超时（K-DAEMON-003） |

Desktop 通过 `runtime_bridge_status` 轮询获取 `running` 状态。`running=true` 对应 `READY` 或 `DEGRADED`，`running=false` 对应 `STOPPED`。`STARTING`/`STOPPING` 过渡态通过命令执行期间的 UI 加载状态表示。

**Provider 健康探测窗口**：Daemon 到达 READY 后启动 provider 健康探测（K-PROV-003），首次探测立即执行但结果需 0~8s 到达。在此窗口内，所有 provider 状态为 `unknown`。Desktop UI 行为：

- READY 后、首次探测结果到达前：provider 列表展示"检测中"状态（非"就绪"），不阻塞用户操作但不显示绿色健康标记。
- 首次探测结果到达后：按 healthy/unhealthy 更新 UI 指示器。
- Phase 1 简化：`running=true` 统一覆盖 READY/DEGRADED，provider 健康细粒度展示为 Phase 2。Phase 1 不展示 provider 级健康指示器，仅展示 daemon 级 running 状态。

**Config 读写命令** — `runtime_bridge_config_get` / `set` 管理配置持久化：

**D-IPC-003 — Config 读写命令**

`runtime_bridge_config_get` / `runtime_bridge_config_set` 命令。

- `ConfigGetResult`：`{ path, config }`
- `ConfigSetResult`：`{ path, reasonCode?, actionHint?, config }`

**配置可见性规则**：

- **UI 暴露子集**：Phase 1 Desktop UI 仅暴露安全且用户可理解的配置项。完整字段清单由 K-DAEMON-009 定义，Desktop UI 暴露子集为实现定义。
- **热重载 vs 重启**：`config_set` 通过 `reasonCode` 指示后续行为：`CONFIG_APPLIED`（无需重启）或 `CONFIG_RESTART_REQUIRED`（需重启 daemon 生效）。Desktop 收到 `CONFIG_RESTART_REQUIRED` 时执行 `D-BOOT-001` 中 Runtime JWT Config Sync 定义的重启分支。
- **环境变量覆盖不可见性**：环境变量优先级高于配置文件（K-DAEMON-009 三层优先级）。Desktop UI 展示配置文件中的值，不反映环境变量覆盖。此为已知限制，Phase 1 不解决。
- **向前兼容**：Runtime 新增配置字段在 Desktop 未更新时不可见。`config_get` 返回完整 JSON（含未识别字段），`config_set` 透传未识别字段（不丢弃）。

canonical 配置路径固定为 `.nimi/config.json`；Desktop 不得保留 `.nimi/runtime/config.json` fallback。

**HTTP 代理命令** — `http_request` 代理所有 HTTP 请求通过 Tauri 后端，绕过 CORS。**UI 命令** — `open_external_url`、`confirm_private_sync`、`start_window_drag`。**OAuth 命令** — `oauth_token_exchange` 和 `oauth_listen_for_code`，支持 PKCE 和 clientSecret 两种模式：

**D-IPC-004 — HTTP 代理命令**

`http_request` 命令：renderer 通过 Tauri backend 代理所有 HTTP 请求，绕过浏览器 CORS 限制。

- 每次调用生成唯一 `invokeId` 用于追踪。
- 日志记录 `requestUrl`、`requestMethod`、`requestBodyBytes`。

**D-IPC-005 — UI 命令**

- `open_external_url`：在系统浏览器打开外部 URL。
- `confirm_private_sync`：确认私有数据同步。
- `start_window_drag`：原生窗口拖拽。
- `menu_bar_sync_runtime_health`：renderer 向 Tauri backend 同步 menu bar 所需的 runtime/provider 健康摘要。
- `menu_bar_complete_quit`：renderer 在完成 shell cleanup 后确认执行 app quit。

**D-IPC-006 — OAuth 命令**

- `oauth_token_exchange`：交换 OAuth authorization code。
- `oauth_listen_for_code`：监听 redirect URI 回调。

支持 PKCE（codeVerifier）和 clientSecret 两种模式。

**Mod 本地命令** — 读取本地 manifest 和 entry 文件。**External Agent 命令** — agent token 管理和 action descriptor 同步。**Local AI 命令** — 懒加载的模型列表、安装、生命周期管理和审计：

**D-IPC-007 — Mod 本地命令**

Mod 本地持久化与审计命令集（`runtime_mod::commands`）：

- `runtime_mod_list_local_manifests`：列出 runtime mods 目录中的本地 mod 清单摘要。
- `runtime_mod_list_installed`：列出已安装 mod 清单。
- `runtime_mod_install` / `runtime_mod_update` / `runtime_mod_uninstall`：mod 安装生命周期命令。`runtime_mod_uninstall` 只卸载 package，不删除 `{nimi_data_dir}/mod-data/{mod_id}`。
- `runtime_mod_read_manifest`：读取已安装 mod manifest。
- `runtime_mod_install_progress`：查询安装进度事件。
- `runtime_mod_read_local_entry`：读取 mod 入口源码。
- `runtime_mod_read_local_asset`：读取 manifest 声明的本地 mod 图标资源，返回 `mimeType + base64`。
- `runtime_mod_append_audit` / `runtime_mod_query_audit` / `runtime_mod_delete_audit`：mod 审计记录 CRUD。
- `runtime_mod_get_action_idempotency` / `runtime_mod_put_action_idempotency` / `runtime_mod_purge_action_idempotency`：action 幂等性记录。
- `runtime_mod_get_action_verify_ticket` / `runtime_mod_put_action_verify_ticket` / `runtime_mod_delete_action_verify_ticket` / `runtime_mod_purge_action_verify_tickets`：action 验证票据。
- `runtime_mod_put_action_execution_ledger` / `runtime_mod_query_action_execution_ledger` / `runtime_mod_purge_action_execution_ledger`：action 执行账本。
- `runtime_mod_media_cache_put` / `runtime_mod_media_cache_gc`：mod 媒体缓存写入与垃圾回收。
- `runtime_mod_storage_file_read` / `runtime_mod_storage_file_write` / `runtime_mod_storage_file_delete` / `runtime_mod_storage_file_list` / `runtime_mod_storage_file_stat`：host-managed mod files 子树访问。
- `runtime_mod_storage_sqlite_query` / `runtime_mod_storage_sqlite_execute` / `runtime_mod_storage_sqlite_transaction`：host-managed per-mod sqlite 访问。
- `runtime_mod_storage_data_purge`：显式删除 `{nimi_data_dir}/mod-data/{mod_id}`，供 Mod Hub / Settings 发起数据清理动作。

存储边界固定如下：

- installed mod package 继续位于 `{nimi_data_dir}/mods`。
- mod 持久化数据固定位于 `{nimi_data_dir}/mod-data/{mod_id}`。
- `files` 仅允许访问 `files/` 子树，拒绝绝对路径、空路径、`..` 与符号链接越界。
- `sqlite` 仅允许访问 `sqlite/main.db`，并拒绝 `ATTACH`、`DETACH`、`VACUUM INTO`、`load_extension`。

**D-IPC-008 — External Agent 命令**

- `external_agent_issue_token`：签发 agent token。
- `external_agent_revoke_token`：吊销 agent token。
- `external_agent_list_tokens`：列出 agent tokens。
- `external_agent_sync_action_descriptors`：同步 action descriptors。
- `external_agent_complete_execution`：完成 action 执行。
- `external_agent_gateway_status`：获取 gateway 状态。
- `external_agent_verify_execution_context`：在 action dispatch 前校验 external agent 执行上下文。

**D-IPC-011 — Local Runtime 命令**

Local Runtime 桥接通过 `loadLocalRuntimeBridge()` 懒加载（`D-IPC-010`），命令集统一使用 `runtime_local_*` 前缀（`local_runtime::commands`）：

Local-runtime Tauri 命令使用 `runtime_local_assets_*` 前缀。旧 `runtime_local_models_*` / `runtime_local_artifacts_*` CRUD/lifecycle 命令不再注册，也不得作为 shipped helper 保留。例外：catalog 搜索命令保留 `runtime_local_models_catalog_*` 前缀（对应 proto `SearchCatalogModels` / `ResolveModelInstallPlan`，搜索对象是 model catalog entry 而非 asset inventory）：

- `runtime_local_assets_install` / `runtime_local_assets_install_verified`：asset 安装，权威执行面为 `RuntimeLocalService`。
- `runtime_local_assets_import` / `runtime_local_assets_import_file`：asset 导入，权威执行面为 `RuntimeLocalService`。
- `runtime_local_assets_remove` / `runtime_local_assets_start` / `runtime_local_assets_stop` / `runtime_local_assets_health`：asset 生命周期管理。
- `runtime_local_downloads_list` / `runtime_local_downloads_pause` / `runtime_local_downloads_resume` / `runtime_local_downloads_cancel`：传输管理。
- `runtime_local_services_list` / `runtime_local_services_install` / `runtime_local_services_start` / `runtime_local_services_stop` / `runtime_local_services_health` / `runtime_local_services_remove`：服务管理。
- `runtime_local_nodes_catalog_list`：节点目录。
- `runtime_local_models_catalog_list_variants`：host-local catalog helper；不得被视为模型清单、安装状态或 transfer 真源。
- `runtime_local_recommendation_feed_get`：host-local recommendation helper；install/import/download/lifecycle 真源仍是 `RuntimeLocalService`。
- `runtime_local_profiles_resolve` / `runtime_local_profiles_apply`：profile 解析与应用。
- `runtime_local_assets_reveal_in_folder` / `runtime_local_assets_reveal_root_folder`：在系统文件管理器中打开目录。
- `runtime_local_assets_scan_unregistered`：host-local intake helper。若产品路径已通过 runtime `ScanUnregisteredAssets` 获得同等结果，则前者不得再被当作权威扫描源。
- `runtime_local_pick_asset_manifest_path`：统一选取 `resolved/<local-asset-id>/asset.manifest.json`。
- `runtime_local_audits_list` / `runtime_local_append_inference_audit` / `runtime_local_append_runtime_audit`：host helper 命令保留仅为 tooling / bridge 对接；产品审计真相仍由 runtime 持有。
- `runtime_local_pick_asset_file`：选取任意待导入的 asset 文件。
- `runtime_local_device_profile_collect`：设备能力采集（CPU/GPU/NPU/disk/ports）。
- `runtime_local_models_catalog_search` / `runtime_local_models_catalog_resolve_install_plan` 若仍存在于 host helper 面，返回 payload 不得取代 runtime catalog/install-plan 真源。
- recommendation page 允许新增只读的 `runtime_local_recommendation_feed_get` surface，用于 capability-scoped candidate feed；install 仍必须复用现有 `resolve_install_plan` / install-plan payload，不得新增私有安装协议。
- `runtime_local_device_profile_collect` 返回的设备画像必须包含 `total_ram_bytes`、`available_ram_bytes`，以及 GPU `total_vram_bytes?`、`available_vram_bytes?`、`memory_model`。

产品约束：

- local asset inventory 的 list、verified list、install、import、remove、health/readiness、intake、transfer session 与 progress 必须固定走 `RuntimeLocalService` typed APIs。
- `Active Downloads` / `Active Imports` 必须来自 runtime-owned transfer plane（`ListLocalTransfers` + `WatchLocalTransfers`），不得再以 Tauri `runtime_local_downloads_*` 或 `local-runtime://download-progress` 为真源。
- Tauri `runtime_local_*` 命令若仍存在于 shipped app，只能作为 shell-native/helper IPC；不得暴露或暗示 Desktop/Tauri local runtime state 是本地模型真源。
- Desktop Local Model Center 不得再暴露手动 start/stop toggle；本地模型 readiness 必须直接反映 runtime 状态。
- 自动纳管只适用于 go-runtime 已有结构化 local model record 的模型，以及 verified/catalog/manual-download 已携带显式 declaration 的 intake 来源。
- 用户直接 copy 到 `~/.nimi/models` 的裸文件必须统一进入 `runtime_local_assets_scan_unregistered` intake：
  - 根目录或未知目录文件不得静默纳管；
  - 识别到 typed folder（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `ae` / `clip` / `controlnet` / `lora` / `auxiliary`）时，可视为 high-confidence declaration；
  - high-confidence 且 declaration 完整的项允许自动导入；
  - low-confidence 项只允许预填 review UI，不得静默注册。
- recommendation 审计仅覆盖 request-driven resolve 面，不覆盖 installed list 之类的被动刷新：
  - `runtime_local_models_catalog_search`
  - `runtime_local_models_catalog_list_variants`
  - `runtime_local_models_catalog_resolve_install_plan`
  - `runtime_local_assets_scan_unregistered`
  - `runtime_local_recommendation_feed_get`
- 上述入口的 recommendation 解析沿现有 local runtime audit 面记录：
  - `recommendation_resolve_invoked`
  - `recommendation_resolve_completed`
  - `recommendation_resolve_failed`
- `runtime_local_recommendation_feed_get` 的 completed event 允许采用 feed-scoped 聚合 payload：
  - `itemId = recommend-feed:<capability>`
  - `modelId = null`
  - `source = model-index-feed`
  - 可追加 `itemCount` 与 `cacheState`

执行命令：

- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`

### 10.3 状态管理：四个 Zustand Slice

Desktop 的应用状态采用 Zustand slice 架构。为什么不用 Redux 或 Context？因为各业务域（Auth、Runtime、Mod、UI）的状态生命周期完全不同——Auth 状态跨 session 持久化，Runtime 状态在 daemon 重启时重置，Mod 状态随 workspace 动态增减，UI 状态纯临时。Slice 架构让每个域独立声明自己的状态和操作，最终通过无 middleware 的组合注入全局 store。

**D-STATE-001 — Auth Slice**

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

**D-STATE-002 — Runtime Slice**

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（provider、model 与可透传的 runtime execution context 字段）
- `runtimeDefaults: RuntimeDefaults | null`
- `localManifestSummaries`、`registeredRuntimeModIds`、`runtimeModDisabledIds`
- `runtimeModUninstalledIds`、`runtimeModSettingsById`、`runtimeModFailures`
- `fusedRuntimeMods`（熔断记录）

`localManifestSummaries` 的来源固定为 runtime mods 安装目录；Desktop 不扫描源码仓作为发现输入。

初始 `RuntimeFieldMap`：
- `targetType: ''`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: ''`

`RuntimeFieldMap` 必须保持 string-keyed extensible map 语义；Desktop 可以预置核心字段，但不得将额外 runtime field key 视为非法。Desktop core 不得预置 Agent chat launcher 语义；Agent chat 相关字段仅允许作为 mod-owned runtime context 透传。

`runtimeFields` 的 route-related 字段在 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）下只允许作为 execution projection / transient input；不得继续承担 selection truth、projection truth 或 thread-global route owner 语义。

**D-STATE-003 — Mod Workspace Slice**

`createModWorkspaceSlice` 管理 mod 工作区：

- `modWorkspaceTabs: ModWorkspaceTab[]`（`tabId: 'mod:${modId}'`、`title`、`fused`）
- 操作：`openModWorkspaceTab`、`closeModWorkspaceTab`
- `modWorkspaceTabs` 中存在的条目即表示 Desktop host 视为“已打开”的 mod route runtime instance

`tabId` 是当前 Desktop route runtime identity。任何公开的 route lifecycle 或 route retention 语义都必须以 `tabId` 为作用域，而不是 `modId`。

Desktop host 对 mod workspace tab 的产品规则固定为：

- 同时最多允许 `5` 个已打开的 mod workspace tabs
- 当第 `6` 个不同的 mod tab 打开请求到达时，host 必须拒绝该请求，不得隐式关闭、替换或卸载已有 tab
- 若目标 `tabId` 已经处于已打开集合中，host 必须激活已有 tab，而不是将该请求视为超限失败
- 只要 mod tab 仍处于已打开集合中，普通 tab 切换不得导致 host 自动卸载对应 route instance
- route instance 的销毁仅允许由用户关闭 tab、mod 被禁用/卸载、或 host 明确执行销毁触发

**D-STATE-004 — UI Slice**

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`previousTab: AppTab | null`
- `selectedChatId`、`selectedProfileId`、`selectedProfileIsAgent`、`selectedWorldId`
- `profileDetailOverlayOpen`：共享资料详情弹层占据主内容区时为 `true`，shell 左 rail 需要隐藏
- `statusBanner: StatusBanner | null`
- `bootstrapReady: boolean`、`bootstrapError: string | null`

导航操作：`setActiveTab`、`navigateToProfile`、`navigateToWorld`、`navigateBack`。

四个 slice 通过 `useAppStore` 合并为单一 Zustand store，不使用 middleware（immer、persist 等）——状态更新直接用 `set()` 替换，保持调试透明性：

**D-STATE-005 — Store 组合**

所有 slices 通过 `create<AppStoreState>` 合并为单一 Zustand store `useAppStore`。

- 不使用 middleware（无 devtools、persist）— Tauri webview 环境下 Zustand middleware 与 HMR 热替换存在兼容性问题；持久化通过 Tauri backend IPC（`D-IPC-001`）和 DataSync 热状态（`D-DSYNC-000`）实现，无需 Zustand persist middleware。
- 热状态通过 `globalThis` 键保持 HMR 连续性（参考 `D-DSYNC-000`）。

### 10.4 认证会话：Desktop 与 Web 的分歧

认证会话管理是 Desktop 和 Web 唯一出现**根本性分歧**的领域。两者共享同一个状态机（`bootstrapping → authenticated | anonymous`），但 token 的存储策略完全不同：Desktop 通过 Tauri secure store（OS 级密钥链）持久化 token，Web 使用 localStorage 加过期机制。

```
Auth 状态机
─────────────────────────────────────────────────
             ┌──────────────┐
             │ bootstrapping│
             └──────┬───────┘
                    │ token exchange / check
           ┌────────┴────────┐
           ▼                 ▼
  ┌──────────────┐   ┌────────────┐
  │authenticated │   │ anonymous  │
  └──────┬───────┘   └──────┬─────┘
         │ logout/expire    │ login
         └──────────────────┘
```

**D-AUTH-001 — Session Bootstrap**

`bootstrapAuthSession` 在启动序列中执行（`D-BOOT-007`）。

- Desktop 冷启动解析顺序固定为：
  - `runtime_defaults.realm.accessToken` 若存在，则仅作为本次运行的显式 override。
  - 否则调用共享 Tauri IPC `auth_session_load` 读取 `~/.nimi/auth/session.v1.json`。
  - 两者都缺失时进入匿名启动。
- 输入：`flowId`（追踪 ID）、resolved bootstrap session（`accessToken`、`refreshToken?`、source=`env|persisted|anonymous`）。
- 成功时：设置 `auth.status = 'authenticated'`、存储 token。
- 失败时：设置 `auth.status = 'anonymous'`、清除 token；若 source=`persisted` 且为 401 / decrypt / schema 失败，则必须调用 `auth_session_clear` 清空共享持久会话。

**D-AUTH-002 — Token 持久化（Desktop）**

Desktop 环境的长期会话真源是共享 Tauri backend auth session 存储：

- 路径：`~/.nimi/auth/session.v1.json`。
- 记录：`schemaVersion`、`realmBaseUrl`、`user`、`updatedAt`、`expiresAt`、`accessTokenCiphertext`、`refreshTokenCiphertext?`。
- 获取：renderer 只通过 `auth_session_load` 读取已解密的 normalized session；`runtime_defaults` 不作为 bearer token 的长期持久化渠道。
- 更新：登录成功、2FA 完成、OTP 完成、wallet 登录成功、SDK `onTokenRefreshed`、DataSync proactive refresh 成功后，必须立即调用 `auth_session_save` 原子覆盖整个会话。
- 清除：logout、refresh 失败、bootstrap unauthorized、schema/decrypt 失败时必须调用 `auth_session_clear`。
- `DataSyncHotState` 与 Zustand store 只是进程内 / HMR 缓存，不是 desktop 长期持久化真源。

**D-AUTH-003 — Token 持久化（Web）**

Web 环境只通过浏览器存储持久化非敏感会话元数据：

- 获取：从 localStorage 读取用户投影与过期元数据；raw access token 不从浏览器持久化存储恢复。
- 更新：仅写入 user/expiresAt/updatedAt 等非敏感字段。
- 清除：删除 localStorage 条目。

状态机的转换规则是确定性的：`bootstrapping` 只能到 `authenticated` 或 `anonymous`，`authenticated` 可因 logout/过期回退到 `anonymous`，`anonymous` 可通过 login 转为 `authenticated`。

**D-AUTH-004 — Auth 状态机**

```
bootstrapping → authenticated  (token 有效)
bootstrapping → anonymous      (token 无效或缺失)
authenticated → anonymous      (logout 或 token 过期)
anonymous     → authenticated  (login 成功)
```

**跨层映射**：

| Desktop 状态 | Realm SDK 行为 | Runtime 层关系 |
|---|---|---|
| `bootstrapping` | Realm SDK `connect()` / token 获取 | Runtime 无活跃请求（Desktop 尚未开始调用） |
| `authenticated` | Realm SDK session active，维护 `auth.accessToken` 最新值 | Runtime SDK 调用时自动注入 `Authorization: Bearer <realm_access_token>`，Runtime K-AUTHN-001~008 验证请求合法性 |
| `anonymous` | Realm SDK 无 token，仅公开 API 可用 | Runtime 拒绝需认证的 RPC（`UNAUTHENTICATED`） |

**Desktop 与 RuntimeAuthService 的关系**：

Desktop **不直接使用** RuntimeAuthService（K-AUTHSVC-001~013）的 `OpenSession` / `RefreshSession` / `RevokeSession`。Desktop 认证 token 来自 Realm 后端（通过 Realm SDK REST 调用获取），而非 Runtime daemon 的 session 管理。RuntimeAuthService 的 session 管理面向以下场景：

- 外部 Agent 通过 SDK 建立 Runtime session（K-AUTHSVC-006、RegisterExternalPrincipal）
- 独立 SDK 消费者（非 Desktop）直接与 Runtime 交互

Runtime 对 Desktop 请求的认证路径：Desktop 持有 Realm SDK session token → Runtime SDK 在每次调用前读取最新 token 并注入 `Authorization: Bearer <realm_access_token>` → Runtime gRPC metadata `authorization` → K-AUTHN-001~008 token 验证拦截器。此 token 由 Realm 后端签发，Runtime 仅做 claims 校验，不管理其生命周期。

**AppMode 声明**（K-AUTHSVC-009）：Desktop 使用 `AppMode=FULL`、`WorldRelation=RENDER` 注册（K-AUTHSVC-010）。`FULL` 模式允许同时访问 `runtime.*` 和 `realm.*` 域。若注册时使用错误的 AppMode，Runtime 返回 `APP_MODE_DOMAIN_FORBIDDEN`（D-ERR-007 映射表兜底处理）。

**RegisterApp 调用路径**：Desktop 通过 SDK Runtime client 在 bootstrap 阶段（D-BOOT-004）调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。此调用属于 Runtime SDK 高阶方法透传，不等同于 Desktop 直接使用 RuntimeAuthService 的 session 管理方法（OpenSession/RefreshSession/RevokeSession）。

- **调用时机**：D-BOOT-004 Runtime Host Assembly 完成 gRPC 连接后、D-BOOT-007 Auth Session 引导前。
- **失败处理**：进入 D-BOOT-008 错误路径，`bootstrapReady=false`。
- **参数来源**：`appMode` 和 `worldRelation` 由 Desktop 编译时确定（非用户配置）。

认证状态变更驱动数据同步：DataSync 监听 `authChange` 事件，认证成功时同步 token 并启动 polling，认证失效时停止 polling 并清除缓存。这是启动序列（10.1）和数据同步（10.5）之间的关键连接点。

**D-AUTH-005 — Auth 事件联动**

DataSync 监听 `authChange` 事件：

- `isAuthenticated = true`：调用 `setToken(auth.token)`。
- `isAuthenticated = false`：清空 token，停止所有轮询。

### 10.5 数据同步：十二条独立流

数据同步是 Desktop 最庞大的子系统——12 个业务流域，每个都有独立的触发条件、缓存策略和错误处理。为什么不用一个统一的"sync all"？因为各域的数据生命周期截然不同：Chat 需要 polling + outbox 实时推送，Notification 只需定时拉取，Economy 需要精确的余额一致性。

12 个流域共享 6 项基础设施：API init 初始化、hot state 同步、context lock 防并发、polling 调度、error log 记录、facade delegate 委托。这意味着每个流域只需声明"拉什么"和"怎么缓存"，基础设施自动处理重试和错误收集。

**D-DSYNC-001 — Auth 数据流**

认证流方法：`login`、`register`、`logout`。

- 使用基础设施：上下文锁、错误日志。
- `login`/`register` 成功后通过 `setToken()` 更新热状态和 store。
- `logout` 触发 `clearAuth()` + `stopAllPolling()`。

**D-DSYNC-002 — User 数据流**

用户资料读写方法：`loadCurrentUser`、`updateUserProfile`、`loadUserProfile`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- `loadCurrentUser` 在 `loadInitialData()` 中首先执行。

**D-DSYNC-003 — Chat 数据流**

聊天数据流方法：`loadChats`、`loadMoreChats`、`startChat`、`loadMessages`、`loadMoreMessages`、`sendMessage`、`syncChatEvents`、`flushChatOutbox`、`markChatRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志、初始数据加载。
- `syncChatEvents` 通过 `PollingManager` 定期轮询。
- `flushChatOutbox` 处理离线消息队列。

Chat 流域是最复杂的：它结合了 polling（定时拉取会话列表和未读计数）和 outbox（消息先写入本地 outbox，异步 flush 到服务器）。消息发送失败时保留在 outbox 中等待重试，不丢弃。

**领域数据流**

**D-DSYNC-004 — Social 数据流**

社交数据流方法：`loadContacts`、`loadSocialSnapshot`、`searchUser`、`requestOrAcceptFriend`、`rejectOrRemoveFriend`、`removeFriend`、`blockUser`、`unblockUser`、`loadFriendRequests`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- 辅助方法：`isFriend(userId)` 在 contacts 状态中检查好友关系。

**D-DSYNC-005 — World 数据流**

世界数据流方法：`loadWorlds`、`loadWorldDetailById`、`loadWorldAgents`、`loadWorldDetailWithAgents`、`loadWorldSemanticBundle`、`loadWorldEvents`、`loadWorldLorebooks`、`loadWorldResourceBindings`、`loadMainWorld`、`loadWorldLevelAudits`。

- 使用基础设施：上下文锁、错误日志。
- `loadWorldSemanticBundle` 返回的 `worldview.coreSystem.rules` 必须是 ordered rule item array（`key / title / value`），不得回退为 JSON object map。
- creator audit 读取统一来自 `WorldStateDto.items` 与 `WorldHistoryListDto.items`；Desktop 不再定义独立 world mutation 读取面。

**D-DSYNC-006 — Economy 数据流**

经济数据流方法：

- 余额：`loadCurrencyBalances`
- 交易：`loadSparkTransactionHistory`、`loadGemTransactionHistory`
- 订阅：`loadSubscriptionStatus`
- 充值：`loadSparkPackages`、`createSparkCheckout`
- 提现：`loadWithdrawalEligibility`、`loadWithdrawalHistory`、`createWithdrawal`
- 礼物：`loadGiftCatalog`、`loadReceivedGifts`、`sendGift`、`acceptGift`、`rejectGift`、`createGiftReview`

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-007 — Feed 数据流**

社交 feed 方法：`loadPostFeed`、`createPost`、`createImageDirectUpload`、`createVideoDirectUpload`、`finalizeResource`。

- 使用基础设施：上下文锁、错误日志。
- `createImageDirectUpload` / `createVideoDirectUpload` 返回 `ResourceDirectUploadSessionDto` 语义：
  - `resourceId` 可用于后续 `createPost` 写入 `attachments[].targetId`
  - `storageRef` 是 provider 传输层引用，仅供上传 transport 路径使用，不得作为新 post 的附件主键
- `finalizeResource` 在 S3 直传完成后调用，将资源状态从 PENDING 转为 READY；
  调用前后均不需要写入资源 URL，仅通过 `resourceId` 引用资源
- `createPost` 的 post attachment 写入规则：
  - `attachments[]` 采用 canonical attachment envelope，正式字段为 `targetType + targetId`
  - 资源上传快捷路径写入 `targetType='RESOURCE'` 且 `targetId=resourceId`
  - 不通过 `resource-bindings` 反查资源
  - 不再写入 `resourceId` / `assetId` / `imageId` / `videoId` / `uid` / `key`

**D-DSYNC-008 — Explore 数据流**

探索发现方法：`loadExploreFeed`、`loadMoreExploreFeed`、`loadAgentDetails`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-009 — Notification 数据流**

通知方法：`loadNotificationUnreadCount`、`loadNotifications`、`markNotificationsRead`、`markNotificationRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志。
- `loadNotificationUnreadCount` 通过 `PollingManager` 定期轮询。

**D-DSYNC-010 — Settings 数据流**

设置方法：`loadMySettings`、`updateMySettings`、`loadMyNotificationSettings`、`updateMyNotificationSettings`、`loadMyCreatorEligibility`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-011 — Agent 数据流**

Agent 方法：`loadMyAgents`。

- Agent LLM 相关的聊天路由与记忆读取不属于 Desktop core product DataSync contract。
- mods 如需 Agent chat route / memory，必须通过 desktop host 注册的 data capability 获取，而不是通过 DataSync facade。
- host memory capability 采用 cache-only 语义：只有本地已缓存并满足请求的 slice/stats 才允许返回 `local-index-only`；否则必须依赖远端成功结果。
- host memory capability 在缺少 `agentId` / `entityId`、远端失败、或无法完成 recall/backfill 时必须 fail-close，不得返回空数组、空 recall 结果、或基于本地 slice 合成统计。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-012 — Transit 数据流**

世界穿越方法：`startWorldTransit`、`listWorldTransits`、`getActiveWorldTransit`、`startTransitSession`、`addTransitCheckpoint`、`completeWorldTransit`、`abandonWorldTransit`。

- 使用基础设施：上下文锁、错误日志。

### 10.6 Hook 能力模型：五子系统与五级信任

Hook 系统是 Mod 扩展 Desktop 的唯一合法途径。它定义了 5 个子系统，覆盖事件通信、数据查询、对话轮次干预、UI 注入和跨 Mod 调用五个扩展面。

在具体子系统之前，先理解两个基础机制。**Capability Key 格式**采用点分隔命名（`subsystem.action.target`），支持 `*` 通配符匹配和批量匹配。**Source-Type 权限网关**定义了 5 种来源信任层级，从最高到最低：

```
信任层级（权限只减不增）
─────────────────────────────────────────────────
Level 5   core        平台内置核心组件     — 完全能力
Level 4   builtin     官方预装 Mod        — 接近完全
Level 3   injected    运行时注入的组件     — 受限能力
Level 2   sideload    开发者侧载          — 最小能力
Level 1   codegen     AI 生成的代码       — 最受限
```

每种 source type 有对应的 capability allowlist，权限只能沿信任层级递减，不能通过任何机制提升。

**D-HOOK-006 — Inter-Mod 子系统**

跨 mod RPC 通信：

- `inter-mod.request.<channel>`：发送请求到指定通道。
- `inter-mod.provide.<channel>`：在指定通道提供服务。
- `builtin` 支持 request + provide，其他 source types 仅支持 request。

**D-HOOK-007 — Capability Key 格式**

Capability key 采用点分层级格式：`<subsystem>.<action>.<target>`。

- 归一化：`normalizeCapabilityKey()` — trim 空白。
- 匹配：`capabilityMatches(pattern, key)` — 支持 `*` wildcard。
- 批量匹配：`anyCapabilityMatches(patterns, key)` — 任一模式匹配即通过。

在此基础上，5 个子系统各覆盖一个扩展面：

**Event 子系统** — pub/sub 事件总线，能力键 `event.publish.*` / `event.subscribe.*`。**Data 子系统** — 数据查询和注册，能力键 `data.query.*` / `data.register.*`，sideload 来源限制为 query-only。

**D-HOOK-001 — Event 子系统**

Pub/sub 事件总线：

- `event.publish.<topic>`：发布事件到指定主题。
- `event.subscribe.<topic>`：订阅指定主题事件。
- 所有 source types 均支持 `event.publish.*`，但 `sideload` 不支持 subscribe。

**D-HOOK-002 — Data 子系统**

共享数据能力注册与查询：

- `data.query.<name>`：查询已注册的数据能力。
- `data.register.<name>`：注册新的数据能力。
- `sideload` 仅支持 query，不支持 register。

**Turn 子系统** — 对话轮次 hook，4 个注入点（pre-policy → pre-model → post-state → pre-commit），source type 限制注入点访问。**UI 子系统** — 8 个预定义 slot 的组件注册，codegen 来源有前缀限制。**Inter-Mod 子系统** — 跨 Mod 的 RPC 通信（`inter-mod.request.*` / `inter-mod.provide.*`）。

**D-HOOK-003 — Turn 子系统**

AI 对话生命周期拦截点：

- `turn.register.<point>`：注册到指定 hook point。
- 4 个 hook points（按执行顺序）：`pre-policy` → `pre-model` → `post-state` → `pre-commit`。
- `injected` source type 仅允许 `pre-model` 和 `post-state`。
- `sideload` 和 `codegen` 不允许 turn hook。

**与 Runtime 拦截器链的时序关系**：Turn hook 在 renderer 进程执行，时序先于 SDK 发送请求到 Runtime。Runtime K-DAEMON-005 拦截器链（version → lifecycle → protocol → authn → authz → audit，共 6 层）在 daemon 收到请求后执行。两层无重叠：Desktop turn hook 负责请求编排（策略门控、模型选择、状态更新、提交确认），Runtime 拦截器负责请求验证（版本协商、健康门控、幂等性、身份认证、授权、审计）。

**D-HOOK-004 — UI 子系统**

UI 扩展槽位注册：

- `ui.register.<slot>`：注册 UI 组件到指定槽位。
- 8 个预定义槽位（参考 `tables/ui-slots.yaml`）。
- `codegen` 仅允许 `ui-extension.app.*` 前缀的槽位。

**边界说明**：

- `ui.register(...)` 的扩展载荷必须保持声明式；Desktop host 可以将其解释为 same-tree render 或未来的 isolated render，但该解释方式不属于公开 contract。
- `ui.register(...)` 不得被视为“mod 可直接注入 shared React tree”的承诺。
- route tab identity 在 Desktop host 中固定使用 `tabId`；route visibility / retention / lifecycle 由 host 管理，不属于 hook payload 本身。

**D-HOOK-005 — Storage 子系统**

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

Hook 系统还提供两个共享能力域：**LLM Capability** 覆盖文本/图像/视频/嵌入生成和语音操作，**Action Capability** 覆盖 discover/dry-run/verify/commit 操作：

**D-HOOK-008 — Source-Type 权限网关**

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

**D-HOOK-009 — Runtime Capability 域**

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

### 10.7 Mod 治理：八阶段执行内核

Mod 的生命周期不是简单的"安装 → 运行"——它是一条 8 阶段的逐级过滤管道。每个阶段独立做出 ALLOW / ALLOW_WITH_WARNING / DENY 决策，并产出 decision record。阶段之间无跳过——即使前面的阶段全部通过，后面的阶段仍然独立评估。

```
Mod 8 阶段执行管道
─────────────────────────────────────────────────
① Discovery   — 定位包 + 验证来源引用
       ↓ ALLOW
② Manifest    — 解析清单 + 版本兼容检查
       ↓ ALLOW
③ Signature   — 签名验证 + 签署者身份确认
       ↓ ALLOW（local-dev/sideload 跳过）
④ Dependency  — 依赖解析 + 构建产物
       ↓ ALLOW
⑤ Sandbox     — 能力策略评估 + 沙箱约束
       ↓ ALLOW / ALLOW_WITH_WARNING
⑥ Load        — 加载入口源 + 在沙箱中执行注册
       ↓ ALLOW
⑦ Lifecycle   — enable / disable / uninstall / update
       ↓ 状态转换（支持 rollback）
⑧ Audit       — 写入 decision record + 本地审计
```

2 种 access mode 决定了每个阶段的验证严格度：`sideload` 面向已安装用户 mod，跳过签名但限制能力；`local-dev` 仅用于显式本地开发，会放宽调试限制但不能被远程分发元数据提升权限。

**D-MOD-001 — Discovery 阶段**

定位 mod 包并验证源引用：

- 输入：`DiscoverInput`（modId、version、mode、source）。
- 验证：source ref 存在性、mod ID 格式。
- 成功：状态 → `DISCOVERED`。

**D-MOD-002 — Manifest/Compat 阶段**

解析清单并检查兼容性：

- 解析 `ModManifest`（id、version、capabilities、dependencies、entry、styles、iconAsset?）。
- `permissions` 字段已硬切退役；manifest/runtime registration 只允许 `capabilities`，不得保留 legacy permissions alias。
- 检查 `nimi.minVersion` / `nimi.maxVersion` 约束。
- `styles[]` 如存在，必须是包内相对路径，并在 load/unload 生命周期中由 host 注入和回收。
- `iconAsset` 如存在，必须是包内相对 SVG 路径；不得是 URL、绝对路径或 `..` 逃逸路径。
- 失败：输出决策记录，不进入下一阶段。

执行命令：

- `pnpm check:no-legacy-mod-permissions-field`

**D-MOD-003 — Signature/Auth 阶段**

验证 mod 来源元数据与供应链声明：

- `local-dev` mode：跳过 catalog release 校验，按本地开发信任模型执行。
- `sideload` mode：手动 path / URL 安装仍可跳过 catalog gate，但不得获得额外 capability 特权。
- `catalog` mode：必须在安装前校验 digest、signature、compatibility、revocation；失败直接拒绝。
- 发布者、digest、signature、catalog provenance 不得提升 capability 白名单，只影响安装许可、审计和 UI 风险提示。
- 成功：状态 → `VERIFIED`。

**信任假设**：本地文件系统仍按 `local-dev` / `sideload` 信任模型执行；GitHub-first catalog 额外提供 release sidecar、digest、signature、revocation gate，但不会形成 capability 特权模式。

**D-MOD-004 — Dependency/Build 阶段**

解析依赖并验证预构建 mod 包：

- 解析 `manifest.dependencies` 列表。
- 验证所有依赖已注册或可用。**（Phase 2 detail — Phase 1 mod 无跨 mod 依赖，此阶段执行空依赖校验后直接通过）**
- Desktop 安装流只接受预构建目录或 `.zip` 包，不接受源码仓 tarball 或在 host 侧执行构建。
- catalog 发布必须同时提供 sidecar `release.manifest.json` 作为签名与版本校验对象。
- 若 manifest 声明 `iconAsset`，打包与 catalog 发布必须携带对应静态 SVG 资产；Desktop 不得内置特定 mod 图标作为替代真相源。
- 成功：状态 → `INSTALLED`。

阶段 ⑤ 的沙箱策略评估是安全核心：它根据 Mod 声明的 capability 需求和 source type 的 allowlist 做交叉匹配，超出允许范围的能力请求直接 DENY。

**D-MOD-005 — Sandbox/Policy 阶段**

评估 capability 策略和沙箱约束：

- 解析 `requestedCapabilities`。
- 根据 `sourceType` → `AccessMode` 映射查找允许的能力白名单（参考 `D-HOOK-008`）。
- Grant ref 验证（如提供 `grantRef`）。
- 决策结果：`ALLOW`、`ALLOW_WITH_WARNING`、`DENY`。

**正交性说明**：Mod capability 检查是 renderer 本地门控，在 mod 调用 SDK 方法前执行。此机制与 Runtime K-GRANT token 授权正交——即使 mod 通过 Desktop capability 检查，其 SDK 请求仍需通过 Runtime K-DAEMON-005 authz 拦截器的 token 验证。两层各自独立执行，不存在绕过关系。

**D-MOD-006 — Load 阶段**

加载 mod 入口到运行时上下文：

- 读取 `manifest.entry` 指向的源码。
- 如声明 `manifest.styles[]`，host 必须在 mod 启用时注入样式、在禁用/卸载时回收样式。
- 如声明 `manifest.iconAsset`，host 只可读取该 manifest 明确声明的图标资源用于展示；不得扫描仓目录或内置官方 mod 图标表。
- 在沙箱环境中执行 mod 注册。

**D-MOD-007 — Lifecycle 阶段**

执行生命周期迁移：

- `enable`：`INSTALLED` / `DISABLED` → `ENABLED`
- `disable`：`ENABLED` → `DISABLED`
- `uninstall`：`INSTALLED` / `DISABLED` → `UNINSTALLED`
- `update`：`ENABLED` → `UPDATING` → `ENABLED`（注册失败时必须尝试回滚到上一已安装版本；失败时 → `ROLLBACK_DISABLED`）
- catalog install/update 如命中 `community` trust tier、trust tier 降级、capability 增量或 advisory review，必须返回结构化 `consentReasons[]`；其中 capability 增量必须返回 `addedCapabilities[]`
- 满足上述 re-consent 条件时，安装产物可落盘，但 Desktop 不得自动重新启用 mod，必须等待用户重新确认

每个阶段的决策结果有三种语义：`ALLOW` 无条件通过，`ALLOW_WITH_WARNING` 通过但记录警告（提示用户注意），`DENY` 阻止并终止管道。审计阶段将完整的 decision record 链写入本地存储。

**D-MOD-008 — Audit 阶段**

写入审计决策记录：

- `DecisionRecord`：decisionId、modId、version、stage、result、reasonCodes、createdAt。
- `LocalAuditRecord`：id、modId、stage、eventType、decision、reasonCodes、payload、occurredAt。
- 每个 kernel stage 完成后必须产出至少一条审计记录。

**D-MOD-009 — Access Mode / Catalog Governance 策略**

2 种 runtime access mode 与 1 条 catalog 安装治理路径的能力约束：

| Mode | 签名要求 | 能力白名单映射 | 信任级别 |
|---|---|---|---|
| `local-dev` | 无 | 按 sourceType 查表 | high |
| `sideload` | 无 | `sideload` 白名单 | low |
| `catalog` | digest/signature/revocation 校验必需 | 不提升 capability privilege；安装后仍映射到 `sideload` 白名单 | low |

**D-MOD-010 — Decision Result 语义**

- `ALLOW`：通过，进入下一阶段。
- `ALLOW_WITH_WARNING`：通过但记录警告 reason codes。
- `DENY`：拒绝，终止流水线，记录拒绝原因。

### 10.8 LLM 适配器与语音引擎

Desktop 的 LLM 层有一个关键设计决策：**不直接调用外部 AI API**。所有 AI 推理——无论是 OpenAI、Gemini 还是本地 Qwen——全部通过 SDK 的 Runtime 接口执行。Desktop 只在 Runtime 之上添加三层本地增强：provider 适配（路由到正确的 Runtime 方法）、Connector 凭据路由（通过 `connector_id` 路由到 Runtime ConnectorService 管理的凭据）、本地模型健康检查（验证 endpoint 可达性和模型状态）。

这意味着 Desktop 层面的 LLM 代码量极小——路由决策通过 `resolveChatRoute` 确定执行模式，凭据通过 `connector_id` 委托 Runtime 管理而非本地持有，健康检查通过 `checkLocalLlmHealth` 在推理前执行。

**D-LLM-001 — Provider 适配层**

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

**D-LLM-002 — 路由策略**

执行内核 turn 路由：

- Desktop core product 不拥有 Agent chat route API，也不得在 DataSync / launcher / fallback policy 中内建 Agent 聊天路由。
- mods 如需 Agent 聊天路由，必须通过 desktop host 的 data capability `data-api.core.agent.chat.route.resolve` 查询目标 agent 和 provider。
- `data-api.core.agent.chat.route.resolve` 必须 fail-close：缺少 `agentId`、控制面请求失败、或返回 payload 非法时直接报错；Desktop host 不得合成本地 `LOCAL/AGENT_LOCAL` 成功路由。
- `AgentEffectiveCapabilityResolution` 的唯一 authority home 是 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）定义的 shared builder；setup / submit / runtime 不得各自重算一份 agent route truth。
- `ExecuteLocalTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

**D-LLM-003 — Connector 凭据路由**

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 body 传递 `connectorId`（S-TRANSPORT-002）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、K-CONN-001（spec/runtime/connector.md）。

**D-LLM-004 — 本地 LLM 健康检查**

`checkLocalLlmHealth` 验证本地引擎可用性：

- 对 local `text.generate` / `text.embed`，必须先解析到 `RuntimeLocalService` authoritative local model record；health/status/readiness 以 runtime local model list/status 为真源。
- host-local snapshot、推荐 feed、或 route config 中残留的 `localProviderModel` 只可补充展示元数据，不得单独构成 healthy/sendable 结论。
- local text 路径中，`goRuntimeStatus in {active, installed}` 可视为可执行或可 warm-on-demand；`degraded / unavailable / unhealthy / removed / missing` 必须 fail-close 为 unreachable。
- local `llama` text 健康检查不得仅靠 `GET /v1/models` 2xx 判定 healthy。
- media / speech 路径继续遵循各自的 canonical endpoint 探测协议。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。对 local text，它消费 runtime authoritative local model state，而不是复制一套 host-side probe truth；对 media/speech，它仍遵循 `K-LENG-007` 的 engine-specific 协议进行 endpoint 探测。缺 endpoint 或缺 runtime authoritative local record 时必须直接视为未配置/不可达，不得伪造 loopback fallback。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

语音引擎集成遵循相同的"不绕过 Runtime"原则。Desktop 通过 Hook 注册语音能力（7 个 speech capability keys），设置 fetch/route resolver，最终仍通过 Runtime 执行语音推理。本地 AI 推理事件通过 `LocalAiInferenceAuditPayload` 记录，包含 eventType 和 source 追踪。

**D-LLM-005 — 语音引擎集成**

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

**D-LLM-006 — 本地 AI 推理审计**

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

### 10.9 UI Shell 与导航体系

UI Shell 定义了 Desktop 的视觉骨架：两栏布局（可折叠侧边栏 + 内容面板），3 组导航（Core Nav 6 项 + Quick Nav 1 项 + Detail Tab），以及 lazy-load 代码分割策略。

**D-SHELL-001 — 导航 Tab 体系**

导航由 `navigation-config.tsx` 定义，分为三组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、contacts、world、explore、runtime（gated）、settings
2. **Mod Nav**（sidebar puzzle icon）：mods（gated by `enableModUi`）— 点击直接进入 Mod Hub
3. **Detail Tab**：profile、agent-detail、world-detail、notification、gift-inbox、privacy-policy、terms-of-service

Feature flag 门控：
- `enableRuntimeTab` 控制 runtime tab 可见性。
- `enableModUi` 控制 mods tab 可见性（sidebar puzzle icon + guard clause）。

Mod 通过 feature flag 控制组件渲染和 workspace tab，通过 slot 注入扩展 UI：

**D-SHELL-002 — Mod UI 扩展**

Mod UI 通过 feature flag 门控：

- `enableModUi`：启用 mod 组件渲染 + Mods Panel + sidebar puzzle icon。
- `enableModWorkspaceTabs`：启用 mod workspace tab 管理。
- `enableSettingsExtensions`：启用 settings panel 扩展区域。

Mods Panel（`features/mods/mods-panel.tsx`）直接承载单页 Mod Hub：
- 侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。
- `Mods` 打开后直接展示 Mod Hub，而不是旧的双视图结构。
- Mod Hub 统一负责发现、安装、更新、启用、禁用、卸载，以及通过 `Open Mods Folder` 暴露本地 installed mods 目录入口。
- Disable / Uninstall 当前激活 mod 时 fallback 到 `'mods'` tab。
- Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

`ui-extension.app.sidebar.mods` slot 仍可供 mods 注册额外导航项（参考 `D-HOOK-004`）。

窗口管理支持原生拖拽（Desktop 通过 `enableTitlebarDrag` 启用，Web 不适用）。布局结构使用 `MainLayoutView` 两栏布局，侧边栏可折叠，内容面板根据导航状态映射。图标系统通过 `renderShellNavIcon` 提供 inline SVG 图标，未知 tab 回退到 puzzle 图标。

**D-SHELL-003 — 窗口管理**

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。
- `enableMenuBarShell`：启用 macOS menu bar 顶栏入口（desktop macOS only）。关闭主窗口时的 hide-vs-quit 语义由 `D-MBAR-005` 定义。

**D-SHELL-006 — 布局结构**

`MainLayoutView` 定义两栏布局：

- **左侧 sidebar**：可折叠，包含 core nav + mod nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatPage`
- `contacts` → `ContactsPanel`
- `world` → `WorldList`
- `explore` → `ExplorePanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfilePanel`（承载共享 profile detail surface）
- `gift-inbox` → `GiftInboxPanel`（礼物交易列表与详情入口，作为 full-page detail route）
- `runtime` → `RuntimeView`
- `mods` → `ModsPanel`（gated by `enableModUi`）
- `mod:*` → `ModWorkspacePanel`

**D-SHELL-007 — 图标系统**

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、contacts、explore、runtime、profile、settings、store、globe、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout
- 未知图标名回退到 puzzle 图标。

代码分割采用两级策略：`shell-core` 和 `bridge` 同步加载（启动关键路径），feature 模块（chat、social、economy 等）按路由 lazy-load。i18n 使用 `react-i18next` 框架，locale 文件和导航标签支持翻译。

**D-SHELL-004 — Vite 分包策略**

代码分割策略：

- **同步加载**：shell-core、bridge（首屏必需）。
- **懒加载**：chat、contacts、explore、settings、profile、runtime-view、mod-ui、local-ai、external-agent。

懒加载通过 `React.lazy(() => import(...))` 实现，配合 `Suspense` 边界。

**D-SHELL-005 — i18n 规范**

- 翻译框架：`react-i18next`。
- 导航 label 使用 `t('Navigation.${id}', { defaultValue: item.label })`。
- locale 文件：`locales/en.json`、`locales/zh.json`。
- 缺失翻译 key 时，renderer 必须发出可观测 issue（例如通过 i18n issue listener / diagnostics surface），并返回人类可读 fallback 文案；不得因 missing key 直接抛错或触发 render crash。
- 缺失翻译属于内容完整性缺陷，不属于 renderer 可用性致命错误；Desktop 不得把 missing key 当作阻断 UI 渲染的 fail-close 条件。
- bundle 加载失败仍必须记录 error 级 issue，并允许受控回退到 `en` 资源，但单个 key 缺失不得升级成 app-unavailable 故障。

### 10.10 错误边界与归一化

Desktop 的错误来自 4 个来源：Runtime gRPC 错误、Realm HTTP 错误、IPC Bridge 错误、本地逻辑错误。错误边界的职责是将这 4 种异构错误**归一化为统一格式**，让上层代码不必关心错误的原始来源。

归一化采用两阶段匹配：先尝试精确 code match（如 `LOCAL_AI_IMPORT_*`、`LOCAL_AI_MODEL_*`），再尝试 pattern regex match，最后 fallback 到通用错误。每种错误码都有对应的 domain 分类和用户消息。

**D-ERR-001 — Local AI 错误码**

本地 AI 模型管理相关错误（参考 `tables/error-codes.yaml`）：

- `LOCAL_AI_IMPORT_*`：导入路径、清单、哈希校验错误。
- `LOCAL_AI_MODEL_*`：模型不存在、哈希为空、能力无效。
- `LOCAL_AI_HF_DOWNLOAD_*`：下载中断/暂停/取消、磁盘不足、不可恢复失败。
- 所有错误通过 `BRIDGE_ERROR_CODE_MAP` 映射为中文用户消息。

**D-ERR-002 — Endpoint 安全错误码**

- `LOCAL_AI_ENDPOINT_NOT_LOOPBACK`：端点非回环地址。
- `LOCAL_AI_ENDPOINT_INVALID`：端点格式无效。

安全要求：本地运行时端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

**D-ERR-003 — Speech Engine 环境错误码**

Speech 引擎依赖检查错误：

- `LOCAL_AI_SPEECH_GPU_REQUIRED`：Speech 引擎需要可用 NVIDIA GPU。
- `LOCAL_AI_SPEECH_PYTHON_REQUIRED`：Speech 引擎需要 Python 3.10+。
- `LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED`：Speech 引擎 Python 版本过低。
- `LOCAL_AI_SPEECH_BOOTSTRAP_FAILED`：Speech 引擎运行时依赖安装失败。

**D-ERR-004 — Runtime 路由错误码**

- `LOCAL_LIFECYCLE_WRITE_DENIED`：source type 无权执行生命周期写操作。
- `RUNTIME_ROUTE_CAPABILITY_MISMATCH`：路由绑定的模型能力不匹配。

Bridge 层的错误归一化（`BRIDGE_ERROR_CODE_MAP`）是两阶段的：先 exact code match，再 pattern regex match，最后 fallback。Bootstrap 期间的错误通过 `bootstrapRuntime().catch()` 处理，设置 `bootstrapError`、清除 auth、记录失败日志。

**D-ERR-005 — Bridge 错误归一化**

`toBridgeUserError(error)` 作为 `toBridgeNimiError(error)` 的别名，必须抛出结构化 `NimiError`，并遵循固定优先级：

1. 输入已是 `NimiError`：保持结构化字段不变。
2. 可解析 JSON payload：提取 `reasonCode/actionHint/traceId/retryable/message`。
3. `CODE:` 前缀：提取前缀作为 `reasonCode`。
4. 正则模式映射：仅用于用户展示文案推断。
5. 兜底：`RUNTIME_CALL_FAILED`。

显示层规则：

- 中文提示仅写入 `details.userMessage`。
- `message` 与 `reasonCode` 必须保留上游原值，不可被 UI 文案覆盖。
- `details.rawMessage` 必须保留原始失败文本，便于排障。

**D-ERR-006 — Bootstrap 错误边界**

`bootstrapRuntime()` 的 `.catch()` 处理：

- 设置 `bootstrapError = message`。
- 设置 `bootstrapReady = false`。
- 清除 auth session。
- 记录 `phase:bootstrap:failed` error 日志。
- 重新抛出错误。

### 10.11 遥测与可观测性

遥测层的目标是让每个"事情发生了"都可追踪——无论是 IPC 调用、网络重试还是 bootstrap 阶段转换。

日志载荷采用结构化格式 `RuntimeLogPayload`，包含 level、area、message、traceId、flowId、source、costMs、details。消息格式有严格约定：必须使用 `action:` 或 `phase:` 前缀，`normalizeRuntimeLogMessage` 自动补充缺失的前缀。

**D-TEL-001 — 日志载荷结构**

`RuntimeLogPayload`：

```typescript
{
  level?: 'debug' | 'info' | 'warn' | 'error';
  area: string;          // 日志区域（参考 tables/log-areas.yaml）
  message: string;       // 格式化消息
  traceId?: string;      // 会话追踪 ID
  flowId?: string;       // 流程追踪 ID
  source?: string;       // 来源标识
  costMs?: number;       // 耗时（毫秒）
  details?: Record<string, unknown>;  // 附加详情
}
```

**D-TEL-002 — 消息格式约定**

消息必须符合两种前缀之一：

- `action:<name>` — 动作类日志（如 `action:invoke-start:http_request`）
- `phase:<name>` — 阶段类日志（如 `phase:bootstrap:done`）

归一化：`normalizeRuntimeLogMessage` 自动添加 `action:` 前缀。

Logger 通过 `setRuntimeLogger(logger)` 注入，未注入时 fallback 到 `console.*`。每个 `invoke()` 调用自动生成 `invokeId` 并记录 invoke-start/success/failed 日志。

**D-TEL-003 — Logger 注入**

`setRuntimeLogger(logger)` 注入运行时 logger：

- 非空时：日志转发到注入的 logger 函数。
- 为空时：回退到 `console.*`（`fallbackConsoleLog`）。
- 启动序列中在 `bootstrapRuntime()` 入口处注入（早于 `D-BOOT-001`），通过 `desktopBridge.logRendererEvent` 转发到 Tauri backend。

**D-TEL-005 — Bridge 调用追踪**

每次 `invoke()` 调用生成追踪信息：

- `invokeId`：`${command}-${timestamp}-${random}`（格式由 `D-IPC-009` 定义）
- `sessionTraceId`：renderer 会话级追踪 ID。
- 日志事件：`invoke-start`（info）、`invoke-success`（debug）、`invoke-failed`（error）。

流程追踪 ID 通过 `createRendererFlowId` 生成（格式：`${prefix}-${timestamp}-${random}`），支持跨组件的请求关联。Renderer 日志可通过 IPC 转发到 Tauri 后端（`RendererLogPayload`）。网络层日志使用独立的 `net` area，记录 retrying/recovered/exhausted 事件并映射 log level。

**D-TEL-004 — 流程追踪 ID**

`createRendererFlowId(prefix)` 生成唯一流程 ID：

- 格式：`${prefix}-${timestamp}-${random}`
- 用途：关联同一流程的多条日志（如 bootstrap 流程）。

**D-TEL-006 — Renderer 日志转发**

Renderer 日志通过 IPC 转发到 Tauri backend：

- `RendererLogPayload` 与 `RuntimeLogPayload` 结构对齐。
- `toRendererLogMessage()` 确保消息格式正确。

**D-TEL-007 — 网络层日志区域**

`net` 日志区域用于网络重试事件和错误归一化日志：

- 重试事件：`action:retry:retrying`、`action:retry:recovered`、`action:retry:retry_exhausted`。
- 日志级别：retrying=warn、recovered=info、exhausted=error。
- 来源：`request-with-retry.ts` 中的 `requestWithRetry` 函数。

### 10.12 网络层：代理、重试与实时

Desktop 的网络层解决三个问题：CORS 绕过、失败重试、实时通信。

**代理 Fetch**：`createProxyFetch()` 将所有 HTTP 请求代理到 Tauri 后端的 `http_request` IPC 命令，从根本上绕过浏览器 CORS 限制。错误通过 `normalizeApiError()` 统一格式化（status + message + fallback）。

**D-NET-004 — 代理 Fetch**

`createProxyFetch()` 创建通过 Tauri backend 代理的 fetch 实现：

- 所有 HTTP 请求通过 `http_request` IPC 命令（`D-IPC-004`）转发。
- 绕过浏览器 CORS 限制。
- Desktop 模式的 DataSync 和 LLM 请求均使用此 fetch。

**D-NET-005 — 错误归一化**

`normalizeApiError(error, fallbackMessage?)` 统一错误格式：

- API 错误：保留 status、message。
- 网络错误：转为统一 Error 对象。
- fallbackMessage：无法解析时的兜底消息。

**重试策略**：7 个 HTTP 状态码被标记为可重试（408、425、429、500、502、503、504）。`requestWithRetry` 使用指数退避：maxAttempts=3、initialDelayMs=120、maxDelayMs=900。每次重试触发 `RetryEvent` 回调（retrying/recovered/retry_exhausted），携带 reason 追踪。

**D-NET-001 — 可重试状态码**

以下 HTTP 状态码触发自动重试（参考 `tables/retry-status-codes.yaml`）：

- `408` Request Timeout
- `425` Too Early
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout

**D-NET-002 — 重试策略**

`requestWithRetry` 实现指数退避重试：

默认参数：
- `maxAttempts: 3`
- `initialDelayMs: 120`
- `maxDelayMs: 900`

退避算法：`delayMs = min(maxDelayMs, initialDelayMs * 2^(attempt-1) + uniform_jitter[0, initialDelayMs/2])`

重试条件：
- **状态码重试**：`RETRYABLE_STATUS_CODES.has(error.status)` — `RetryReasonKind: 'status'`
- **网络错误重试**：`AbortError` 或 `TypeError` — `RetryReasonKind: 'network'`

**跨传输重试参数差异说明**：Desktop HTTP 重试参数（120ms initial / 900ms cap）与 SDK Runtime gRPC 重试参数（S-RUNTIME-045: 200ms initial / 3000ms cap）不同。此差异是设计意图：

**参数选取依据**（同 K-DAEMON-006/007 注释模式）：
- HTTP（Realm API）初始退避 120ms：Realm REST API 平均响应 <50ms，120ms 足以覆盖瞬时抖动且不引入用户可感知延迟。Cap 900ms：3 次重试总等待 ≈120+240+480≈840ms（含 jitter <1.2s），用户体验上限约 1s。
- gRPC（Runtime）初始退避 200ms：AI 推理 RPC 本身延迟高（首包 1-10s），200ms 退避在推理超时上下文中忽略不计。Cap 3000ms：推理场景更可能因 provider 过载导致暂时不可用，更大退避区间降低 thundering herd 风险。

**D-NET-003 — 重试事件**

`RetryEvent` 通过 `onRetryEvent` 回调通知：

- `retrying`：开始重试，包含 delayMs、reasonKind、status。
- `recovered`：重试后恢复，包含 retryCount。
- `retry_exhausted`：重试耗尽，最终失败。

**实时传输**：Socket.IO WebSocket 连接绕过 CORS，携带 auth token 和 session protocol。内建事件去重和断线恢复机制。

**D-NET-006 — Realtime Transport**

**SDK 契约引用**：SDK S-REALM-035/036/037 定义 Realm 实时传输的 SDK 层约束（token 注入、事件不丢失保证）。D-NET-006 是 Desktop 层的具体实现，满足 SDK 层约束。

Socket.IO WebSocket 传输层：

- `resolveRealtimeUrl()`：从 `realmBaseUrl` / `realtimeUrl` 解析 WebSocket 连接地址。本地环境 3002 端口自动映射为 3003。
- 传输固定为 `['websocket']`，路径 `/socket.io/`。
- 认证：通过 `auth.token` 在握手时传递 Bearer Token。
- 连接生命周期：`connect` 事件触发 session 恢复和 outbox 刷新。
- 会话管理：`chat:session.open` / `chat:session.ready` / `chat:event.ack` 协议。
- 事件去重：客户端维护 `seenEvents` LRU 映射（上限 3000 条）防止重复处理。达到上限时按 LRU 策略驱逐最久未访问的条目，确保内存占用可控。
- 断线恢复：`chat:session.sync_required` 触发增量同步回填。

### 10.13 安全模型

Desktop 的安全策略由 5 层纵深防御构成，从最基础的网络限制到最上层的 Mod 沙箱。

**Layer 1: Loopback 限制** — 所有 Runtime endpoint 必须指向 localhost / 127.0.0.1 / [::1]，阻止任何远程路由。这是最基础的安全屏障：即使其他层全部失效，AI 推理请求也不会离开本机。

**D-SEC-001 — Endpoint 回环限制**

本地运行时端点必须为回环地址：

- 允许：`localhost`、`127.0.0.1`、`[::1]`
- 错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`（`D-ERR-002`）

此规则防止本地 AI 推理流量意外路由到远程地址。

**安全深度说明**：Desktop renderer 层仅执行回环地址校验作为前端防线。完整的端点安全模型由 Runtime daemon 层执行（K-SEC-002~005），包括：HTTPS-only 默认策略、loopback 显式开关（`allow_loopback_provider_endpoint`）、高风险地址无条件拒绝（link-local `169.254.0.0/16`、私网 `fc00::/7`）、DNS 解析后 IP 重验证、TOCTOU pin 防护。两层协同保护确保本地端点安全。

**Layer 2: Bearer Token 管理** — Token 存储在 Zustand `auth.token` 中，同步到 DataSync hot state。Desktop 和 Web 通过各自的持久化机制管理 Realm access token（Web 使用 localStorage 加过期机制，敏感页面需二次验证，logout 时完全清除）。

**D-SEC-002 — Bearer Token 管理**

- Token 存储在 Zustand store `auth.token` 字段。
- DataSync 热状态中保持 token 副本，但该热状态仅用于进程内 / HMR 连续性，不是长期持久化真源。
- Desktop 长期持久化层固定为 `~/.nimi/auth/session.v1.json`，其中 accessToken / refreshToken 只允许以 ciphertext 形式落盘。
- 加密密钥必须存放在 OS secure store（共享 service/account，versioned）。
- session 文件写入必须原子替换；平台支持时要求 owner-only 权限。
- secure-store 读取失败、ciphertext 解密失败、schema 校验失败时必须 fail-close，不得回退到明文或猜测恢复。
- Token 更新通过 `setToken()` 同步到所有消费者。
- Token 清除触发：logout、auth 失败、bootstrap 错误。

**D-SEC-010 — Web 端 Token 存储安全**

Web 环境 session 存储安全约束（参考 `D-AUTH-003`）：

- localStorage 不得持久化 raw access token 或 raw refresh token；浏览器持久化层只允许保存非敏感会话元数据并设置合理过期时间。
- 敏感页面（economy、auth）需在操作前重新验证 token 有效性。
- 禁止将 token 写入 cookie 以避免 CSRF 风险。
- logout 操作必须清除所有 localStorage 中的认证数据。

**Layer 2.5: AI 凭据委托** — AI provider API key 的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor）。Desktop renderer 不接触原始 API key，通过 SDK `CreateConnector` / `UpdateConnector` 将凭据写入 Runtime 后即刻丢弃内存副本。AI 请求通过 `connector_id` 路由，Desktop/Web 统一使用 SDK ConnectorService 接口。

**D-SEC-009 — AI 凭据委托模型**

AI provider 凭据（API key）的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor，定义于 spec/runtime/connector.md）：

- Desktop renderer **不接触**原始 API key。用户通过 UI 输入凭据后，Desktop 调用 SDK `CreateConnector` / `UpdateConnector`（K-RPC-007/008）将凭据写入 Runtime，写入后即刻丢弃内存副本。
- AI 请求通过 `connector_id`（managed 路径，K-KEYSRC-001）路由到 Runtime，Runtime 在执行上下文中解密注入凭据（K-KEYSRC-004 step 6），下游不直接访问 CredentialStore。
- Realm access token（非 AI 凭据）仍由 `D-AUTH-002` / `D-AUTH-003` 管理，与 ConnectorService 无关。
- Desktop / Web 统一使用 SDK ConnectorService 接口，无平台差异。

**跨层引用**：K-CONN-001、K-RPC-003、K-RPC-007~009、K-KEYSRC-001/004。

**Layer 3: OAuth 安全** — OAuth 流程通过 Tauri IPC 执行，支持 PKCE 和 clientSecret 两种模式，通过 redirect URI 监听完成授权。

**D-SEC-003 — OAuth 安全**

OAuth 流程通过 Tauri IPC 执行（参考 `D-IPC-006`）：

- 支持 PKCE：`codeVerifier` 参数。
- 支持 `clientSecret` 模式。
- Redirect URI 监听：`oauth_listen_for_code` 命令在本地端口监听回调。
- 超时：`timeoutMs` 参数防止无限等待。

**Layer 4: IPC 桥接隔离** — `hasTauriInvoke()` 检查 `window.__TAURI__` 存在性，统一 `invoke()` 入口确保所有 IPC 调用经过单一校验点。CSP 策略约束 script/style 加载和 connect-src 白名单。

**D-SEC-004 — IPC 桥接安全**

- `hasTauriInvoke()` 检查 Tauri runtime presence（`__TAURI_INTERNALS__` / `__TAURI_IPC__` 或等价的显式 bridge 环境），不得要求 `window.__TAURI__` 全局暴露。
- 非 Tauri 环境抛出明确错误而非静默失败。
- 所有 IPC 调用通过统一入口 `invoke()` 执行，确保日志追踪覆盖。

**D-SEC-008 — CSP 策略**

Content Security Policy 约束：

- Tauri webview 默认启用 CSP，限制外部脚本和样式加载。
- `connect-src` 仅允许 realm API 域名和回环地址。
- `script-src` 禁止 `eval` 和 inline script（mod 通过沙箱 iframe 隔离）。
- Web 模式下依赖服务端 CSP header 而非 Tauri webview 策略。

**Layer 5: Mod 能力沙箱** — Mod 在 capability sandbox 中执行，source-type 强制执行最小权限（如 10.6 所定义）。本地 AI 模型要求非空 `manifest.hashes` 进行完整性校验。External Agent 的 token 支持签发、撤销、列表和网关监控。

**D-SEC-005 — Mod 能力沙箱**

Mod 执行在能力沙箱内（参考 `D-HOOK-008`、`D-MOD-005`）：

- Source type 决定可用能力集。
- 未声明的能力调用被拒绝。
- `codegen` source type 使用最小权限原则。

**D-SEC-006 — 模型完整性校验**

本地 AI 模型安装区分 verified 与 local-unverified 两类完整性语义：

- verified 安装路径（catalog / verified / 带 expected hashes 的 manifest）要求 `manifest.hashes` 非空，并在导入时执行 `LOCAL_AI_IMPORT_HASH_MISMATCH` 检查。
- 手工本地文件导入与 orphan scaffold 归类为 `local_unverified`，允许 `manifest.hashes` 为空；它表示用户确认信任的本地文件，而不是 provenance-verified 来源。
- 只有 verified 模型会因空哈希在启动前被 `LOCAL_AI_MODEL_HASHES_EMPTY` 拦截；`local_unverified` 不受该门槛阻塞。

**跨层引用**：Runtime `K-RPC-004` / `K-LOCAL-009` / `K-LOCAL-028` 是本地模型 import/install/transfer/lifecycle 的权威控制面。Desktop D-SEC-006 只定义前端 UX 安全边界，不得把 host-local 状态当成安装成功、下载完成或可启动的真相源。

**信任边界声明**：Desktop D-SEC-006 的 hash 校验只覆盖 verified 来源，防止用户通过 Desktop UI 启动宣称已验证但缺乏完整性证明的模型。`local_unverified` 是用户显式确认的本地导入信任边界，Desktop 会保留“未进行来源验证”的 provenance 标识，但不会追加同步 SHA256 阻塞启动。Runtime 仍然是格式/引擎校验、transfer 失败语义与健康判定的权威层。

**D-SEC-007 — External Agent Token 安全**

- Token 通过 `external_agent_issue_token` IPC 命令签发。
- Token 可通过 `external_agent_revoke_token` 吊销。
- Token 列表通过 `external_agent_list_tokens` 审计。
- Gateway 状态通过 `external_agent_gateway_status` 监控。

**跨层引用**：Runtime K-AUTHSVC-006 定义 External Principal 注册与开会话的验证规则（`proof_type` + `signature_key_id` 一致性校验）。Runtime K-GRANT-003 定义 token 权限模型。Desktop 层 token 签发/吊销通过 Tauri backend 桥接到 Runtime 层执行，Desktop 不直接处理 token 验证逻辑。

---

## 11. Future 能力规划

为什么不用 GitHub Issues 做能力规划？因为 Nimi 的能力变更往往**跨越 4 层**（Runtime → SDK → Desktop → Realm），一个 issue 无法追溯到研究来源，无法表达跨层依赖，也没有从"想法"到"正式 spec"的毕业标准。

Future Capabilities 系统用三个互锁的注册表解决这个问题：能力 Backlog（记录"要建什么"）、来源注册表（记录"为什么要建"）、毕业日志（记录"什么时候进入了正式 spec"）。三者形成一条完整的追溯链：

```
追溯链
─────────────────────────────────────────────────
Research Report        Backlog Item           Spec Document
(dev/research/*.md)    (backlog-items.yaml)   (spec/**/*.md)
       │                      │                      │
   source_id ─────→ source_ids[]              target_spec_path
                              │                      │
                        graduation ──────────→ graduation-log
                              │                      │
                      status: spec-drafted    Rule IDs assigned
```

这种结构化治理提供了**机构记忆**——priority / depends_on / category 字段可审计，不会因团队变动而丢失决策上下文。

### 11.1 为什么需要结构化治理？

当一个能力需求从竞品分析中被提取出来时（例如"Dify 的工作流编排比我们更灵活"），它影响的可能是：Runtime 需要新的 workflow engine、SDK 需要新的方法投影、Desktop 需要新的 UI 面板、Realm 需要新的数据模型。这种跨层影响无法用 flat issue list 追踪——需要结构化的 priority、category、target_layers 字段来表达影响范围和优先级。

### 11.2 Backlog 条目结构与生命周期

每个 backlog 条目有 10 个标准化字段：item_id、title、priority、category、target_layers、status、source_ids、complexity、depends_on、architecture_notes。字段设计的目标是**让每个条目自包含**——不需要翻阅 issue thread 就能理解一个能力的完整上下文。

**F-CAP-001 — Backlog 条目必填字段**

每个 backlog 条目必须包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `item_id` | string | yes | 格式 `F-<MNEMONIC>-NNN`，全局唯一 |
| `title` | string | yes | 简短标题 |
| `priority` | enum | yes | `high` / `medium` / `low` |
| `category` | enum | yes | 见 F-CAP-004 |
| `target_layers` | list | yes | 受影响层：`runtime` / `sdk` / `desktop` / `web` |
| `status` | enum | yes | 见 F-CAP-003 |
| `source_ids` | list | yes | 至少一个 `RESEARCH-*` 来源引用 |
| `complexity` | enum | yes | `small` / `medium` / `large` |
| `depends_on` | list | no | 依赖的其他 backlog 条目 `item_id` 列表 |
| `architecture_notes` | string | yes | 架构影响简述 |

优先级分三级：`high`（核心 UX 或竞争差距，有明确实现路径）、`medium`（平台能力增强）、`low`（长期储备，无紧迫需求）。优先级标准不是主观判断——它基于 category 和 target_layers 的交叉分析。

**F-CAP-002 — 优先级分类标准**

- **high**：直接影响核心用户体验或竞品差距明显，实施路径清晰。
- **medium**：增强平台能力或集成度，有明确需求但不阻塞核心流程。
- **low**：长期能力储备，当前无紧迫需求或依赖外部标准成熟。

条目的生命周期是一个确定性状态机：

```
Backlog 条目生命周期
─────────────────────────────────────────────────
  proposed ──→ accepted ──→ spec-drafted ──→ implemented
     │             │
     ↓             ↓
  rejected      deferred
```

每个状态转换都有明确的前置条件：`proposed → accepted` 需要 architecture_notes 非空，`accepted → spec-drafted` 需要满足毕业条件（见 11.4）。`rejected` 和 `deferred` 是终态的分支——`deferred` 可以在条件成熟后重新激活。

**F-CAP-003 — 状态生命周期**

```text
proposed → accepted → spec-drafted → implemented
                   ↘ rejected
                   ↘ deferred
```

- **proposed**：从研究报告中提取，待审计。
- **accepted**：审计通过，进入活跃 backlog。
- **spec-drafted**：已有对应的 `spec/runtime/` 或 `spec/sdk/` 草案。
- **implemented**：已在代码中实现并合入。
- **rejected**：审计后认为不适用或不符合平台方向。
- **deferred**：暂缓，等待外部条件成熟。

Category 枚举按域分类：`ux`（UI/交互）、`integration`（外部协议）、`platform`（核心能力）、`auth`（认证授权）、`security`、`observability`。分类用于过滤和跨层影响分析。

**F-CAP-004 — Category 枚举**

| Category | 说明 |
|---|---|
| `ux` | 用户体验改进（渲染、交互、编辑器） |
| `integration` | 外部协议/服务集成（MCP、搜索、OAuth） |
| `platform` | 平台核心能力（RAG、工作流、模型路由） |
| `auth` | 认证与授权扩展 |
| `security` | 安全与审核能力 |
| `observability` | 可观测性与运维 |

依赖关系（`depends_on`）引用 backlog 中已有的 item_id，不允许自引用或循环依赖链。依赖是**软约束**——建议实现顺序而非硬阻塞，允许独立并行开发。

**F-CAP-005 — 依赖关系约束**

- `depends_on` 中引用的每个 `item_id` 必须存在于 `backlog-items.yaml`。
- 不允许自引用（条目不能依赖自身）。
- 不允许循环依赖（A→B→…→A）。
- 依赖是软约束：表达推荐的实施顺序，不阻塞独立开发。

### 11.3 来源注册：可追溯性链条

每个 backlog 条目的 `source_ids` 字段引用来源注册表中的 source_id。来源注册表执行**双层验证**：source_id 必须存在于 `research-sources.yaml` 注册表中（ID 存在性），且注册的 `path` 必须指向磁盘上实际存在的文件（文件存在性）。

Source ID 格式为 `RESEARCH-<ABBREV>-NNN`，其中 ABBREV 是 2-6 字符的大写缩写，NNN 是三位递增数字。每条来源包含 source_id、title、path（repo root 相对路径）、date（YYYY-MM-DD）、scope 五个必填字段。

**F-SRC-001 — Source ID 格式**

- 格式：`RESEARCH-<ABBREV>-NNN`
- `ABBREV`：2-6 个大写字母缩写，标识研究类别或对象。
- `NNN`：三位递增编号。
- 示例：`RESEARCH-OWUI-001`、`RESEARCH-DIFY-001`

**F-SRC-002 — 来源必填字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_id` | string | yes | 格式见 F-SRC-001 |
| `title` | string | yes | 报告标题 |
| `path` | string | yes | 相对于仓库根的文件路径 |
| `date` | string | yes | 报告日期（`YYYY-MM-DD`） |
| `scope` | string | yes | 报告覆盖范围简述 |

**F-SRC-003 — 路径有效性**

- `path` 必须指向仓库中实际存在的文件。
- 一致性检查脚本验证路径存在性。

**F-SRC-004 — 引用要求**

- backlog 条目的 `source_ids` 中每个 ID 必须在 `research-sources.yaml` 中注册。
- 未注册的 source ID 在一致性检查中报错。

### 11.4 毕业流程：从 Backlog 到 Spec

当一个 backlog 条目足够成熟时，它通过毕业流程进入正式 spec。毕业条件是严格的：item 必须处于 `accepted` 状态、有明确的 target spec 路径、已分配 kernel Rule ID、且 `architecture_notes` 非空（完成了架构影响评估）。

**F-GRAD-001 — 毕业条件**

条目从 `accepted` 毕业到 `spec-drafted` 必须满足：

1. 条目 `status` 为 `accepted`。
2. 已确定目标 spec 路径（`target_spec_path`）。
3. 已有明确的 kernel Rule ID 分配方案。
4. 已完成架构影响评估（`architecture_notes` 非空且具体）。
5. 目标 spec 域的 mandatory verification commands 必须通过，至少包含 `check:<domain>-spec-kernel-consistency` 与 `check:<domain>-spec-kernel-docs-drift`。此条件确保毕业后的 spec 不会破坏已有的一致性守护。
6. `target_layers` 包含 `web` 时，不创建独立 `spec/web/` 域；必须毕业到现有 `spec/desktop/` 投影文档（优先 `spec/desktop/web-adapter.md`）并沿用 `desktop` 域检查。
7. 如条目语义依赖 `spec/platform/**` 或 `spec/realm/**` 的现有 kernel 规则 / tables，目标文档必须显式 import 并复用这些规则；不得复制协议、原语、经济或边界词汇正文。

毕业是一个**原子操作**——三个步骤必须在同一个变更集中完成：① 在目标 spec 域创建/扩展对应文档，② 在 `graduation-log.yaml` 中追加毕业记录，③ 更新 backlog item 状态为 `spec-drafted`。拆分为多个 commit 会产生中间不一致状态。

**F-GRAD-002 — 毕业流程**

1. 在目标 spec 域（`spec/runtime/`、`spec/sdk/` 或 `spec/desktop/`）创建或扩展对应文档。
   其中如涉及 Platform / Realm 既有语义，必须在同次变更中补齐对应 kernel imports 与阅读路径。
2. 在 `graduation-log.yaml` 追加一条毕业记录。
3. 在 `backlog-items.yaml` 中将条目 `status` 更新为 `spec-drafted`。
4. 以上三步必须在同一次变更中完成。

毕业日志的每条记录包含 item_id、graduated_date、target_spec_path、target_rule_ids 和可选 notes。日志是 **append-only** 的——已写入的记录不可修改或删除。

**F-GRAD-003 — 毕业日志结构**

每条毕业日志必须包含：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `item_id` | string | yes | 对应 backlog 条目 ID |
| `graduated_date` | string | yes | 毕业日期（`YYYY-MM-DD`） |
| `target_spec_path` | string | yes | 目标 spec 文件路径 |
| `target_rule_ids` | list | yes | 分配的 kernel Rule ID 列表 |
| `notes` | string | no | 毕业备注 |

为什么毕业不可逆？设计意图是防止 "graduation ping-pong"（反复在 backlog 和 spec 之间搬迁）。一旦毕业，发现的问题在目标 spec 域中处理，不通过回退 backlog 状态来解决。毕业后的 item 保留在 backlog 中，仅状态变更为 `spec-drafted`——保留完整历史。

**F-GRAD-004 — 毕业不可逆**

- 毕业日志（`graduation-log.yaml`）一旦写入不可删除或修改。
- 毕业后条目在 `backlog-items.yaml` 中保留，仅 `status` 字段变更。
- 如毕业后发现问题，在目标 spec 域处理，不回退 backlog 状态。

---

## 12. 附录：参考表

以下表格从 YAML 事实源自动渲染。YAML 文件是权威数据源；如需修改，请编辑 YAML 后重新生成。

### 12.1 Runtime — RPC 方法列表

**AIService**

| 方法 | 类型 |
|---|---|
| ExecuteScenario | unary |
| StreamScenario | server_stream |
| SubmitScenarioJob | unary |
| GetScenarioJob | unary |
| CancelScenarioJob | unary |
| SubscribeScenarioJobEvents | server_stream |
| GetScenarioArtifacts | unary |
| ListScenarioProfiles | unary |
| GetVoiceAsset | unary |
| ListVoiceAssets | unary |
| DeleteVoiceAsset | unary |
| ListPresetVoices | unary |
| UploadArtifact | client_stream |

**RuntimeAiRealtimeService**

| 方法 | 类型 |
|---|---|
| OpenRealtimeSession | unary |
| AppendRealtimeInput | unary |
| ReadRealtimeEvents | server_stream |
| CloseRealtimeSession | unary |

**ConnectorService**

| 方法 | 类型 |
|---|---|
| CreateConnector | unary |
| GetConnector | unary |
| ListConnectors | unary |
| UpdateConnector | unary |
| DeleteConnector | unary |
| TestConnector | unary |
| ListConnectorModels | unary |
| ListProviderCatalog | unary |
| ListModelCatalogProviders | unary |
| UpsertModelCatalogProvider | unary |
| DeleteModelCatalogProvider | unary |
| ListCatalogProviderModels | unary |
| GetCatalogModelDetail | unary |
| UpsertCatalogModelOverlay | unary |
| DeleteCatalogModelOverlay | unary |

**RuntimeLocalService**

| 方法 | 类型 |
|---|---|
| ListLocalAssets | unary |
| ListVerifiedAssets | unary |
| InstallVerifiedAsset | unary |
| ImportLocalAsset | unary |
| ImportLocalAssetFile | unary |
| RemoveLocalAsset | unary |
| StartLocalAsset | unary |
| StopLocalAsset | unary |
| CheckLocalAssetHealth | unary |
| WarmLocalAsset | unary |
| SearchCatalogModels | unary |
| ResolveModelInstallPlan | unary |
| CollectDeviceProfile | unary |
| ScanUnregisteredAssets | unary |
| ScaffoldOrphanAsset | unary |
| ListLocalTransfers | unary |
| PauseLocalTransfer | unary |
| ResumeLocalTransfer | unary |
| CancelLocalTransfer | unary |
| WatchLocalTransfers | server_stream |
| ListLocalServices | unary |
| InstallLocalService | unary |
| StartLocalService | unary |
| StopLocalService | unary |
| CheckLocalServiceHealth | unary |
| RemoveLocalService | unary |
| ListNodeCatalog | unary |
| ResolveProfile | unary |
| ApplyProfile | unary |
| ListLocalAudits | unary |
| AppendInferenceAudit | unary |
| AppendRuntimeAudit | unary |
| ListEngines | unary |
| EnsureEngine | unary |
| StartEngine | unary |
| StopEngine | unary |
| GetEngineStatus | unary |

**RuntimeAuthService**

| 方法 | 类型 |
|---|---|
| RegisterApp | unary |
| OpenSession | unary |
| RefreshSession | unary |
| RevokeSession | unary |
| RegisterExternalPrincipal | unary |
| OpenExternalPrincipalSession | unary |
| RevokeExternalPrincipalSession | unary |

**RuntimeGrantService**

| 方法 | 类型 |
|---|---|
| AuthorizeExternalPrincipal | unary |
| ValidateAppAccessToken | unary |
| RevokeAppAccessToken | unary |
| IssueDelegatedAccessToken | unary |
| ListTokenChain | unary |

**RuntimeWorkflowService**

| 方法 | 类型 |
|---|---|
| SubmitWorkflow | unary |
| GetWorkflow | unary |
| CancelWorkflow | unary |
| SubscribeWorkflowEvents | server_stream |

**RuntimeAuditService**

| 方法 | 类型 |
|---|---|
| ListAuditEvents | unary |
| ExportAuditEvents | server_stream |
| ListUsageStats | unary |
| GetRuntimeHealth | unary |
| ListAIProviderHealth | unary |
| SubscribeAIProviderHealthEvents | server_stream |
| SubscribeRuntimeHealthEvents | server_stream |

**RuntimeModelService**

| 方法 | 类型 |
|---|---|
| ListModels | unary |
| PullModel | unary |
| RemoveModel | unary |
| CheckModelHealth | unary |

**RuntimeKnowledgeService**

| 方法 | 类型 |
|---|---|
| BuildIndex | unary |
| SearchIndex | unary |
| DeleteIndex | unary |

**RuntimeAppService**

| 方法 | 类型 |
|---|---|
| SendAppMessage | unary |
| SubscribeAppMessages | server_stream |

### 12.2 Runtime — ReasonCode 错误码表

| 名称 | 值 | 族 |
|---|---:|---|
| REASON_CODE_UNSPECIFIED | 0 | GENERAL |
| ACTION_EXECUTED | 1 | GENERAL |
| PROTOCOL_ENVELOPE_INVALID | 2 | GENERAL |
| PROTOCOL_DOMAIN_FIELD_CONFLICT | 3 | GENERAL |
| CAPABILITY_CATALOG_MISMATCH | 4 | GENERAL |
| APP_NOT_REGISTERED | 5 | GENERAL |
| EXTERNAL_PRINCIPAL_NOT_REGISTERED | 6 | GENERAL |
| PRINCIPAL_UNAUTHORIZED | 8 | GENERAL |
| SESSION_EXPIRED | 7 | AUTH |
| AUTH_TOKEN_INVALID | 300 | AUTH |
| AUTH_TOKEN_EXPIRED | 301 | AUTH |
| AUTH_UNSUPPORTED_PROOF_TYPE | 302 | AUTH |
| AI_CONNECTOR_NOT_FOUND | 310 | CONNECTOR |
| AI_CONNECTOR_DISABLED | 311 | CONNECTOR |
| AI_CONNECTOR_CREDENTIAL_MISSING | 312 | CONNECTOR |
| AI_CONNECTOR_INVALID | 313 | CONNECTOR |
| AI_CONNECTOR_IMMUTABLE | 314 | CONNECTOR |
| AI_CONNECTOR_LIMIT_EXCEEDED | 315 | CONNECTOR |
| AI_CONNECTOR_ID_REQUIRED | 316 | CONNECTOR |
| AI_REQUEST_CREDENTIAL_CONFLICT | 330 | REQUEST_CREDENTIAL |
| AI_REQUEST_CREDENTIAL_MISSING | 211 | REQUEST_CREDENTIAL |
| AI_REQUEST_CREDENTIAL_INVALID | 212 | REQUEST_CREDENTIAL |
| AI_APP_ID_REQUIRED | 340 | APP |
| AI_APP_ID_CONFLICT | 341 | APP |
| AI_MODEL_ID_REQUIRED | 350 | MODEL |
| AI_MODEL_NOT_FOUND | 200 | MODEL |
| AI_MODALITY_NOT_SUPPORTED | 351 | MODEL |
| AI_LOCAL_MODEL_UNAVAILABLE | 352 | MODEL |
| AI_LOCAL_MODEL_PROFILE_MISSING | 353 | MODEL |
| AI_LOCAL_ASSET_ALREADY_INSTALLED | 354 | MODEL |
| AI_LOCAL_ENDPOINT_REQUIRED | 355 | MODEL |
| AI_LOCAL_TEMPLATE_NOT_FOUND | 356 | MODEL |
| AI_LOCAL_MANIFEST_INVALID | 357 | MODEL |
| AI_LOCAL_MODEL_INVALID_TRANSITION | 358 | MODEL |
| AI_LOCAL_DOWNLOAD_FAILED | 359 | MODEL |
| AI_LOCAL_DOWNLOAD_HASH_MISMATCH | 360 | MODEL |
| AI_LOCAL_HF_REPO_INVALID | 361 | MODEL |
| AI_LOCAL_HF_SEARCH_FAILED | 362 | MODEL |
| AI_LOCAL_MANIFEST_SCHEMA_INVALID | 363 | MODEL |
| AI_LOCAL_SERVICE_UNAVAILABLE | 364 | MODEL |
| AI_LOCAL_SERVICE_ALREADY_INSTALLED | 365 | MODEL |
| AI_LOCAL_SERVICE_INVALID_TRANSITION | 366 | MODEL |
| AI_LOCAL_ASSET_ALREADY_INSTALLED | 367 | MODEL |
| AI_LOCAL_ASSET_SLOT_MISSING | 368 | MODEL |
| AI_LOCAL_ASSET_SLOT_FORBIDDEN | 369 | MODEL |
| AI_LOCAL_PROFILE_SLOT_CONFLICT | 376 | MODEL |
| AI_LOCAL_PROFILE_OVERRIDE_FORBIDDEN | 377 | MODEL |
| AI_MODEL_NOT_READY | 201 | PROVIDER |
| AI_ROUTE_UNSUPPORTED | 204 | MODEL_ROUTE |
| AI_ROUTE_FALLBACK_DENIED | 205 | MODEL_ROUTE |
| AI_CONTENT_FILTER_BLOCKED | 209 | PROVIDER |
| AI_REQUEST_CREDENTIAL_REQUIRED | 210 | REQUEST_CREDENTIAL |
| AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN | 213 | REQUEST_CREDENTIAL |
| AI_FINISH_LENGTH | 370 | FINISH |
| AI_FINISH_CONTENT_FILTER | 371 | FINISH |
| AI_MODEL_PROVIDER_MISMATCH | 380 | MODEL_ROUTE |
| AI_PROVIDER_ENDPOINT_FORBIDDEN | 390 | PROVIDER |
| AI_PROVIDER_AUTH_FAILED | 391 | PROVIDER |
| AI_PROVIDER_UNAVAILABLE | 202 | PROVIDER |
| AI_PROVIDER_INTERNAL | 392 | PROVIDER |
| AI_PROVIDER_RATE_LIMITED | 393 | PROVIDER |
| AI_PROVIDER_TIMEOUT | 394 | PROVIDER |
| AI_INPUT_INVALID | 206 | PROVIDER |
| AI_OUTPUT_INVALID | 207 | PROVIDER |
| AI_STREAM_BROKEN | 208 | PROVIDER |
| AI_MEDIA_SPEC_INVALID | 410 | MEDIA |
| AI_MEDIA_OPTION_UNSUPPORTED | 411 | MEDIA |
| AI_MEDIA_JOB_NOT_FOUND | 412 | MEDIA |
| AI_MEDIA_JOB_NOT_CANCELLABLE | 413 | MEDIA |
| AI_MEDIA_IDEMPOTENCY_CONFLICT | 414 | MEDIA |
| AI_ARTIFACT_UPLOAD_INVALID | 415 | MEDIA |
| AI_ARTIFACT_UPLOAD_TOO_LARGE | 416 | MEDIA |
| AI_REALTIME_SESSION_NOT_FOUND | 417 | MEDIA |
| AI_REALTIME_SESSION_CLOSED | 418 | MEDIA |
| AI_VOICE_INPUT_INVALID | 420 | VOICE |
| AI_VOICE_WORKFLOW_UNSUPPORTED | 421 | VOICE |
| AI_VOICE_ASSET_NOT_FOUND | 422 | VOICE |
| AI_VOICE_ASSET_EXPIRED | 423 | VOICE |
| AI_VOICE_ASSET_SCOPE_FORBIDDEN | 424 | VOICE |
| AI_VOICE_TARGET_MODEL_MISMATCH | 425 | VOICE |
| AI_VOICE_JOB_NOT_FOUND | 426 | VOICE |
| AI_VOICE_JOB_NOT_CANCELLABLE | 427 | VOICE |
| AI_MODULE_CONFIG_INVALID | 430 | MODULE |
| WF_DAG_INVALID | 440 | WORKFLOW |
| WF_NODE_CONFIG_MISMATCH | 441 | WORKFLOW |
| WF_TIMEOUT | 442 | WORKFLOW |
| WF_TASK_NOT_FOUND | 443 | WORKFLOW |
| APP_AUTHORIZATION_DENIED | 100 | APP_AUTH |
| APP_GRANT_INVALID | 101 | APP_AUTH |
| APP_TOKEN_EXPIRED | 102 | APP_AUTH |
| APP_TOKEN_REVOKED | 103 | APP_AUTH |
| APP_SCOPE_CATALOG_UNPUBLISHED | 105 | APP_AUTH |
| APP_DELEGATION_FORBIDDEN | 107 | APP_AUTH |
| APP_DELEGATION_DEPTH_EXCEEDED | 108 | APP_AUTH |
| APP_RESOURCE_SELECTOR_INVALID | 109 | APP_AUTH |
| APP_RESOURCE_OUT_OF_SCOPE | 110 | APP_AUTH |
| APP_CONSENT_MISSING | 111 | APP_AUTH |
| APP_CONSENT_INVALID | 112 | APP_AUTH |
| EXTERNAL_PRINCIPAL_PROOF_MISSING | 113 | APP_AUTH |
| EXTERNAL_PRINCIPAL_PROOF_INVALID | 114 | APP_AUTH |
| APP_MODE_WORLD_RELATION_FORBIDDEN | 117 | APP_AUTH |
| APP_MODE_DOMAIN_FORBIDDEN | 500 | APP_AUTH |
| APP_MODE_SCOPE_FORBIDDEN | 501 | APP_AUTH |
| APP_MODE_MANIFEST_INVALID | 502 | APP_AUTH |
| APP_SCOPE_FORBIDDEN | 503 | APP_AUTH |
| APP_SCOPE_REVOKED | 504 | APP_AUTH |
| GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND | 510 | GRANT |
| GRANT_TOKEN_CHAIN_ROOT_REQUIRED | 511 | GRANT |
| PAGE_TOKEN_INVALID | 520 | PAGE |
| KNOWLEDGE_INDEX_ALREADY_EXISTS | 530 | KNOWLEDGE |
| APP_MESSAGE_PAYLOAD_TOO_LARGE | 550 | APP_MESSAGE |
| APP_MESSAGE_RATE_LIMITED | 551 | APP_MESSAGE |
| APP_MESSAGE_LOOP_DETECTED | 552 | APP_MESSAGE |

### 12.3 Runtime — 错误映射矩阵

| ReasonCode | gRPC Code | 场景 | 出口形态 |
|---|---|---|---|
| REASON_CODE_UNSPECIFIED | OK | success_or_default | grpc_status |
| ACTION_EXECUTED | OK | success_confirmation | grpc_status |
| PROTOCOL_ENVELOPE_INVALID | INVALID_ARGUMENT | protocol_envelope_validation | grpc_status |
| PROTOCOL_DOMAIN_FIELD_CONFLICT | INVALID_ARGUMENT | protocol_envelope_validation | grpc_status |
| CAPABILITY_CATALOG_MISMATCH | FAILED_PRECONDITION | scope_catalog_validation | grpc_status |
| APP_NOT_REGISTERED | UNAUTHENTICATED | app_session_validation | grpc_status |
| EXTERNAL_PRINCIPAL_NOT_REGISTERED | UNAUTHENTICATED | external_principal_session_validation | grpc_status |
| PRINCIPAL_UNAUTHORIZED | PERMISSION_DENIED | authz_gate | grpc_status |
| APP_AUTHORIZATION_DENIED | PERMISSION_DENIED | app_authorization_gate | grpc_status |
| APP_GRANT_INVALID | INVALID_ARGUMENT | grant_validation | grpc_status |
| APP_TOKEN_EXPIRED | UNAUTHENTICATED | app_session_validation | grpc_status |
| APP_TOKEN_REVOKED | UNAUTHENTICATED | app_session_validation | grpc_status |
| APP_SCOPE_CATALOG_UNPUBLISHED | FAILED_PRECONDITION | scope_catalog_validation | grpc_status |
| APP_DELEGATION_FORBIDDEN | PERMISSION_DENIED | delegation_gate | grpc_status |
| APP_DELEGATION_DEPTH_EXCEEDED | FAILED_PRECONDITION | delegation_depth_guard | grpc_status |
| APP_RESOURCE_SELECTOR_INVALID | INVALID_ARGUMENT | resource_selector_validation | grpc_status |
| APP_RESOURCE_OUT_OF_SCOPE | PERMISSION_DENIED | resource_scope_gate | grpc_status |
| APP_CONSENT_MISSING | FAILED_PRECONDITION | consent_validation | grpc_status |
| APP_CONSENT_INVALID | INVALID_ARGUMENT | consent_validation | grpc_status |
| EXTERNAL_PRINCIPAL_PROOF_MISSING | INVALID_ARGUMENT | external_principal_proof_validation | grpc_status |
| EXTERNAL_PRINCIPAL_PROOF_INVALID | UNAUTHENTICATED | external_principal_proof_validation | grpc_status |
| APP_MODE_WORLD_RELATION_FORBIDDEN | PERMISSION_DENIED | app_mode_gate | grpc_status |
| AI_MODEL_NOT_READY | FAILED_PRECONDITION | model_health_check | grpc_status |
| AI_ROUTE_UNSUPPORTED | FAILED_PRECONDITION | consume_route_resolution | grpc_status |
| AI_ROUTE_FALLBACK_DENIED | FAILED_PRECONDITION | consume_route_fallback | grpc_status |
| AI_CONTENT_FILTER_BLOCKED | PERMISSION_DENIED | provider_content_filter | grpc_status |
| AI_REQUEST_CREDENTIAL_REQUIRED | FAILED_PRECONDITION | consume_credential_resolution | grpc_status |
| AI_REQUEST_CREDENTIAL_SCOPE_FORBIDDEN | PERMISSION_DENIED | consume_credential_scope_gate | grpc_status |
| SESSION_EXPIRED | UNAUTHENTICATED | authn_session_check | grpc_status |
| AUTH_TOKEN_INVALID | UNAUTHENTICATED | authn_all | grpc_status |
| AUTH_TOKEN_EXPIRED | UNAUTHENTICATED | external_principal_proof_expired | grpc_status |
| AUTH_UNSUPPORTED_PROOF_TYPE | INVALID_ARGUMENT | external_principal_registration | grpc_status |
| AI_CONNECTOR_NOT_FOUND | NOT_FOUND | consume_remote_or_hidden_connector | grpc_status |
| AI_CONNECTOR_DISABLED | FAILED_PRECONDITION | consume_or_connector_probe | grpc_status |
| AI_CONNECTOR_CREDENTIAL_MISSING | FAILED_PRECONDITION | consume_or_list_models | grpc_status |
| AI_CONNECTOR_INVALID | INVALID_ARGUMENT | connector_manage_input_validation | grpc_status |
| AI_CONNECTOR_INVALID | INVALID_ARGUMENT | consume_local_connector_managed_path | grpc_status |
| AI_CONNECTOR_IMMUTABLE | FAILED_PRECONDITION | connector_manage_immutable_field_update | grpc_status |
| AI_CONNECTOR_LIMIT_EXCEEDED | RESOURCE_EXHAUSTED | create_connector_limit_guard | grpc_status |
| AI_CONNECTOR_CREDENTIAL_MISSING | OK | test_connector | payload_ok_false |
| AI_REQUEST_CREDENTIAL_CONFLICT | INVALID_ARGUMENT | consume_entry | grpc_status |
| AI_REQUEST_CREDENTIAL_MISSING | INVALID_ARGUMENT | consume_entry | grpc_status |
| AI_REQUEST_CREDENTIAL_INVALID | INVALID_ARGUMENT | consume_inline_credential_validation | grpc_status |
| AI_CONNECTOR_ID_REQUIRED | INVALID_ARGUMENT | consume_entry | grpc_status |
| AI_APP_ID_REQUIRED | INVALID_ARGUMENT | consume_or_connector_manage | grpc_status |
| AI_APP_ID_CONFLICT | INVALID_ARGUMENT | app_id_metadata_body_conflict | grpc_status |
| AI_MODEL_ID_REQUIRED | INVALID_ARGUMENT | consume_entry | grpc_status |
| AI_MODEL_NOT_FOUND | NOT_FOUND | model_resolve | grpc_status |
| AI_MODALITY_NOT_SUPPORTED | FAILED_PRECONDITION | model_modality_capability_mismatch | grpc_status |
| AI_PROVIDER_ENDPOINT_FORBIDDEN | FAILED_PRECONDITION | consume_endpoint_validation | grpc_status |
| AI_PROVIDER_UNAVAILABLE | UNAVAILABLE | list_connector_models_remote | grpc_status |
| AI_PROVIDER_INTERNAL | INTERNAL | provider_upstream_internal_failure | grpc_status |
| AI_PROVIDER_RATE_LIMITED | RESOURCE_EXHAUSTED | provider_upstream_rate_limit | grpc_status |
| AI_PROVIDER_TIMEOUT | DEADLINE_EXCEEDED | stream_first_chunk_timeout | grpc_status |
| AI_INPUT_INVALID | INVALID_ARGUMENT | consume_or_media_input_validation | grpc_status |
| AI_OUTPUT_INVALID | INTERNAL | provider_output_decode | grpc_status |
| AI_STREAM_BROKEN | UNAVAILABLE | stream_mid_flight_disconnect | grpc_status |
| AI_PROVIDER_AUTH_FAILED | FAILED_PRECONDITION | media_snapshot_credential_invalid | grpc_status |
| AI_MEDIA_SPEC_INVALID | INVALID_ARGUMENT | submit_media_job | grpc_status |
| AI_MEDIA_OPTION_UNSUPPORTED | INVALID_ARGUMENT | submit_media_job | grpc_status |
| AI_MEDIA_JOB_NOT_FOUND | NOT_FOUND | media_control | grpc_status |
| AI_MEDIA_JOB_NOT_CANCELLABLE | FAILED_PRECONDITION | cancel_media_job | grpc_status |
| AI_MEDIA_IDEMPOTENCY_CONFLICT | ALREADY_EXISTS | submit_media_job | grpc_status |
| AI_ARTIFACT_UPLOAD_INVALID | INVALID_ARGUMENT | ai_artifact_upload | grpc_status |
| AI_ARTIFACT_UPLOAD_TOO_LARGE | INVALID_ARGUMENT | ai_artifact_upload | grpc_status |
| AI_REALTIME_SESSION_NOT_FOUND | NOT_FOUND | ai_realtime_session | grpc_status |
| AI_REALTIME_SESSION_CLOSED | FAILED_PRECONDITION | ai_realtime_session | grpc_status |
| AI_VOICE_INPUT_INVALID | INVALID_ARGUMENT | submit_voice_job | grpc_status |
| AI_VOICE_WORKFLOW_UNSUPPORTED | FAILED_PRECONDITION | submit_voice_job | grpc_status |
| AI_VOICE_ASSET_NOT_FOUND | NOT_FOUND | voice_asset_query_or_delete | grpc_status |
| AI_VOICE_ASSET_EXPIRED | FAILED_PRECONDITION | tts_synthesize_voice_asset | grpc_status |
| AI_VOICE_ASSET_SCOPE_FORBIDDEN | PERMISSION_DENIED | cross_tenant_voice_asset_access | grpc_status |
| AI_VOICE_TARGET_MODEL_MISMATCH | INVALID_ARGUMENT | tts_synthesize_voice_asset | grpc_status |
| AI_VOICE_JOB_NOT_FOUND | NOT_FOUND | voice_job_query_or_cancel | grpc_status |
| AI_VOICE_JOB_NOT_CANCELLABLE | FAILED_PRECONDITION | cancel_voice_job | grpc_status |
| AI_FINISH_LENGTH | OK | generate_or_stream_terminal_reason | terminal_reason_non_error |
| AI_FINISH_CONTENT_FILTER | OK | generate_or_stream_terminal_reason | terminal_reason_non_error |
| AI_MODEL_PROVIDER_MISMATCH | INVALID_ARGUMENT | model_prefix_provider_mismatch | grpc_status |
| AI_LOCAL_MODEL_PROFILE_MISSING | FAILED_PRECONDITION | local_consume_or_probe | grpc_status_or_payload_ok_false |
| AI_LOCAL_MODEL_UNAVAILABLE | FAILED_PRECONDITION | local_consume_or_probe | grpc_status_or_payload_ok_false |
| AI_LOCAL_ASSET_ALREADY_INSTALLED | ALREADY_EXISTS | install_local_model_duplicate | grpc_status |
| AI_LOCAL_SERVICE_UNAVAILABLE | FAILED_PRECONDITION | local_service_lifecycle_or_probe | grpc_status_or_payload_ok_false |
| AI_LOCAL_SERVICE_ALREADY_INSTALLED | ALREADY_EXISTS | install_local_service_duplicate | grpc_status |
| AI_LOCAL_ENDPOINT_REQUIRED | INVALID_ARGUMENT | install_or_start_local_model_endpoint_required | grpc_status |
| AI_LOCAL_TEMPLATE_NOT_FOUND | NOT_FOUND | install_verified_model_template_missing | grpc_status |
| AI_LOCAL_MANIFEST_INVALID | INVALID_ARGUMENT | import_local_model_manifest_parse_fail | grpc_status |
| AI_LOCAL_MODEL_INVALID_TRANSITION | FAILED_PRECONDITION | local_model_or_service_state_transition | grpc_status |
| AI_LOCAL_SERVICE_INVALID_TRANSITION | FAILED_PRECONDITION | local_service_state_transition | grpc_status |
| AI_LOCAL_ASSET_ALREADY_INSTALLED | ALREADY_EXISTS | local_asset_install | grpc_status |
| AI_LOCAL_ASSET_SLOT_MISSING | FAILED_PRECONDITION | local_profile_slot_resolution | grpc_status |
| AI_LOCAL_ASSET_SLOT_FORBIDDEN | INVALID_ARGUMENT | local_profile_slot_resolution | grpc_status |
| AI_LOCAL_PROFILE_SLOT_CONFLICT | INVALID_ARGUMENT | local_profile_slot_resolution | grpc_status |
| AI_LOCAL_PROFILE_OVERRIDE_FORBIDDEN | INVALID_ARGUMENT | local_profile_entry_override | grpc_status |
| AI_LOCAL_DOWNLOAD_FAILED | INTERNAL | local_model_download | grpc_status |
| AI_LOCAL_DOWNLOAD_HASH_MISMATCH | DATA_LOSS | local_model_download_verify | grpc_status |
| AI_LOCAL_HF_REPO_INVALID | INVALID_ARGUMENT | local_model_hf_repo_parse | grpc_status |
| AI_LOCAL_HF_SEARCH_FAILED | UNAVAILABLE | local_model_hf_search | grpc_status |
| AI_LOCAL_MANIFEST_SCHEMA_INVALID | INVALID_ARGUMENT | local_model_manifest_schema_validate | grpc_status |
| AI_MODULE_CONFIG_INVALID | FAILED_PRECONDITION | runtime_module_boot_or_reload | grpc_status |
| APP_MODE_DOMAIN_FORBIDDEN | PERMISSION_DENIED | app_mode_gate | grpc_status |
| APP_MODE_SCOPE_FORBIDDEN | PERMISSION_DENIED | app_mode_gate | grpc_status |
| APP_MODE_MANIFEST_INVALID | INVALID_ARGUMENT | register_app_manifest_validation | grpc_status |
| APP_SCOPE_FORBIDDEN | PERMISSION_DENIED | scope_prefix_gate | grpc_status |
| APP_SCOPE_REVOKED | PERMISSION_DENIED | scope_revocation_check | grpc_status |
| APP_MESSAGE_PAYLOAD_TOO_LARGE | INVALID_ARGUMENT | app_message_send | grpc_status |
| APP_MESSAGE_RATE_LIMITED | RESOURCE_EXHAUSTED | app_message_send | grpc_status |
| APP_MESSAGE_LOOP_DETECTED | FAILED_PRECONDITION | app_message_send | grpc_status |
| WF_DAG_INVALID | INVALID_ARGUMENT | workflow_submit | grpc_status |
| WF_NODE_CONFIG_MISMATCH | INVALID_ARGUMENT | workflow_submit | grpc_status |
| WF_TIMEOUT | DEADLINE_EXCEEDED | workflow_execute | grpc_status |
| WF_TASK_NOT_FOUND | NOT_FOUND | workflow_query | grpc_status |
| GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND | NOT_FOUND | grant_list_token_chain | grpc_status |
| GRANT_TOKEN_CHAIN_ROOT_REQUIRED | INVALID_ARGUMENT | grant_list_token_chain | grpc_status |
| PAGE_TOKEN_INVALID | INVALID_ARGUMENT | list_rpc_page_token_validation | grpc_status |
| KNOWLEDGE_INDEX_ALREADY_EXISTS | ALREADY_EXISTS | build_knowledge_index_without_overwrite | grpc_status |

### 12.4 Runtime — Key Source 真值表

| 场景 | key_source | connector_id | inline 凭据 | 有效 | 错误码 |
|---|---|---|---|---|---|
| managed_with_connector_id | omitted_or_managed | required_non_empty | forbidden/forbidden/forbidden | 是 | — |
| managed_missing_connector_id | managed | missing_or_empty | forbidden/forbidden/forbidden | 否 | AI_CONNECTOR_ID_REQUIRED |
| inline_complete_with_default_endpoint | inline | forbidden | required_non_empty/optional/required_non_empty | 是 | — |
| inline_missing_provider_type | inline | forbidden | missing_or_empty/optional/required_non_empty | 否 | AI_REQUEST_CREDENTIAL_MISSING |
| inline_missing_api_key | inline | forbidden | required_non_empty/optional/missing_or_empty | 否 | AI_REQUEST_CREDENTIAL_MISSING |
| inline_missing_required_endpoint | inline | forbidden | required_non_empty_requires_explicit_endpoint_provider/missing_or_empty/required_non_empty | 否 | AI_REQUEST_CREDENTIAL_MISSING |
| conflict_connector_and_inline | inline_or_managed | required_non_empty | required_non_empty/optional/required_non_empty | 否 | AI_REQUEST_CREDENTIAL_CONFLICT |

### 12.5 Runtime — 状态机

**connector_status**

状态: ACTIVE → DISABLED

| 从 | 到 | 触发条件 |
|---|---|---|
| ACTIVE | DISABLED | UpdateConnector(status=DISABLED) |
| DISABLED | ACTIVE | UpdateConnector(status=ACTIVE) |

**remote_connector_delete_flow**

状态: PRESENT → DELETE_PENDING → DELETED

| 从 | 到 | 触发条件 |
|---|---|---|
| PRESENT | DELETE_PENDING | DeleteConnector_step1_mark_pending |
| DELETE_PENDING | DELETE_PENDING | DeleteConnector_retry_or_startup_rescan |
| DELETE_PENDING | DELETED | credential_cleanup_and_registry_delete |

**scenario_job**

状态: SUBMITTED → QUEUED → RUNNING → COMPLETED → FAILED → CANCELED → TIMEOUT

| 从 | 到 | 触发条件 |
|---|---|---|
| SUBMITTED | QUEUED | accepted_into_queue |
| SUBMITTED | RUNNING | provider_accepts_job |
| SUBMITTED | FAILED | terminal_error_before_run |
| SUBMITTED | CANCELED | user_cancel |
| SUBMITTED | TIMEOUT | job_timeout |
| QUEUED | RUNNING | provider_accepts_job |
| QUEUED | FAILED | terminal_error_before_run |
| QUEUED | CANCELED | user_cancel |
| QUEUED | TIMEOUT | job_timeout |
| RUNNING | COMPLETED | provider_success |
| RUNNING | FAILED | provider_or_runtime_failure |
| RUNNING | CANCELED | user_cancel |
| RUNNING | TIMEOUT | job_timeout |

**local_model_lifecycle**

状态: INSTALLED → ACTIVE → UNHEALTHY → REMOVED

| 从 | 到 | 触发条件 |
|---|---|---|
| INSTALLED | ACTIVE | warm_or_minimal_execution_passed |
| INSTALLED | UNHEALTHY | warm_or_runtime_failure |
| ACTIVE | UNHEALTHY | readiness_or_runtime_failure |
| UNHEALTHY | ACTIVE | recovery_validation_passed |
| ACTIVE | REMOVED | remove_model |
| UNHEALTHY | REMOVED | force_remove_model |
| ACTIVE | INSTALLED | maintenance_stop |
| UNHEALTHY | INSTALLED | maintenance_stop_from_unhealthy |
| INSTALLED | REMOVED | remove_model_from_installed |

**local_service_lifecycle**

状态: INSTALLED → ACTIVE → UNHEALTHY → REMOVED

| 从 | 到 | 触发条件 |
|---|---|---|
| INSTALLED | ACTIVE | spawn_and_probe_ok |
| ACTIVE | UNHEALTHY | health_probe_failed |
| UNHEALTHY | ACTIVE | restart_and_probe_ok |
| ACTIVE | REMOVED | stop_and_cleanup |
| UNHEALTHY | REMOVED | force_stop_and_cleanup |
| ACTIVE | INSTALLED | stop_service |
| UNHEALTHY | INSTALLED | stop_service_from_unhealthy |
| INSTALLED | REMOVED | remove_service_from_installed |

**model_status**

状态: INSTALLED → PULLING → FAILED → REMOVED

| 从 | 到 | 触发条件 |
|---|---|---|
| INSTALLED | PULLING | pull_model_update |
| PULLING | INSTALLED | pull_success |
| PULLING | FAILED | pull_error |
| INSTALLED | REMOVED | remove_model |
| FAILED | PULLING | retry_pull |
| FAILED | REMOVED | remove_failed_model |

### 12.6 Runtime — 本地引擎目录

| 引擎 | 默认 Endpoint | 运行模式 | 协议 |
|---|---|---|---|
| llama | — | attached_endpoint | nimi_runtime_text |
| llama | — | supervised | nimi_runtime_text |
| media | — | attached_endpoint | nimi_runtime_media |
| media | — | supervised | nimi_runtime_media |
| speech | — | attached_endpoint | nimi_runtime_speech |
| speech | — | supervised | nimi_runtime_speech |
| sidecar | — | attached_endpoint | nimi_music_http |

### 12.7 Runtime — 本地适配器路由

| Provider | Capability | Adapter |
|---|---|---|
| llama | chat | llama_native_adapter |
| llama | text.generate | llama_native_adapter |
| llama | embedding | llama_native_adapter |
| llama | embed | llama_native_adapter |
| llama | text.embed | llama_native_adapter |
| llama | image.understand | llama_native_adapter |
| llama | audio.understand | llama_native_adapter |
| media | image.generate | media_native_adapter |
| media | image.edit | media_native_adapter |
| media | video.generate | media_native_adapter |
| media | i2v | media_native_adapter |
| speech | audio.transcribe | speech_native_adapter |
| speech | audio.synthesize | speech_native_adapter |
| speech | voice_workflow.tts_v2v | speech_native_adapter |
| speech | voice_workflow.tts_t2v | speech_native_adapter |
| sidecar | music | sidecar_music_adapter |
| sidecar | music.generate | sidecar_music_adapter |
| * | * | openai_compat_adapter |

### 12.8 SDK — 错误码

| 名称 | 族 | 描述 |
|---|---|---|
| SDK_APP_ID_REQUIRED | SDK_CONFIG | — |
| SDK_TRANSPORT_INVALID | SDK_CONFIG | — |
| SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED | SDK_CONFIG | — |
| SDK_RUNTIME_VERSION_INCOMPATIBLE | SDK_CONFIG | — |
| SDK_RUNTIME_METHOD_UNAVAILABLE | SDK_CONFIG | — |
| SDK_PLATFORM_CLIENT_NOT_READY | SDK_CONFIG | — |
| SDK_AI_PROVIDER_RUNTIME_REQUIRED | SDK_AI_PROVIDER | — |
| SDK_AI_PROVIDER_SUBJECT_USER_ID_REQUIRED | SDK_AI_PROVIDER | — |
| SDK_AI_PROVIDER_CONFIG_INVALID | SDK_AI_PROVIDER | — |
| SDK_SCOPE_CATALOG_INVALID | SDK_SCOPE | — |
| SDK_SCOPE_CATALOG_VERSION_CONFLICT | SDK_SCOPE | — |
| SDK_REALM_ENDPOINT_REQUIRED | SDK_REALM | — |
| SDK_REALM_TOKEN_REQUIRED | SDK_REALM | — |
| SDK_REALM_CONFIG_INVALID | SDK_REALM | — |
| SDK_MOD_HOST_MISSING | SDK_MOD | — |
| SDK_AI_PROVIDER_BASE64_UNAVAILABLE | SDK_AI_PROVIDER | — |
| SDK_RUNTIME_BASE64_DECODER_UNAVAILABLE | SDK_RUNTIME | — |
| SDK_RUNTIME_BASE64_ENCODER_UNAVAILABLE | SDK_RUNTIME | — |
| SDK_RUNTIME_CODEC_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_NODE_GRPC_EMPTY_RESPONSE | SDK_RUNTIME | — |
| SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_NODE_GRPC_UNARY_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_REQUEST_BYTES_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_REQUEST_ENCODE_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_RESPONSE_DECODE_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_STREAM_DECODE_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_INVOKE_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_LISTEN_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_STREAM_CLOSE_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_STREAM_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_STREAM_ID_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_STREAM_REMOTE_ERROR | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_TAURI_UNARY_FAILED | SDK_RUNTIME | — |
| SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_AI_CREDENTIAL_SOURCE_INVALID | SDK_RUNTIME | — |
| SDK_RUNTIME_AI_CREDENTIAL_MISSING | SDK_RUNTIME | — |
| SDK_RUNTIME_AI_CREDENTIAL_SCOPE_FORBIDDEN | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_DOMAIN_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_APP_ID_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_ID_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_TYPE_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_SUBJECT_USER_ID_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_CONSENT_ID_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_CONSENT_VERSION_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_DECISION_AT_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_POLICY_VERSION_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_POLICY_MODE_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_PRESET_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_CUSTOM_SCOPES_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_CUSTOM_TTL_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_CUSTOM_DELEGATE_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_APP_AUTH_SCOPE_CATALOG_VERSION_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_CONNECTOR_API_KEY_REQUIRED | SDK_RUNTIME | — |
| SDK_RUNTIME_CONNECTOR_UPDATE_EMPTY | SDK_RUNTIME | — |
| SDK_TARGET_REQUIRED | SDK_CONFIG | — |
| OPERATION_ABORTED | SDK_SYNTHETIC_REASON | — |
| RUNTIME_UNAVAILABLE | SDK_SYNTHETIC_REASON | — |
| RUNTIME_BRIDGE_DAEMON_UNAVAILABLE | SDK_SYNTHETIC_REASON | — |

### 12.9 SDK — 导入边界

| 子路径 | 禁止导入 | 基线规则 |
|---|---|---|

### 12.10 SDK — Runtime 方法投影分组

**ai_service_projection** → AIService

- ExecuteScenario
- StreamScenario
- SubmitScenarioJob
- GetScenarioJob
- CancelScenarioJob
- SubscribeScenarioJobEvents
- GetScenarioArtifacts
- ListScenarioProfiles
- GetVoiceAsset
- ListVoiceAssets
- DeleteVoiceAsset
- ListPresetVoices

**connector_service_projection** → ConnectorService

- CreateConnector
- GetConnector
- ListConnectors
- UpdateConnector
- DeleteConnector
- TestConnector
- ListConnectorModels
- ListProviderCatalog
- ListModelCatalogProviders
- UpsertModelCatalogProvider
- DeleteModelCatalogProvider

**ai_realtime_service_projection** → RuntimeAiRealtimeService

- OpenRealtimeSession
- AppendRealtimeInput
- ReadRealtimeEvents
- CloseRealtimeSession

**local_service_projection** → RuntimeLocalService

- ListLocalAssets
- RemoveLocalAsset
- StartLocalAsset
- StopLocalAsset
- CheckLocalAssetHealth
- WarmLocalAsset
- ListVerifiedAssets
- SearchCatalogModels
- ResolveModelInstallPlan
- InstallVerifiedAsset
- ImportLocalAsset
- ImportLocalAssetFile
- CollectDeviceProfile
- ListLocalServices
- InstallLocalService
- StartLocalService
- StopLocalService
- CheckLocalServiceHealth
- RemoveLocalService
- ListNodeCatalog
- ScanUnregisteredAssets
- ScaffoldOrphanAsset
- ResolveProfile
- ApplyProfile
- ListLocalAudits
- AppendInferenceAudit
- AppendRuntimeAudit
- ListEngines
- EnsureEngine
- StartEngine
- StopEngine
- GetEngineStatus

**auth_service_projection** → RuntimeAuthService

- RegisterApp
- OpenSession
- RefreshSession
- RevokeSession
- RegisterExternalPrincipal
- OpenExternalPrincipalSession
- RevokeExternalPrincipalSession

**grant_service_projection** → RuntimeGrantService

- AuthorizeExternalPrincipal
- ValidateAppAccessToken
- RevokeAppAccessToken
- IssueDelegatedAccessToken
- ListTokenChain

**workflow_service_projection** → RuntimeWorkflowService

- SubmitWorkflow
- GetWorkflow
- CancelWorkflow
- SubscribeWorkflowEvents

**health_monitoring_projection** → RuntimeAuditService

- GetRuntimeHealth
- ListAIProviderHealth
- SubscribeAIProviderHealthEvents
- SubscribeRuntimeHealthEvents

**audit_service_projection** → RuntimeAuditService

- ListAuditEvents
- ExportAuditEvents
- ListUsageStats

**model_service_projection** → RuntimeModelService

- ListModels
- PullModel
- RemoveModel
- CheckModelHealth

**knowledge_service_projection** → RuntimeKnowledgeService

- BuildIndex
- SearchIndex
- DeleteIndex

**app_service_projection** → RuntimeAppService

- SendAppMessage
- SubscribeAppMessages

### 12.11 Desktop — 启动阶段

| 阶段 | 顺序 | 描述 |
|---|---|---|
| runtime-defaults | 1 | Load realm base URL, access token, and execution defaults from Tauri bridge |
| platform-client | 2 | Initialize platform client with realm endpoint and access token |
| datasync-init | 3 | Initialize DataSync facade with realm config and proxy fetch |
| runtime-host | 4 | Wire mod SDK host, hook runtime, speech route resolver, and data capabilities |
| runtime-mods | 5 | Register bootstrap runtime mods from local manifests |
| external-agent | 6 | Register tier-1 external agent actions and start action bridge |
| auth-session | 7 | Bootstrap authentication session (token exchange or anonymous fallback) |
| bootstrap-ready | 8 | Set bootstrapReady=true, clear bootstrapError, emit completion log |

### 12.12 Desktop — IPC 命令

| 命令 | 描述 |
|---|---|
| runtime_defaults | Get realm and runtime execution defaults |
| auth_session_load | Load the shared encrypted desktop auth session from ~/.nimi/auth/session.v1.json |
| auth_session_save | Atomically overwrite the shared encrypted desktop auth session |
| auth_session_clear | Delete the shared desktop auth session file |
| desktop_release_info_get | Read validated desktop release metadata for the packaged shell + bundled runtime unit |
| desktop_update_state_get | Read current desktop updater state machine snapshot |
| desktop_update_check | Check GitHub release metadata for a newer packaged desktop update |
| desktop_update_download | Download the currently available packaged desktop update |
| desktop_update_install | Consume already-downloaded update bytes and enter installer stage for the packaged desktop update |
| desktop_update_restart | Restart the packaged desktop after updater install is ready |
| get_system_resource_snapshot | Collect system resource snapshot (CPU, memory, GPU) for device profiling |
| http_request | Proxy HTTP request through Tauri backend (bypasses browser CORS) |
| open_external_url | Open external URL in system browser |
| oauth_token_exchange | Exchange OAuth authorization code for tokens |
| oauth_listen_for_code | Listen for OAuth callback code on redirect URI |
| confirm_private_sync | Confirm private data sync for agent/session |
| log_renderer_event | Forward renderer-side structured log event to Tauri backend logger |
| start_window_drag | Start native window drag operation |
| menu_bar_sync_runtime_health | Sync menu bar runtime/provider health summary from renderer to Tauri backend |
| menu_bar_complete_quit | Finalize explicit app quit after renderer cleanup |
| runtime_mod_append_audit | Append mod audit record |
| runtime_mod_query_audit | Query mod audit records |
| runtime_mod_delete_audit | Delete mod audit record |
| runtime_mod_list_local_manifests | List local mod manifest summaries |
| runtime_mod_list_installed | List installed runtime mods |
| runtime_mod_sources_list | List registered runtime mod source directories |
| runtime_mod_sources_upsert | Add or update a runtime mod source directory |
| runtime_mod_sources_remove | Remove a runtime mod source directory |
| runtime_mod_dev_mode_get | Read Desktop Mod Developer Mode state |
| runtime_mod_dev_mode_set | Update Desktop Mod Developer Mode state |
| runtime_mod_storage_dirs_get | Read Desktop nimi_dir and nimi_data_dir storage directories |
| runtime_mod_data_dir_set | Update Desktop nimi_data_dir and switch storage roots |
| runtime_mod_diagnostics_list | List runtime mod source diagnostics and conflict records |
| runtime_mod_reload | Trigger reload diagnostics for a single runtime mod |
| runtime_mod_reload_all | Trigger reload diagnostics for all runtime mods |
| runtime_mod_install | Install a prebuilt runtime mod from directory, archive, or URL |
| runtime_mod_update | Update an installed runtime mod from a prebuilt package source |
| runtime_mod_uninstall | Uninstall an installed runtime mod package without deleting its mod-data directory |
| runtime_mod_read_manifest | Read an installed runtime mod manifest |
| runtime_mod_install_progress | Query runtime mod install progress events |
| runtime_mod_read_local_entry | Read local mod entry source code |
| runtime_mod_read_local_asset | Read manifest-declared local mod asset payload |
| runtime_mod_get_action_idempotency | Get mod action idempotency record |
| runtime_mod_put_action_idempotency | Put mod action idempotency record |
| runtime_mod_purge_action_idempotency | Purge expired mod action idempotency records |
| runtime_mod_get_action_verify_ticket | Get mod action verify ticket |
| runtime_mod_put_action_verify_ticket | Put mod action verify ticket |
| runtime_mod_delete_action_verify_ticket | Delete mod action verify ticket |
| runtime_mod_purge_action_verify_tickets | Purge expired mod action verify tickets |
| runtime_mod_put_action_execution_ledger | Put mod action execution ledger entry |
| runtime_mod_query_action_execution_ledger | Query mod action execution ledger |
| runtime_mod_purge_action_execution_ledger | Purge expired mod action execution ledger entries |
| runtime_mod_media_cache_put | Put media blob into mod media cache |
| runtime_mod_media_cache_gc | Garbage-collect expired mod media cache entries |
| runtime_mod_storage_file_read | Read a text or binary file from the caller mod's files storage subtree |
| runtime_mod_storage_file_write | Atomically write a text or binary file into the caller mod's files storage subtree |
| runtime_mod_storage_file_delete | Delete a file or directory from the caller mod's files storage subtree |
| runtime_mod_storage_file_list | List entries under the caller mod's files storage subtree |
| runtime_mod_storage_file_stat | Read metadata for a path under the caller mod's files storage subtree |
| runtime_mod_storage_sqlite_query | Execute a read query against the caller mod's sqlite/main.db |
| runtime_mod_storage_sqlite_execute | Execute a write statement against the caller mod's sqlite/main.db |
| runtime_mod_storage_sqlite_transaction | Execute a write transaction against the caller mod's sqlite/main.db |
| runtime_mod_storage_data_purge | Delete the caller mod's host-managed mod-data directory |
| external_agent_issue_token | Issue external agent access token |
| external_agent_revoke_token | Revoke external agent access token |
| external_agent_list_tokens | List external agent tokens |
| external_agent_verify_execution_context | Verify external agent execution context before action dispatch |
| external_agent_sync_action_descriptors | Sync external agent action descriptors |
| external_agent_complete_execution | Complete external agent action execution |
| external_agent_gateway_status | Get external agent gateway status |
| runtime_bridge_unary | Forward a unary gRPC call to runtime daemon via IPC bridge |
| runtime_bridge_stream_open | Open a server-streaming gRPC call to runtime daemon via IPC bridge |
| runtime_bridge_stream_close | Close an active server-streaming gRPC call via IPC bridge |
| runtime_bridge_status | Get runtime daemon status (running, managed, launchMode, grpcAddr) |
| runtime_bridge_start | Start runtime daemon |
| runtime_bridge_stop | Stop runtime daemon |
| runtime_bridge_restart | Restart runtime daemon |
| runtime_bridge_config_get | Get runtime bridge configuration |
| runtime_bridge_config_set | Set runtime bridge configuration |
| runtime_local_audits_list | Host helper surface for local AI audit listing; shipped product paths must treat runtime audit state as authoritative |
| runtime_local_pick_asset_manifest_path | Pick a local AI asset.manifest.json path under the runtime models root via native file dialog |
| runtime_local_assets_install_verified | Install a verified asset through the runtime-authoritative verified asset catalog |
| runtime_local_assets_import | Import a local asset from an asset.manifest.json file |
| runtime_local_models_catalog_search | Host catalog helper; catalog/install-plan truth must remain runtime-owned |
| runtime_local_models_catalog_list_variants | Host catalog helper for model variants; not a local model state truth source |
| runtime_local_models_catalog_resolve_install_plan | Host install-plan helper; product install-plan truth must remain runtime-owned |
| runtime_local_profiles_resolve | Resolve a mod-declared local AI profile into an executable runtime plan |
| runtime_local_device_profile_collect | Collect local device profile (CPU/GPU/NPU/disk/ports) |
| runtime_local_recommendation_feed_get | Read capability-scoped host recommendation feed; helper-only and not a local model truth source |
| runtime_local_profiles_apply | Apply a resolved local AI profile after host confirmation without creating Desktop-owned local model truth |
| runtime_local_services_list | Host helper surface for local service listing; shipped product paths must treat RuntimeLocalService as the service truth source |
| runtime_local_services_install | Host service install helper; shipped product install truth must come from RuntimeLocalService |
| runtime_local_services_start | Host service start helper; shipped product lifecycle truth must come from RuntimeLocalService |
| runtime_local_services_stop | Host service stop helper; shipped product lifecycle truth must come from RuntimeLocalService |
| runtime_local_services_health | Host service health helper; shipped product health truth must come from RuntimeLocalService |
| runtime_local_services_remove | Host service removal helper; shipped product removal truth must come from RuntimeLocalService |
| runtime_local_nodes_catalog_list | Host node-catalog helper; node availability truth remains runtime-owned |
| runtime_local_assets_install | Install an asset from catalog parameters; execution truth is RuntimeLocalService |
| runtime_local_assets_import_file | Import a local asset file; execution truth is RuntimeLocalService |
| runtime_local_assets_remove | Remove an installed asset; execution truth is RuntimeLocalService |
| runtime_local_assets_start | Start a runnable asset; lifecycle truth is RuntimeLocalService |
| runtime_local_assets_stop | Stop a running asset; lifecycle truth is RuntimeLocalService |
| runtime_local_assets_health | Check asset health; health truth is RuntimeLocalService |
| runtime_local_downloads_list | List active download/transfer sessions |
| runtime_local_downloads_pause | Pause an active download session |
| runtime_local_downloads_resume | Resume a paused download session |
| runtime_local_downloads_cancel | Cancel an active download session |
| runtime_local_pick_asset_file | Pick a local asset file for import via native file dialog |
| runtime_local_append_inference_audit | Append a local AI inference audit record |
| runtime_local_append_runtime_audit | Append local runtime audit event |
| runtime_local_assets_reveal_in_folder | Reveal installed asset files in system file manager |
| runtime_local_assets_reveal_root_folder | Reveal the runtime models root folder in the system file manager |
| runtime_local_assets_scan_unregistered | Host-local unregistered asset helper; if shipped product paths have runtime scan coverage, runtime remains the only truth source |

### 12.13 Desktop — App Tabs

| Tab ID | 名称 | Nav Group | Feature Gate |
|---|---|---|---|
| home | Home | core | — |
| chat | Chat | core | — |
| contacts | Contacts | core | — |
| world | World | core | — |
| explore | Explore | core | — |
| runtime | AI Runtime | core | enableRuntimeTab |
| settings | Settings | core | — |
| mods | Mods | mod-nav | enableModUi |
| profile | Profile | detail | — |
| agent-detail | Agent Detail | detail | — |
| world-detail | World Detail | detail | — |
| notification | Notification | detail | — |
| gift-inbox | Gifts | detail | — |
| privacy-policy | Privacy Policy | detail | — |
| terms-of-service | Terms of Service | detail | — |
| mod:* | Mod Workspace | mod | enableModWorkspaceTabs |

### 12.14 Desktop — Store Slices

| Slice | 描述 | Factory |
|---|---|---|
| auth | Authentication status, user object, and token management | createAuthSlice |
| runtime | Runtime execution fields (provider, model, agent, world bindings) | createRuntimeSlice |
| mod-workspace | Mod workspace tabs, fused mod tracking, mod failures | createModWorkspaceSlice |
| ui | Active tab, selected IDs, profile detail overlay state, navigation history, status banner | createUiSlice |

### 12.15 Desktop — Hook 子系统

| 子系统 | Namespace | 描述 |
|---|---|---|
| event | event.publish.*|event.subscribe.* | Pub/sub event bus for inter-mod and system event communication |
| data | data.query.*|data.register.* | Shared data capability registration and querying |
| turn | turn.register.* | Turn hook points for intercepting AI conversation lifecycle |
| ui | ui.register.* | UI slot registration for visual extension points |
| storage | storage.files.*|storage.sqlite.* | Host-managed per-mod file and sqlite persistence |
| inter-mod | inter-mod.request.*|inter-mod.provide.* | Cross-mod RPC-style request/provide channels |

### 12.16 Desktop — UI Slots

| 槽位 | 描述 |
|---|---|
| auth.login.form.footer | Login form footer area for additional auth providers or links |
| chat.sidebar.header | Chat sidebar header for custom controls or branding |
| chat.chat.list.item.trailing | Trailing content in chat list item rows |
| chat.turn.input.toolbar | Turn input toolbar for custom action buttons |
| settings.panel.section | Settings panel additional section for mod settings |
| ui-extension.app.sidebar.mods | Mod-provided navigation entries (available for mods to register; primary mod navigation is via the Mods Panel) |
| ui-extension.app.content.routes | App content area for mod-provided routes |
| ui-extension.runtime.devtools.panel | Runtime devtools panel for debug/inspection tools |

### 12.17 Desktop — Turn Hook Points

| Hook Point | 执行顺序 | 描述 |
|---|---|---|
| pre-policy | 1 | Before policy evaluation — input validation and preprocessing |
| pre-model | 2 | Before model invocation — prompt augmentation, context injection |
| post-state | 3 | After state update — response postprocessing, side effects |
| pre-commit | 4 | Before commit to persistence — final validation, audit logging |

### 12.18 Desktop — Hook Capability Allowlists

| Source Type | 能力模式 | 描述 |
|---|---|---|
| core | * | Full unrestricted access for core platform code |
| builtin | event.publish.*, event.subscribe.*, data.query.*, data.register.*, turn.register.*, ui.register.*, inter-mod.request.*, inter-mod.provide.*, storage.files.read, storage.files.write, storage.files.delete, storage.files.list, storage.sqlite.query, storage.sqlite.execute, storage.sqlite.transaction, runtime.ai.text.generate, runtime.ai.text.stream, runtime.ai.embedding.generate, runtime.media.image.generate, runtime.media.image.stream, runtime.media.video.generate, runtime.media.video.stream, runtime.media.tts.list.voices, runtime.media.tts.synthesize, runtime.media.tts.stream, runtime.media.stt.transcribe, runtime.media.jobs.submit, runtime.media.jobs.get, runtime.media.jobs.cancel, runtime.media.jobs.subscribe, runtime.media.jobs.get.artifacts, runtime.voice.get.asset, runtime.voice.list.assets, runtime.voice.delete.asset, runtime.voice.list.preset.voices, runtime.route.list.options, runtime.route.resolve, runtime.route.check.health, runtime.route.describe, runtime.local.assets.list, runtime.local.profiles.list, runtime.local.profiles.install.request, runtime.profile.read.agent, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self, meta.read.all | Platform-bundled desktop mods shipped with the product; trust level is below core and above injected/sideload sources |
| injected | event.publish.*, event.subscribe.*, data.query.*, data.register.*, turn.register.pre-model, turn.register.post-state, ui.register.*, inter-mod.request.*, storage.files.read, storage.files.write, storage.files.delete, storage.files.list, storage.sqlite.query, storage.sqlite.execute, storage.sqlite.transaction, runtime.ai.text.generate, runtime.ai.text.stream, runtime.ai.embedding.generate, runtime.media.image.generate, runtime.media.image.stream, runtime.media.video.generate, runtime.media.video.stream, runtime.media.tts.list.voices, runtime.media.tts.synthesize, runtime.media.tts.stream, runtime.media.stt.transcribe, runtime.media.jobs.submit, runtime.media.jobs.get, runtime.media.jobs.cancel, runtime.media.jobs.subscribe, runtime.media.jobs.get.artifacts, runtime.voice.get.asset, runtime.voice.list.assets, runtime.voice.delete.asset, runtime.voice.list.preset.voices, runtime.route.list.options, runtime.route.resolve, runtime.route.check.health, runtime.route.describe, runtime.local.assets.list, runtime.local.profiles.list, runtime.local.profiles.install.request, runtime.profile.read.agent, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self | Third-party injected mods with restricted turn hook access |
| sideload | event.publish.*, data.query.*, ui.register.*, inter-mod.request.*, storage.files.read, storage.files.write, storage.files.delete, storage.files.list, storage.sqlite.query, storage.sqlite.execute, storage.sqlite.transaction, runtime.ai.text.generate, runtime.ai.text.stream, runtime.ai.embedding.generate, runtime.media.image.generate, runtime.media.image.stream, runtime.media.video.generate, runtime.media.video.stream, runtime.media.tts.list.voices, runtime.media.tts.synthesize, runtime.media.tts.stream, runtime.media.stt.transcribe, runtime.media.jobs.submit, runtime.media.jobs.get, runtime.media.jobs.cancel, runtime.media.jobs.subscribe, runtime.media.jobs.get.artifacts, runtime.voice.get.asset, runtime.voice.list.assets, runtime.voice.delete.asset, runtime.voice.list.preset.voices, runtime.route.list.options, runtime.route.resolve, runtime.route.check.health, runtime.route.describe, runtime.local.assets.list, runtime.local.profiles.list, runtime.local.profiles.install.request, runtime.profile.read.agent, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self | Locally installed mods and catalog-installed mods share the sideload capability envelope; catalog provenance does not elevate permissions |
| codegen | runtime.ai.text.generate, runtime.ai.text.stream, ui.register.ui-extension.app.*, data.register.data-api.user-*.*.*, data.query.data-api.user-*.*.*, audit.read.self, meta.read.self | AI-generated mods with minimal capabilities |

### 12.19 Desktop — Mod 生命周期状态

| 状态 | 描述 |
|---|---|
| DISCOVERED | Mod package located but not yet verified |
| VERIFIED | Manifest parsed and signature/compat checks passed |
| INSTALLED | Dependencies resolved and mod bundle built |
| ENABLED | Mod loaded and active in runtime |
| DISABLED | Mod deactivated but still installed |
| UNINSTALLED | Mod removed from local storage |
| UPDATING | Mod transitioning between versions |
| ROLLBACK_DISABLED | Mod disabled due to failed update, awaiting rollback or removal |

### 12.20 Desktop — Mod 内核阶段

| 阶段 | 顺序 | 描述 |
|---|---|---|
| discovery | 1 | Locate mod package and validate source reference |
| manifest/compat | 2 | Parse manifest, check nimi version compatibility |
| signature/auth | 3 | Verify mod signature and signer authentication |
| dependency/build | 4 | Resolve dependencies and build mod bundle |
| sandbox/policy | 5 | Evaluate capability policy and sandbox constraints |
| load | 6 | Load mod entry point into runtime context |
| lifecycle | 7 | Execute lifecycle transitions (enable, disable, uninstall) |
| audit | 8 | Write audit decision record and emit events |

### 12.21 Desktop — Feature Flags

| Flag | Desktop 默认 | Web 默认 | 描述 |
|---|---|---|---|
| enableRuntimeTab | true | false | Show AI Runtime tab in sidebar navigation |
| enableModUi | true | false | Enable mod UI extension rendering |
| enableModWorkspaceTabs | true | false | Enable mod workspace tab management |
| enableSettingsExtensions | true | false | Enable settings panel extension sections |
| enableTitlebarDrag | true | false | Enable native window titlebar drag |
| enableMenuBarShell | true | false | Enable menu bar runtime entry shell; true on macOS desktop and false on non-macOS desktop or web |
| enableRuntimeBootstrap | true | false | Execute full runtime bootstrap sequence (hook runtime, mods, external agent) |

### 12.22 Desktop — 数据同步流

| 领域 | 方法 | 描述 |
|---|---|---|
| infrastructure | initApi, readDataSyncHotState, writeDataSyncHotState, callApi, startPolling, stopPolling, stopAllPolling, emitDataSyncError, loadInitialData | DataSync API initialization, hot state, polling, error emission, and initial-load infrastructure |
| auth | login, register, logout | Authentication flows (credential exchange, session teardown) |
| user | loadCurrentUser, updateUserProfile, loadUserProfile | User profile read/write |
| chat | loadChats, loadMoreChats, startChat, loadMessages, loadMoreMessages, sendMessage, syncChatEvents, flushChatOutbox, markChatRead | Chat list, message timeline, outbox, event sync |
| social | loadContacts, loadSocialSnapshot, searchUser, requestOrAcceptFriend, rejectOrRemoveFriend, removeFriend, blockUser, unblockUser, loadFriendRequests | Contacts, friend requests, social graph |
| world | loadWorlds, loadWorldDetailById, loadWorldAgents, loadWorldDetailWithAgents, loadWorldSemanticBundle, loadWorldEvents, loadWorldLorebooks, loadWorldResourceBindings, loadMainWorld, loadWorldLevelAudits | World listing, detail, semantic data |
| transit | startWorldTransit, listWorldTransits, getActiveWorldTransit, startTransitSession, addTransitCheckpoint, completeWorldTransit, abandonWorldTransit | World transit management |
| economy | loadCurrencyBalances, loadSparkTransactionHistory, loadGemTransactionHistory, loadSubscriptionStatus, loadSparkPackages, createSparkCheckout, loadWithdrawalEligibility, loadWithdrawalHistory, createWithdrawal, loadGiftCatalog, loadReceivedGifts, sendGift, acceptGift, rejectGift, createGiftReview | Currency, transactions, subscriptions, gifts |
| feed | loadPostFeed, createPost, createImageDirectUpload, createVideoDirectUpload, finalizeResource | Social feed posts and resource uploads; direct-upload sessions require finalizeResource after S3 upload before createPost; createPost references resourceId only |
| explore | loadExploreFeed, loadMoreExploreFeed, loadAgentDetails | Explore discovery feed and agent detail |
| notification | loadNotificationUnreadCount, loadNotifications, markNotificationsRead, markNotificationRead | Notification listing and read status |
| settings | loadMySettings, updateMySettings, loadMyNotificationSettings, updateMyNotificationSettings, loadMyCreatorEligibility | User settings and notification preferences |
| agent | loadMyAgents | Agent listing only; Agent LLM route/memory stays in host data capabilities for mods |

### 12.23 Desktop — 错误码

| Error Code | Domain | 描述 |
|---|---|---|
| LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT | local-ai | Import path not within Local Runtime models directory |
| LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID | local-ai | Only resolved asset.manifest.json files under ~/.nimi/models/**/resolved/** may be imported |
| LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID | local-ai | Only asset.manifest.json files may be imported |
| LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND | local-ai | Selected dependency asset orphan file does not exist |
| LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID | local-ai | Dependency asset orphan kind is invalid or unsupported |
| LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS | local-ai | Target artifact directory or payload file already exists |
| LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED | local-ai | Cannot create dependency asset directory |
| LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED | local-ai | Cannot move or copy dependency asset payload into runtime models root |
| LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED | local-ai | Source dependency asset payload cleanup failed after copy fallback |
| LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED | local-ai | Failed to serialize generated dependency asset manifest JSON |
| LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED | local-ai | Failed to write generated asset.manifest.json to disk |
| LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND | local-ai | Resolved model manifest file not found at import path |
| LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED | local-ai | Resolved model manifest JSON parsing failed |
| LOCAL_AI_IMPORT_HASH_MISMATCH | local-ai | Resolved model manifest checksum verification failed |
| LOCAL_AI_ENDPOINT_NOT_LOOPBACK | local-ai | Local runtime endpoint must be localhost/127.0.0.1/[::1] |
| LOCAL_AI_ENDPOINT_INVALID | local-ai | Local runtime endpoint format invalid |
| LOCAL_AI_MODEL_NOT_FOUND | local-ai | No installed/active model found |
| LOCAL_AI_MODEL_HASHES_EMPTY | local-ai | Model integrity check incomplete, cannot start |
| LOCAL_AI_MODEL_CAPABILITY_INVALID | local-ai | Model capability configuration invalid |
| LOCAL_AI_HF_DOWNLOAD_INTERRUPTED | local-ai | Download session interrupted by app exit/crash, manual resume required |
| LOCAL_AI_HF_DOWNLOAD_PAUSED | local-ai | Download session paused by user control |
| LOCAL_AI_HF_DOWNLOAD_CANCELLED | local-ai | Download session cancelled and staging cleaned |
| LOCAL_AI_HF_DOWNLOAD_DISK_FULL | local-ai | Download failed due to insufficient disk space |
| LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH | local-ai | Downloaded file hash mismatch, session cannot be resumed |
| LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE | local-ai | Session state is not resumable, must start a new install |
| LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS | local-ai | Active download session already exists for model |
| LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND | local-ai | Download session ID not found |
| LOCAL_AI_SPEECH_GPU_REQUIRED | local-ai | Speech engine requires available NVIDIA GPU |
| LOCAL_AI_SPEECH_PYTHON_REQUIRED | local-ai | Speech engine requires Python 3.10+ |
| LOCAL_AI_SPEECH_PYTHON_VERSION_UNSUPPORTED | local-ai | Speech engine Python version too low |
| LOCAL_AI_SPEECH_BOOTSTRAP_FAILED | local-ai | Speech engine runtime dependency installation failed |
| LOCAL_AI_FILE_IMPORT_NOT_FOUND | local-ai | Source file does not exist or is not a regular file |
| LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY | local-ai | At least one capability is required for file import |
| LOCAL_AI_FILE_IMPORT_READ_FAILED | local-ai | Cannot open or read source model file |
| LOCAL_AI_FILE_IMPORT_WRITE_FAILED | local-ai | Cannot create or write target file in models directory |
| LOCAL_AI_FILE_IMPORT_DIR_FAILED | local-ai | Cannot create model subdirectory in runtime models root |
| LOCAL_AI_FILE_IMPORT_FLUSH_FAILED | local-ai | Failed to flush written file to OS buffer |
| LOCAL_AI_FILE_IMPORT_SYNC_FAILED | local-ai | Failed to sync written file to disk |
| LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED | local-ai | Failed to serialize generated resolved model manifest JSON |
| LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED | local-ai | Failed to write generated resolved asset.manifest.json to disk |
| LOCAL_LIFECYCLE_WRITE_DENIED | runtime | Source has no permission for model lifecycle write operations |
| RUNTIME_ROUTE_CAPABILITY_MISMATCH | runtime | Route-bound local model lacks required capability |

### 12.24 Desktop — Retry Status Codes

| Status Code | 原因 |
|---|---|
| 408 | Request Timeout |
| 425 | Too Early |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |
| 504 | Gateway Timeout |

### 12.25 Desktop — Log Areas

| Area | 描述 |
|---|---|
| runtime | Default area for runtime subsystem logs |
| renderer-bootstrap | Bootstrap sequence phase logging |
| bridge | Tauri IPC invoke start/success/fail traces |
| datasync | DataSync facade action errors and API call traces |
| hook | Hook runtime capability checks and registration events |
| mod | Mod governance kernel stage execution and lifecycle events |
| local-ai | Local AI model lifecycle, inference audit, health probe |
| external-agent | External agent action bridge, token management |
| auth | Authentication session lifecycle events |
| net | Network retry events and error normalization |

### 12.26 Future — Backlog Items

| Item ID | Title | Priority | Category | Status |
|---|---|---|---|---|
| F-MCP-001 | MCP 协议支持 | high | integration | proposed |
| F-RENDER-001 | 富文本渲染（LaTeX、Mermaid、代码高亮） | high | ux | proposed |
| F-CODE-001 | 代码块增强（复制、语言检测、行号） | high | ux | proposed |
| F-SEARCH-001 | Web 搜索集成 | high | integration | proposed |
| F-MARKETPLACE-001 | Mod 市场平台 | high | platform | proposed |
| F-WEBINFER-001 | 浏览器端轻量推理 | high | platform | proposed |
| F-AVATAR-001 | 虚拟形象系统（VRM/Live2D） | high | ux | proposed |
| F-WFTRIGGER-001 | 工作流触发器系统 | high | platform | proposed |
| F-HEARTBEAT-001 | 心跳驱动的主动 Agent | high | platform | proposed |
| F-AIMETA-001 | AI 产物元数据标准 | high | platform | proposed |
| F-MULTIMODAL-001 | 多模态 AI 能力（TTS/STT/图像/视频生成） | high | platform | spec-drafted |
| F-RAG-001 | 知识库/RAG 系统 | medium | platform | spec-drafted |
| F-DOCPROC-001 | 文档处理 Pipeline | medium | platform | proposed |
| F-DEVPROBE-001 | 设备能力发现与报告 | medium | platform | proposed |
| F-TURNHOOK-001 | turn-hook 精细拦截点增强 | medium | platform | proposed |
| F-IMGGEN-001 | 专业图像生成 Mod | medium | integration | proposed |
| F-MODELUI-001 | 多 Provider 模型路由 UI | medium | platform | proposed |
| F-OAUTH-001 | OAuth/OIDC 登录 | medium | auth | proposed |
| F-WFVIS-001 | 工作流可视化 DAG 编辑器 | medium | platform | proposed |
| F-HITL-001 | 人工介入工作流节点 | medium | platform | proposed |
| F-MODERATION-001 | 内容审核模型类型 | medium | security | proposed |
| F-RERANK-001 | 多检索策略 + Rerank | medium | platform | proposed |
| F-ITER-001 | 工作流迭代/循环节点 | medium | platform | proposed |
| F-CITATION-001 | RAG 引用追踪 | medium | platform | proposed |
| F-MULTIROUTE-001 | 多数据集智能路由 | medium | platform | proposed |
| F-CODEEDIT-001 | 内嵌代码编辑器 | medium | ux | proposed |
| F-PROMPTVAR-001 | Prompt 变量模板系统 | medium | platform | proposed |
| F-CHANGEREQ-001 | 社区协作贡献机制（Change Request） | medium | platform | proposed |
| F-LEADERBOARD-001 | 创作者排行榜与游戏化 | medium | ux | proposed |
| F-PROMPTHUB-001 | 外部 Prompt 源集成 | medium | integration | proposed |
| F-MOBILE-001 | 移动端覆盖（iOS/Android） | medium | platform | proposed |
| F-SOCIALINT-001 | 游戏/社交平台集成 | medium | integration | proposed |
| F-MULTIAGENT-001 | 多 Agent 群聊编排 | medium | platform | proposed |
| F-PERSONA-001 | Markdown 人格/记忆编辑系统 | medium | ux | proposed |
| F-CTXCOMP-001 | 自动上下文压缩 | medium | platform | proposed |
| F-IMCHAN-001 | IM Channel Mod（钉钉/飞书/Discord） | medium | integration | proposed |
| F-EMBED-001 | 内容嵌入预览（Embed） | low | ux | proposed |
| F-WEBHOOK-001 | Webhook 事件通知 | low | integration | proposed |
| F-SANDBOX-001 | 代码执行沙箱 | low | platform | proposed |
| F-CRDT-001 | 协作编辑 | low | ux | proposed |
| F-SCIM-001 | SCIM 企业用户配置 | low | auth | proposed |
| F-EMBEDCACHE-001 | 嵌入向量缓存 | low | platform | proposed |
| F-METAFILTER-001 | LLM 驱动元数据过滤 | low | platform | proposed |
| F-LITESDK-001 | 超轻量 AI SDK | low | platform | proposed |
| F-IDEEXT-001 | IDE 开发者扩展 | low | integration | proposed |
| F-SDENGINE-001 | Stable Diffusion 引擎集成 | low | integration | proposed |
| F-MODELMART-001 | 模型/LoRA/工作流交易市场 | low | platform | proposed |
| F-VRAMGOV-001 | 模型级显存仲裁 | low | platform | proposed |
| F-OTEL-001 | OpenTelemetry 可观测性 | low | observability | proposed |
| F-MERKLE-001 | Merkle 防篡改审计链 | medium | security | proposed |
| F-OAICOMPAT-001 | OpenAI-Compatible API 兼容层 | medium | integration | proposed |
| F-ATA-001 | Agent-to-Agent 跨实例通信协议 | low | integration | proposed |
| F-MODELCAT-001 | 统一模型目录与路由增强 | medium | platform | proposed |
| F-AGUI-001 | Agent 声明式 UI Surface 协议 | medium | integration | proposed |
| F-AGUI-002 | Agent UI Path Binding 与 Generic Binder | medium | platform | proposed |
| F-AGUI-003 | Agent UI 安全组件目录与富文本硬化 | medium | security | proposed |

### 12.27 Future — Research Sources

| Source ID | 标题 | 路径 |
|---|---|---|
| RESEARCH-AUI-001 | A2UI 对比校准执行记录（现存替代来源） | dev/report/a2ui-future-spec-update-2026-03-14.md |

### 12.28 Future — Graduation Log

| Item ID | 毕业日期 | 目标 Spec |
|---|---|---|
| F-MULTIMODAL-001 | — | — |
| F-RAG-001 | — | — |
