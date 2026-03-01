# Nimi Platform 技术规范

> 本文档由 `scripts/generate-spec-human-doc.mjs` 自动生成，是 `spec/` 目录的人类可读版本。
> 生成时间: 2026-03-01
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
                 │     │nimillm │    │ LocalAI ││
                 │     │(remote)│    │ (local) ││
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
- `RuntimeLocalRuntimeService`
- `RuntimeAuthService`
- `RuntimeGrantService`

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeKnowledgeService`（`K-KNOW-*`）
- `RuntimeAppService`（`K-APP-*`）
- `ScriptWorkerService`（`K-SCRIPT-*`，内部服务）

其中每个服务的完整方法列表如下：

**K-RPC-002 — AIService 方法集合（design 权威）**

`AIService` 方法固定为：

1. `Generate`
2. `StreamGenerate`
3. `Embed`
4. `SubmitMediaJob`
5. `GetMediaJob`
6. `CancelMediaJob`
7. `SubscribeMediaJobEvents`
8. `GetMediaResult`
9. `GetSpeechVoices`
10. `SynthesizeSpeechStream`

**K-RPC-003 — ConnectorService 方法集合（design 权威）**

`ConnectorService` 方法固定为：

1. `CreateConnector`
2. `GetConnector`
3. `ListConnectors`
4. `UpdateConnector`
5. `DeleteConnector`
6. `TestConnector`
7. `ListConnectorModels`

> **Proto 状态**：ConnectorService 当前为 design-first 阶段，proto 定义尚未发布（`tables/rpc-migration-map.yaml` 状态 `design_only_pending_proto`）。Proto 发布时必须与本 spec（K-RPC-007 至 K-RPC-012）保持一致，migration map 随之更新为 `aligned`。

**K-RPC-004 — RuntimeLocalRuntimeService 方法集合**

`RuntimeLocalRuntimeService` 方法按三层分级：

**Tier 1 — 核心生命周期：**

1. `ListLocalModels`
2. `InstallLocalModel`
3. `RemoveLocalModel`
4. `StartLocalModel`
5. `StopLocalModel`
6. `CheckLocalModelHealth`

**Tier 2 — 目录与计划：**

7. `ListVerifiedModels`
8. `SearchCatalogModels`
9. `ResolveModelInstallPlan`
10. `InstallVerifiedModel`
11. `ImportLocalModel`
12. `CollectDeviceProfile`

**Tier 3 — 服务/节点/依赖/审计：**

13. `ListLocalServices`
14. `InstallLocalService`
15. `StartLocalService`
16. `StopLocalService`
17. `CheckLocalServiceHealth`
18. `RemoveLocalService`
19. `ListNodeCatalog`
20. `ResolveDependencies`
21. `ApplyDependencies`
22. `ListLocalAudits`
23. `AppendInferenceAudit`
24. `AppendRuntimeAudit`

---

## 2. 认证体系

Nimi Runtime 的认证分为四个层次：**Token 验证**（AuthN）、**访问控制**（AuthZ）、**会话管理**（AuthService）和**授权签发**（GrantService）。这四层严格分工，各有明确的输入输出边界。

### 2.1 Token 验证（AuthN）

当请求携带 `Authorization: Bearer <jwt>` 头时，Runtime 会验证 JWT 的合法性。这是所有安全决策的基础。

验证规则的核心设计是**严格拒绝 + 不降级**：携带了 Authorization 头但 JWT 无效时，Runtime 不会把请求降级为匿名访问，而是直接拒绝。只有完全没有 Authorization 头的请求才被视为匿名。

**K-AUTHN-001 — Bearer token 输入模型**

- `Authorization` 仅接受 `Bearer <jwt>` 形式。
- 无 `Authorization` 视为 anonymous，不报错。
- 头存在但格式非法，必须 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

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
- `kid` 缺失且无法定位有效公钥时必须拒绝。

JWKS（JSON Web Key Set）的缓存策略采用乐观缓存 + 按需刷新：正常情况使用缓存的公钥，只在遇到未知 `kid` 时才刷新一次。刷新失败不降级。

**K-AUTHN-004 — JWKS 缓存与刷新**

- JWKS 读取采用缓存优先，缓存 miss 或 `kid` miss 触发单次刷新。
- 刷新失败时不得降级为 anonymous，必须返回 `UNAUTHENTICATED`。
- 必须具备失败回退窗口：可在短 TTL 内继续使用最近一次成功快照（仅用于已命中 `kid`）。

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
- 无 JWT：仅允许 `LOCAL_MODEL` 与 inline 路径。
- 携带 `Authorization` 但 JWT 无效：必须 `UNAUTHENTICATED`，不降级匿名。

`JWT` 的有效性判定由 `K-AUTHN-002`（必校验 claims）、`K-AUTHN-003`（算法约束）、`K-AUTHN-004`（JWKS）与 `K-AUTHN-005`（时钟偏差）定义。

**K-AUTH-002 — 信息隐藏**

以下场景统一返回 `NOT_FOUND`：

- remote connector 不存在。
- remote connector owner 不匹配。
- 无 JWT 访问 remote connector 路径。

对于 Connector 相关操作，AuthZ 定义了固定的管理 RPC 门禁和 AI 推理资源校验顺序：

**K-AUTH-004 — 管理 RPC 身份门禁**

- `Create/Update/Delete`：必须有效 JWT。
- `Get/List/Test/ListConnectorModels`：JWT 可缺失；缺失时 remote 语义按信息隐藏处理。

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
- `max_delegation_depth` 超限必须拒绝。默认值为 `3`（可通过 `K-DAEMON-009` 配置覆盖）。

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

- `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_REALM_USER`
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

其中 CUSTOM 类型的模型需要提供 `local_invoke_profile_id`，缺失则标记为不可用：

**K-LOCAL-003 — CUSTOM 可用性门槛**

`local_invoke_profile_id` 是 `LocalModelRecord` 的可选 string 字段，由 `InstallLocalModel` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

### 3.4 连接器 CRUD 操作

**创建**：只能创建 REMOTE_MANAGED 连接器，必须提供 API Key。endpoint 为空时使用 provider 默认值。

**K-RPC-007 — CreateConnector 字段契约**

`CreateConnector` 必须满足：

- `kind` 必须为 `REMOTE_MANAGED`
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
- `api_key/endpoint` 变化时必须失效 remote model cache

**删除**：采用三步补偿流程（标记 pending → 删凭据 → 删记录），支持幂等重试。删除不影响已提交的 MediaJob。

**K-RPC-009 — DeleteConnector 补偿契约**

`DeleteConnector` 必须满足：

- 级联删除 credential
- 清理 remote model cache
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

AI consume 只允许二选一路径：

- `connector_id` 路径（managed/local）— **推荐路径**，凭据由 Runtime ConnectorService 托管（CONN-001: custodian not distributor）
- inline 路径（`x-nimi-key-source=inline` + inline metadata）— **escape hatch**，凭据通过 gRPC metadata 直传

**Inline 路径定位声明（K-KEYSRC-001a）**：inline 路径是为以下场景设计的 escape hatch，非推荐的常规使用路径：
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

**K-LOCAL-007 — 模型三层抽象**

本地模型系统采用三层抽象：

- **Model**（`LocalModelRecord`）：权重资产与元数据（model_id/capabilities/engine/source/hashes）。Model 是安装与注册的基本单元。
- **Service**（`LocalServiceDescriptor`）：受管进程实例。一个 Service 绑定一个 Model，持有 endpoint/status，代表一个可访问的推理服务。
- **Node**（`LocalNodeDescriptor`）：能力计算视图。从 Service × capabilities 笛卡尔积生成，携带 adapter/provider/policy_gate 等路由信息。Node 是运行时能力发现的入口。

Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service）：

**K-LOCAL-008 — Phase 1 绑定约束**

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。

#### 4.4.1 本地引擎

Phase 1 支持两种 OpenAI-compatible 引擎：

**K-LENG-001 — 引擎类型枚举**

Phase 1 支持两种本地推理引擎：

- `localai`：LocalAI 引擎，OpenAI-compatible HTTP 服务。
- `nexa`：Nexa 引擎，OpenAI-compatible HTTP 服务。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

**K-LENG-002 — 运行模式**

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`：连接外部已运行的引擎进程，runtime 不管理其生命周期。
- `SUPERVISED`：runtime 负责 spawn、监控与回收引擎进程。

Phase 1 仅实现 `ATTACHED_ENDPOINT`；`SUPERVISED` 标记为 deferred。

所有引擎通过标准 OpenAI-compatible HTTP API 通信：

**K-LENG-006 — OpenAI-compatible HTTP 协议基线**

所有 Phase 1 引擎均遵循 OpenAI-compatible HTTP API：

- 文本生成：`POST /v1/chat/completions`（`stream=false`）
- 流式生成：`POST /v1/chat/completions`（`stream=true`）
- 嵌入：`POST /v1/embeddings`
- 模型列表：`GET /v1/models`
- 图像生成：`POST /v1/images/generations`
- 语音合成：`POST /v1/audio/speech`
- 语音识别：`POST /v1/audio/transcriptions`

引擎特有的非标 API（如 LocalAI 的 video backend）通过 `LocalProviderHints` 描述，不作为通用协议基线。

健康探测使用 `GET /v1/models` 判定引擎可达性：

**K-LENG-007 — 健康探测协议**

> 本协议适用于本地引擎健康探测。云端 provider 探测使用 K-PROV-003（探测路径与健康判定标准不同）。

健康探测使用 `GET /v1/models`：

- HTTP 200 且响应包含有效模型列表 → 健康。
- HTTP 非 200 或连接失败 → 不健康。
- 探测超时：默认 5 秒，不可配置（Phase 1）。

探测频率由调用方决定（daemon 默认 8 秒周期），本规则仅定义协议。

引擎配置优先级（高覆盖低）：RPC 请求参数 > 环境变量 > 配置文件 > 引擎默认值：

**K-LENG-008 — 引擎配置来源优先级**

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数（`InstallLocalModel.endpoint` 等）
2. 环境变量（`NIMI_RUNTIME_LOCAL_AI_BASE_URL`、`NIMI_RUNTIME_LOCAL_NEXA_BASE_URL` 等，命名与 `K-PROV-002` 一致）
3. 配置文件（`K-DAEMON-009` 定义的配置路径，即 `~/.nimi/config.json` 的 provider 相关段）
4. 引擎默认值（`K-LENG-005`）

RPC 请求参数仅影响当次操作，不持久化覆盖配置文件值。

#### 4.4.2 设备画像

安装本地模型前，系统可以采集设备画像来评估硬件兼容性：

**K-DEV-001 — 设备画像结构**

设备画像（`LocalDeviceProfile`）包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `os` | string | 操作系统标识（`linux`/`darwin`/`windows`） |
| `arch` | string | CPU 架构（`amd64`/`arm64`） |
| `gpu` | `LocalGpuProfile` | GPU 信息（available/vendor/model） |
| `python` | `LocalPythonProfile` | Python 运行时（available/version） |
| `npu` | `LocalNpuProfile` | NPU 信息（available/ready/vendor/runtime/detail） |
| `disk_free_bytes` | int64 | 可用磁盘空间（字节） |
| `ports` | `[]LocalPortAvailability` | 端口可用性列表 |

`CollectDeviceProfile` RPC 返回当前设备的完整画像快照。

**K-DEV-002 — GPU 检测策略**

GPU 检测按以下优先级执行（首个成功即返回）：

1. 环境变量覆盖：`NIMI_GPU_AVAILABLE=true/false` → 直接采信。
2. 设备文件检测：`/dev/nvidia0` 存在 → `available=true, vendor=nvidia`。
3. 命令行探测：`nvidia-smi --query-gpu=name --format=csv,noheader` 成功 → `available=true, vendor=nvidia, model=<output>`。
4. 以上均未命中 → `available=false`。

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
   - `engine_runtime_mode=ATTACHED_ENDPOINT` 且 endpoint 可确定 → `true`。
   - `engine_runtime_mode=SUPERVISED` 且引擎二进制可达 → `true`。
   - 否则 → `false`，`reason_code` 说明原因。
4. 填充 `LocalProviderHints`（引擎特定适配信息）。
5. 返回 `LocalInstallPlanDescriptor`（含 warnings 和 reason_code）。

#### 4.4.4 依赖解析

Mod 可以声明对本地模型的依赖，分为四类：

**K-LOCAL-013 — 依赖解析模型**

`LocalDependenciesDeclarationDescriptor` 定义四类依赖：

| 类型 | 语义 | 缺失行为 |
|---|---|---|
| `required` | 必须满足 | 解析失败，reason_code 报错 |
| `optional` | 可选增强 | 跳过，生成 warning |
| `alternatives` | 互选组（多选一） | 按 `preferred_dependency_id` 优先选择；全部不可用则失败 |
| `preferred` | 全局偏好映射（`capability → dependency_id`） | 仅影响 alternatives 中的选择优先级 |

解析过程：

1. 遍历 `required` → 全部必须可满足。
2. 遍历 `optional` → 尽力满足。
3. 遍历 `alternatives` → 按 preferred > 声明顺序选择。
4. 输出 `LocalDependencyResolutionPlan`，含 `selection_rationale` 与 `preflight_decisions`。

依赖解析后通过四阶段 Apply 管道部署：

**K-LOCAL-014 — Apply 管道四阶段**

`ApplyDependencies` 执行解析计划，分四阶段：

| 阶段 | 名称 | 动作 |
|---|---|---|
| 1 | `preflight` | 设备画像重新采集，校验硬件兼容性与端口可用性 |
| 2 | `install` | 执行 `InstallLocalModel` / `InstallLocalService`，持久化状态 |
| 3 | `bootstrap` | 执行 `StartLocalService`（ATTACHED_ENDPOINT 模式为连接验证） |
| 4 | `health` | 执行健康探测（`K-LENG-007`），确认服务可用 |

每个阶段产出 `LocalDependencyApplyStageResult{stage, ok, reason_code, detail}`。

**K-LOCAL-015 — Apply 失败回滚**

Apply 管道任一阶段失败时：

- 逆序清理已完成阶段的副作用（已安装的 model/service 执行 remove）。
- 结果 `rollback_applied=true`。
- 回滚本身失败时，结果同时携带原始失败和回滚失败的 reason_code，不做二次回滚。
- 回滚不触发删除外部资产（如已下载的模型文件），仅清理 runtime 内部注册状态。

> **Phase 1 注释**：ATTACHED_ENDPOINT 模式下，stage 3（bootstrap）仅验证 endpoint 连接可达，stage 4（health）仅验证 `/v1/models` 可响应。回滚的实际影响范围为 stage 2 的注册清理（`InstallLocalModel`/`InstallLocalService` 产生的状态记录）。

#### 4.4.5 适配器路由与策略门控

本地 Node 的 adapter 按 provider × capability 矩阵路由：

**K-LOCAL-017 — 适配器路由规则**

Node 的 `adapter` 字段按以下规则确定（以 `tables/local-adapter-routing.yaml` 为事实源）：

| Provider | Capability | Adapter |
|---|---|---|
| `nexa` | `*`（任意） | `nexa_native_adapter` |
| `localai` | `image` | `localai_native_adapter` |
| `localai` | `video` | `localai_native_adapter` |
| `localai` | `tts` | `localai_native_adapter` |
| `localai` | `stt` | `localai_native_adapter` |
| `*`（任意） | `*`（任意） | `openai_compat_adapter` |

匹配顺序：精确匹配优先于通配符。

策略门控可条件性禁止特定组合（如 nexa 不支持 video）：

**K-LOCAL-018 — 策略门控（Policy Gate）**

策略门控用于条件性禁止特定 provider × capability 组合：

- `LocalNodeDescriptor.policy_gate` 字段描述门控规则标识（如 `nexa.video.unsupported`）。
- 门控触发时：Node 的 `available=false`，`reason_code` 说明原因。
- Nexa NPU 门控判定规则：
  - `host_npu_ready=false` → `npu_usable=false`
  - `model_probe_has_npu_candidate=false` → `npu_usable=false`
  - `policy_gate_allows_npu=false` → `npu_usable=false`
  - 三者均为 `true` → `npu_usable=true`
- 门控信息通过 `LocalProviderHints` 透传给审计与调用方。
- 类型映射：`LocalProviderHintsNexa.policy_gate` 为 string（门控规则标识符）；`AppendInferenceAuditRequest.policy_gate` 为 `google.protobuf.Struct`（结构化门控上下文，含 gate/reason/detail）。两者表达不同粒度，不要求类型对齐。

#### 4.4.6 流式降级

当本地 provider 不支持流式生成时，系统可以降级为非流式生成并分片模拟推送，但必须在审计和终帧 metadata 中标记 `stream_simulated=true`：

**K-LENG-011 — 流式降级检测**

当 `stream=true` 请求返回以下信号时，视为引擎不支持流式：

- HTTP 404/405/501
- 响应 Content-Type 非 `text/event-stream`
- 响应体特征匹配：包含 `"error"` 且状态码指示不支持

降级处理：

- 回退为非流式请求（`stream=false`）。
- 将完整响应按 24 字符分片（最后一片可短于 24 字符），模拟流式推送。24 字符 ≈ 6-8 个 CJK 字符或 4-5 个英文单词，是视觉上产生"逐步输出"感的最小粒度。此值为字符级（Unicode codepoint），与 K-STREAM-006 的 32 字节最小 chunk 是不同维度：K-STREAM-006 约束的是真实流式传输的 wire-level 最小帧大小（bytes），K-LENG-011 约束的是模拟流式时的文本分片大小（characters）。两者独立作用，不冲突。
- 终帧 metadata 必须标识 `stream_simulated=true`。
- 审计必须标记 `stream_fallback_simulated`。
- 分片模拟的事件语义仍需满足 `K-STREAM-002`（阶段边界）与 `K-STREAM-003`（文本流）。

#### 4.4.7 model_id 前缀路由

AI 执行路径根据 model_id 前缀确定引擎：

**K-LOCAL-020 — model_id 前缀路由**

当 AI 执行路径接收到 local model 请求时，按 `model_id` 前缀确定引擎：

| 前缀 | 引擎选择 |
|---|---|
| `localai/` | 仅匹配 `localai` 引擎的已安装模型 |
| `nexa/` | 仅匹配 `nexa` 引擎的已安装模型 |
| `local/` | 优先匹配 `localai`，未命中则回退 `nexa` |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`localai/llama3.1` 匹配 `model_id=llama3.1` 且 `engine=localai`）。

未知前缀（如 `ollama/`）视为无前缀，按 `model_id` 全文精确匹配（不剥除前缀）。

#### 4.4.8 Node 目录生成

Node 是 Service × capability 笛卡尔积的计算视图，每次查询实时生成：

**K-LOCAL-019 — Node 目录生成规则**

`ListNodeCatalog` 从已安装且活跃的 Service 实时生成 Node 列表：

1. 遍历所有 `status=ACTIVE` 的 Service。
2. 对每个 Service 的 `capabilities` 做笛卡尔积：每个 capability 生成一个 Node。
3. 每个 Node 填充：
   - `node_id`：`<service_id>:<capability>` 格式。
   - `provider`：从 engine 推导（`localai` → `localai`，`nexa` → `nexa`）。
   - `adapter`：按 `K-LOCAL-017` 路由。
   - `available`：健康且未被策略门控（`K-LOCAL-018`）。
   - `provider_hints`：引擎特定适配信息。
4. 支持按 `capability`/`service_id`/`provider` 过滤。

#### 4.4.9 搜索结果排序

目录搜索结果的排序规则：

**K-LOCAL-021 — SearchCatalogModels 结果排序**

`SearchCatalogModels` 结果固定排序：

1. `verified=true` 在前，`verified=false` 在后。
2. 同组内按 `title ASC`（大小写不敏感）。

### 4.5 Provider 白名单

每个 provider 有固定的默认 endpoint、是否支持 managed/inline 两种路径、对应的执行模块。这些信息由以下两个 YAML 表定义：

| Provider | 默认 Endpoint | 需显式 Endpoint |
|---|---|---|
| gemini | https://generativelanguage.googleapis.com/v1beta/openai | 否 |
| openai | https://api.openai.com/v1 | 否 |
| anthropic | https://api.anthropic.com | 否 |
| dashscope | https://dashscope.aliyuncs.com/compatible-mode/v1 | 否 |
| volcengine | https://ark.cn-beijing.volces.com/api/v3 | 否 |
| openai_compatible | — | 是 |

| Provider | 执行模块 | Managed | Inline | Endpoint 要求 |
|---|---|---|---|---|
| local | local-model | 是 | 否 | empty_string_only |
| gemini | nimillm | 是 | 是 | default_or_explicit |
| openai | nimillm | 是 | 是 | default_or_explicit |
| anthropic | nimillm | 是 | 是 | default_or_explicit |
| dashscope | nimillm | 是 | 是 | default_or_explicit |
| volcengine | nimillm | 是 | 是 | default_or_explicit |
| openai_compatible | nimillm | 是 | 是 | explicit_required |

---

## 5. 流式处理

Runtime 有三种流式 RPC：文本流生成（StreamGenerate）、语音流合成（SynthesizeSpeechStream）和媒体任务状态订阅（SubscribeMediaJobEvents）。

### 5.1 建流边界

流的建立有一个关键的分界点：AI 推理管道的全部 10 步评估通过后，流才算建立。

- **建流前**出错：走普通 gRPC error，和 unary RPC 一样
- **建流后**出错：优先通过终帧事件通知（`done=true + reason_code`），而非中断流

这意味着客户端可以简单地判断：如果收到了第一个流事件，说明认证、授权、凭据校验都已通过，后续错误只可能来自上游 provider。

**K-STREAM-002 — 阶段边界**

`StreamGenerate`/`SynthesizeSpeechStream` 的建流边界固定为：

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

媒体任务的状态事件流不使用 `done=true` 语义。当任务到达终态后，服务端正常关闭流（gRPC OK）。

**K-STREAM-005 — 状态事件流约束**

`SubscribeMediaJobEvents` 不使用 `done=true` 语义；终态事件后 server 正常关闭流（gRPC OK）。

---

## 6. 媒体任务系统

图像生成、视频生成、TTS/STT 等媒体类 AI 任务采用异步模式：通过 `SubmitMediaJob` 提交任务，然后通过轮询或事件流获取结果。

### 6.1 核心设计：凭据快照

MediaJob 的一个关键设计是**凭据快照**。任务提交时，系统会快照当前的 provider type、endpoint 和凭据。之后所有对这个 job 的操作（查询状态、获取结果、取消）都使用快照凭据，**不依赖连接器的当前状态**。

这意味着：
- 用户在任务执行期间删除连接器，不影响任务的可观测性和可控性
- 任务到达终态后，快照凭据会被清理（内存清零 + 持久化删除）

**K-JOB-003 — 凭据快照**

`SubmitMediaJob` 必须快照：

- `provider_type`
- `endpoint`
- `credential`

这三个字段对应 `K-KEYSRC-004` step 6 执行上下文三元组（`provider_type`/`endpoint`/`credential`）。快照在 job 创建时从执行上下文复制，后续轮询/取消/结果获取使用 job 快照，不依赖 connector 当前状态。

**K-JOB-004 — 凭据快照清理**

job 到达终态后必须清理快照凭据（best-effort 内存清零 + 持久化删除）。

**K-JOB-005 — connector 删除兼容**

`DeleteConnector` 不得影响已提交 job 的可观测性与可控性；job 查询/取消/取结果能力以 job 元数据为准。

### 6.2 任务状态机

MediaJob 有以下状态，其中四个是终态：

| 状态 | 终态 |
|---|---|
| QUEUED | 否 |
| RUNNING | 否 |
| COMPLETED | 是 |
| FAILED | 是 |
| CANCELLED | 是 |
| EXPIRED | 是 |

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

- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/mod`

各子路径的方法投影遵循结构化治理。Runtime SDK 的对外方法按 service 分组，与 `spec/runtime/kernel/tables/rpc-methods.yaml` 的设计名对齐——投影表 `tables/runtime-method-groups.yaml` 是唯一事实源：

**S-SURFACE-002 — Runtime SDK 对外方法投影**

Runtime SDK 对外方法投影按服务分组，方法集合必须与 `spec/runtime/kernel/tables/rpc-methods.yaml` 对应服务对齐，采用 design 名称。服务完整列表与方法集合以 `tables/runtime-method-groups.yaml` 为唯一事实源（S-SURFACE-009），每个 group 独立追踪对齐状态与 phase。

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
import { Runtime } from '@nimiplatform/sdk/runtime';

// 必须显式声明 transport — 不允许隐式默认
const runtime = new Runtime({
  transport: 'tauri-ipc',   // 或 'node-grpc'
  // endpoint: 仅 node-grpc 需要
});
```

**S-TRANSPORT-001 — Runtime Transport 显式声明**

Runtime SDK transport 必须显式声明：

- `node-grpc`
- `tauri-ipc`

禁止隐式默认 transport。

在请求结构上，SDK 严格分离 metadata 与 body：`connectorId` 在请求体中，而 provider endpoint、api_key 走传输 metadata。这种分离确保业务参数和基础设施凭据不混在同一层。

**S-TRANSPORT-002 — Metadata 投影边界**

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/api_key 在 transport metadata

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

**Runtime 侧协议**：Runtime 通过 gRPC response header metadata `x-nimi-runtime-version` 暴露 semver 版本（`K-DAEMON-011`）。SDK 从首次成功 RPC 的 response metadata 中提取并缓存版本。Desktop 通过 `runtime_bridge_status` 的 `daemonVersion` 字段获取版本（`D-IPC-002`/`D-IPC-009`），两条路径语义等价。若 metadata 缺失（旧版 Runtime），SDK 按 best-effort 处理：假设兼容，首次方法不可用错误时报告版本问题。

**blocked vs deferred 语义区分**：

- `blocked`：Phase 1 服务但 proto 依赖未就绪，SDK 返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`。blocked 服务的方法一旦 proto 发布即可实现，不需要版本协商。当前无 blocked 服务（ConnectorService proto 已就绪，`SDKR-050`）。
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

### 9.5 各子路径领域概述

**Runtime SDK** 是最重的子路径。入口 `new Runtime(options)` 必须声明 transport（如 9.2 所述），构造后提供与 Runtime 守护进程完整的方法投影：连接器 CRUD、AI 推理触发、认证管理、Grant 操作等。方法按 service 分组（如 S-SURFACE-002 / S-SURFACE-009 所定义），每个方法调用携带显式的 metadata/body 分离。重试策略按上述三层模型执行。

**AI Provider** 是 Runtime SDK 上层的协议适配。它实现 AI SDK v3 的 `LanguageModelV1` / `EmbeddingModelV1` 接口，将标准化调用（`generateText`、`embed`、`generateMedia`）翻译为对应的 Runtime gRPC 方法。AI Provider **只做协议转换**——路由决策由 Desktop 的 LLM 适配器或调用方完成。

**Realm SDK** 通过 HTTP/WebSocket 与远程 Realm 服务器通信。每个 `new Realm(options)` 实例独立配置 endpoint、token、headers（如 S-TRANSPORT-004 所定义）。Realm SDK 的认证模型允许 `NO_AUTH` 模式用于公开数据读取。本地配置错误使用 `SDK_REALM_*` 族错误码。

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

**D-BOOT-001 — — Runtime Defaults 加载**

启动序列的首个异步操作。通过 IPC 桥接调用 `runtime_defaults` 获取 `RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken）和 `RuntimeExecutionDefaults`（provider、model、agent 绑定）。

- **daemon 就绪前置条件**：Tauri backend 在返回 `runtime_defaults` 前确保 daemon 可达。若 daemon 处于 `STARTING` 状态（K-DAEMON-001），backend 等待 daemon 就绪（最长等待 30s，与 D-IPC-002 启动超时一致）。超时后返回错误，进入 `D-BOOT-008` 错误路径。
- 失败行为：抛出异常，进入 `D-BOOT-008` 错误路径。
- 后续依赖：DataSync 初始化、Platform Client 初始化。

**D-BOOT-002 — — Platform Client 初始化**

使用 `D-BOOT-001` 获取的 realmBaseUrl 和 accessToken 初始化 `initializePlatformClient`。

- 必须在 DataSync 初始化之前完成。

**D-BOOT-003 — — DataSync Facade 初始化**

调用 `dataSync.initApi()` 注入 realm 配置和 proxy fetch 实例。

- `fetchImpl` 使用 `createProxyFetch()` 以绕过浏览器 CORS（参考 `D-IPC-004`）。
- 热状态通过 `globalThis.__NIMI_DATA_SYNC_API_CONFIG__` 跨 HMR 持久化。

阶段 ④ 在启动期间执行 token 交换或匿名回退——这是认证状态的初始决策点。阶段 ⑤ 组装 HTTP context provider、runtime host 能力、mod SDK host 和核心数据能力。阶段 ⑥ 从本地 manifest 注册 mod，**部分 mod 注册失败不阻塞整体启动**，采用降级模式继续。阶段 ⑦ 注册 tier-1 external agent actions 并启动 action bridge。

**D-BOOT-004 — — Runtime Host 装配**

受 `enableRuntimeBootstrap` feature flag 门控（参考 `tables/feature-flags.yaml`）。

- 设置 HTTP context provider（runtime defaults + store token + proxy fetch）。
- 通过 SDK Runtime client 调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。成功后 Runtime 记录 app 注册信息，后续请求可通过 AppMode gate（K-AUTHSVC-009）。失败（如 `APP_MODE_MANIFEST_INVALID`）时中断 bootstrap，进入 D-BOOT-008 错误路径。
- 构建 runtime host capabilities（local LLM health check、execution kernel turn、OpenAPI context lock、hook runtime）。
- 装配 mod SDK host。
- 配置 speech route resolver 和 missing data capability resolver。
- 确保 core world data capabilities 已注册。

**D-BOOT-005 — — Runtime Mods 注册**

调用 `registerBootstrapRuntimeMods` 从本地清单注册 mods。

- 返回 `runtimeModFailures` 和 `manifestCount`。
- 部分 mod 注册失败不中断启动序列（degraded mode）。

**D-BOOT-006 — — External Agent 桥接**

注册 tier-1 external agent actions 并启动 action bridge。

- 调用 `registerExternalAgentTier1Actions(hookRuntime)`。
- 调用 `startExternalAgentActionBridge()` 和 `resyncExternalAgentActionDescriptors()`。

**D-BOOT-007 — — Auth Session 引导**

调用 `bootstrapAuthSession` 执行 token 交换或匿名回退。

- 成功时设置 `auth.status = 'authenticated'`。
- 失败时设置 `auth.status = 'anonymous'`。

阶段 ⑧ 设置 `bootstrapReady` / `bootstrapError` 标志，失败时清除 auth 状态。整个启动链有一个关键的幂等性守卫：`bootstrapPromise` 单例确保 bootstrap 全局只执行一次——即使在 HMR（热模块替换）场景下重复触发也安全。

**D-BOOT-008 — — Bootstrap 完成 / 错误处理**

正常路径：
- `bootstrapReady = true`、`bootstrapError = null`。
- 日志级别：有 mod 失败时 `warn`，否则 `info`。

错误路径：
- `bootstrapReady = false`、`bootstrapError = message`。
- 清除 auth session。
- 日志级别：`error`。

**D-BOOT-009 — — 幂等性守卫**

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

### 10.2 IPC 桥接：为什么不直接 HTTP？

Desktop 为什么不让 Renderer 直接发 HTTP 请求？三个原因：浏览器沙箱有 CORS 限制、无法访问本地文件系统、无法绑定 TCP 端口。Tauri IPC 把这些限制绕过——所有跨进程通信走 `window.__TAURI__.invoke()`，由 Rust 后端代理执行。

IPC 层的基础设施先于具体命令。统一的 `invoke()` 入口先检查 `hasTauriInvoke`（即 `window.__TAURI__` 是否存在），然后为每次调用生成 `invokeId`、写入结构化日志、统一错误归一化。这意味着所有 IPC 命令自动获得可观测性，无需各命令自行实现。

**D-IPC-009 — — Invoke 基础设施**

所有 IPC 调用通过 `invoke()` / `invokeChecked()` 统一入口：

- 前置检查 `hasTauriInvoke()`（`window.__TAURI__` 存在性）。
- 生成 `invokeId`（`${command}-${timestamp}-${random}`）。
- 结构化日志：invoke-start、invoke-success、invoke-failed。
- 错误归一化：`toBridgeUserError()` 将 Tauri 错误转为用户可读消息。

**版本协商**（引用 SDK `S-TRANSPORT-005`）：

Desktop 编译发布与 Runtime daemon 独立更新，版本偏差是真实场景。版本兼容行为：

- **major 不兼容**：Desktop 启动时检测到 Runtime major 版本断裂，必须 fail-close 并向用户展示升级提示，不允许静默降级为"部分可用"。
- **minor/patch 差异**：允许通过方法可用性检查做受控降级。不可用的 Phase 2 方法在 UI 中标记为"需要更新运行时"。
- **版本信息获取**：通过 `runtime_bridge_status` 返回的 `daemonVersion` 字段（D-IPC-002 `RuntimeBridgeDaemonStatus`）获取。解析为 semver，与 Desktop 编译时嵌入的兼容版本范围比对。
- **降级行为**：功能不可用的场景在 UI 中展示明确提示，不隐藏功能入口。
- **与 SDK S-TRANSPORT-005 的关系**：S-TRANSPORT-005 定义的"metadata 交换"版本协商是通用 SDK 契约。Desktop 通过 `daemonVersion` IPC 字段实现等效功能（Tauri IPC 传输无需 gRPC metadata），满足 S-TRANSPORT-005 的语义要求。

高容量模块（如 local-ai 和 external-agent）采用动态 `import()` 懒加载，避免主 bundle 体积膨胀：

**D-IPC-010 — — 懒加载桥接模块**

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- `loadLocalAiBridge()` — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

在此基础设施之上，IPC 命令按功能域分组：

**Runtime Defaults 命令** — `runtime_defaults` 返回 realm 和运行时执行默认值，采用防御性解析：

**D-IPC-001 — — Runtime Defaults 命令**

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken）
- `runtime: RuntimeExecutionDefaults`（provider、model、agent 绑定参数）

所有字段通过 `parseRuntimeDefaults` 防御性解析。

**Daemon 生命周期命令** — status、start、stop、restart，报告 `launchMode`：

**D-IPC-002 — — Daemon 生命周期命令**

Daemon 管理命令集：`runtime_bridge_status`、`runtime_bridge_start`、`runtime_bridge_stop`、`runtime_bridge_restart`。

返回 `RuntimeBridgeDaemonStatus`：
- `running: boolean`
- `managed: boolean`
- `launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID'`
- `grpcAddr: string`
- `daemonVersion: string`（daemon 版本号，用于 D-IPC-009 版本协商）

**Runtime 健康状态 UI 映射**（对应 Runtime K-DAEMON-001 五态）：

| Runtime 状态 | UI 指示器 | 可用操作 | 超时预期 |
|---|---|---|---|
| `STOPPED` | 灰色/离线标记 | start | — |
| `STARTING` | 加载动画/启动中 | — (等待) | 30s 启动超时 |
| `READY` | 绿色/就绪标记 | stop, restart | — |
| `DEGRADED` | 黄色/降级警告 | stop, restart | —（Phase 1 通过 `running=true` 统一覆盖 READY/DEGRADED，DEGRADED 独立检测需 daemon 暴露结构化健康状态，Phase 2 增强） |
| `STOPPING` | 加载动画/停止中 | — (等待) | 10s 停机超时（K-DAEMON-003） |

Desktop 通过 `runtime_bridge_status` 轮询获取 `running` 状态。`running=true` 对应 `READY` 或 `DEGRADED`，`running=false` 对应 `STOPPED`。`STARTING`/`STOPPING` 过渡态通过命令执行期间的 UI 加载状态表示。

**Provider 健康探测窗口**：Daemon 到达 READY 后启动 provider 健康探测（K-PROV-003），首次探测立即执行但结果需 0~8s 到达。在此窗口内，所有 provider 状态为 `unknown`。Desktop UI 行为：

- READY 后、首次探测结果到达前：provider 列表展示"检测中"状态（非"就绪"），不阻塞用户操作但不显示绿色健康标记。
- 首次探测结果到达后：按 healthy/unhealthy 更新 UI 指示器。
- Phase 1 简化：`running=true` 统一覆盖 READY/DEGRADED，provider 健康细粒度展示为 Phase 2。Phase 1 不展示 provider 级健康指示器，仅展示 daemon 级 running 状态。

**Config 读写命令** — `runtime_bridge_config_get` / `set` 管理配置持久化：

**D-IPC-003 — — Config 读写命令**

`runtime_bridge_config_get` / `runtime_bridge_config_set` 命令。

- `ConfigGetResult`：`{ path, config }`
- `ConfigSetResult`：`{ path, reasonCode?, actionHint?, config }`

**配置可见性规则**：

- **UI 暴露子集**：Phase 1 Desktop UI 仅暴露安全且用户可理解的配置项。完整字段清单由 K-DAEMON-009 定义，Desktop UI 暴露子集为实现定义。
- **热重载 vs 重启**：`config_set` 写入后，`actionHint` 字段指示后续行为：`hot_reload`（无需重启）、`restart_required`（需重启 daemon 生效）、`null`（立即生效）。Desktop 收到 `restart_required` 时应向用户展示重启提示。
- **环境变量覆盖不可见性**：环境变量优先级高于配置文件（K-DAEMON-009 三层优先级）。Desktop UI 展示配置文件中的值，不反映环境变量覆盖。此为已知限制，Phase 1 不解决。
- **向前兼容**：Runtime 新增配置字段在 Desktop 未更新时不可见。`config_get` 返回完整 JSON（含未识别字段），`config_set` 透传未识别字段（不丢弃）。

**HTTP 代理命令** — `http_request` 代理所有 HTTP 请求通过 Tauri 后端，绕过 CORS。**UI 命令** — `open_external_url`、`confirm_private_sync`、`start_window_drag`。**OAuth 命令** — `oauth_token_exchange` 和 `oauth_listen_for_code`，支持 PKCE 和 clientSecret 两种模式：

**D-IPC-004 — — HTTP 代理命令**

`http_request` 命令：renderer 通过 Tauri backend 代理所有 HTTP 请求，绕过浏览器 CORS 限制。

- 每次调用生成唯一 `invokeId` 用于追踪。
- 日志记录 `requestUrl`、`requestMethod`、`requestBodyBytes`。

**D-IPC-005 — — UI 命令**

- `open_external_url`：在系统浏览器打开外部 URL。
- `confirm_private_sync`：确认私有数据同步。
- `start_window_drag`：原生窗口拖拽。

**D-IPC-006 — — OAuth 命令**

- `oauth_token_exchange`：交换 OAuth authorization code。
- `oauth_listen_for_code`：监听 redirect URI 回调。

支持 PKCE（codeVerifier）和 clientSecret 两种模式。

**Mod 本地命令** — 读取本地 manifest 和 entry 文件。**External Agent 命令** — agent token 管理和 action descriptor 同步。**Local AI 命令** — 懒加载的模型列表、安装、生命周期管理和审计：

**D-IPC-007 — — Mod 本地命令**

- `runtime_mod_list_local_manifests`：列出本地 mod 清单。
- `runtime_mod_read_local_entry`：读取 mod 入口源码。

**D-IPC-008 — — External Agent 命令**

- `external_agent_issue_token`：签发 agent token。
- `external_agent_revoke_token`：吊销 agent token。
- `external_agent_list_tokens`：列出 agent tokens。
- `external_agent_sync_action_descriptors`：同步 action descriptors。
- `external_agent_complete_execution`：完成 action 执行。
- `external_agent_gateway_status`：获取 gateway 状态。

**D-IPC-011 — — Local AI 命令**

Local AI 桥接通过 `loadLocalAiBridge()` 懒加载（`D-IPC-010`），命令集：

- `local_ai_list_models` / `local_ai_list_verified_models`：列出本地/验证模型。
- `local_ai_install_model` / `local_ai_install_verified_model` / `local_ai_import_model`：安装/导入模型。
- `local_ai_start_model` / `local_ai_stop_model` / `local_ai_remove_model`：模型生命周期管理。
- `local_ai_health_models`：模型健康检查。
- `local_ai_list_audits` / `local_ai_append_inference_audit`：推理审计。
- `local_ai_pick_manifest_path`：选取模型清单文件。
- `local_ai_subscribe_download_progress`：订阅下载进度。

### 10.3 状态管理：四个 Zustand Slice

Desktop 的应用状态采用 Zustand slice 架构。为什么不用 Redux 或 Context？因为各业务域（Auth、Runtime、Mod、UI）的状态生命周期完全不同——Auth 状态跨 session 持久化，Runtime 状态在 daemon 重启时重置，Mod 状态随 workspace 动态增减，UI 状态纯临时。Slice 架构让每个域独立声明自己的状态和操作，最终通过无 middleware 的组合注入全局 store。

**D-STATE-001 — — Auth Slice**

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

**D-STATE-002 — — Runtime Slice**

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（provider、model、agent、world 等绑定参数）
- `runtimeDefaults: RuntimeDefaults | null`
- `localManifestSummaries`、`registeredRuntimeModIds`、`runtimeModDisabledIds`
- `runtimeModUninstalledIds`、`runtimeModSettingsById`、`runtimeModFailures`
- `fusedRuntimeMods`（熔断记录）

初始 `RuntimeFieldMap`：
- `targetType: 'AGENT'`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: 'http://127.0.0.1:1234/v1'`

**D-STATE-003 — — Mod Workspace Slice**

`createModWorkspaceSlice` 管理 mod 工作区：

- `modWorkspaceTabs: ModWorkspaceTab[]`（`tabId: 'mod:${modId}'`、`title`、`fused`）
- 操作：`openModWorkspaceTab`、`closeModWorkspaceTab`

**D-STATE-004 — — UI Slice**

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`previousTab: AppTab | null`
- `selectedChatId`、`selectedProfileId`、`selectedWorldId`
- `statusBanner: StatusBanner | null`
- `bootstrapReady: boolean`、`bootstrapError: string | null`

导航操作：`setActiveTab`、`navigateToProfile`、`navigateToWorld`、`navigateBack`。

四个 slice 通过 `useAppStore` 合并为单一 Zustand store，不使用 middleware（immer、persist 等）——状态更新直接用 `set()` 替换，保持调试透明性：

**D-STATE-005 — — Store 组合**

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

**D-AUTH-001 — — Session Bootstrap**

`bootstrapAuthSession` 在启动序列中执行（`D-BOOT-007`）。

- 输入：`flowId`（追踪 ID）、`accessToken`（来自 runtime defaults）。
- 成功时：设置 `auth.status = 'authenticated'`、存储 token。
- 失败时：设置 `auth.status = 'anonymous'`、清除 token。

**D-AUTH-002 — — Token 持久化（Desktop）**

Desktop 环境通过 Tauri backend 持久化 token：

- 获取：`runtime_defaults` IPC 命令返回 `realm.accessToken`。
- 更新：DataSync facade 的 `setToken()` 同步到热状态和 Zustand store。
- 清除：`clearAuthSession()` 清空 store 并停止所有轮询。

**D-AUTH-003 — — Token 持久化（Web）**

Web 环境通过浏览器存储持久化 token：

- 获取：从 localStorage 读取（禁止使用 cookie 存储 token，参考 `D-SEC-010`）。
- 更新：写入 localStorage。
- 清除：删除 localStorage 条目。

状态机的转换规则是确定性的：`bootstrapping` 只能到 `authenticated` 或 `anonymous`，`authenticated` 可因 logout/过期回退到 `anonymous`，`anonymous` 可通过 login 转为 `authenticated`。

**D-AUTH-004 — — Auth 状态机**

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
| `authenticated` | Realm SDK session active，`auth.accessToken` 注入请求 header | Runtime K-AUTHN-001~008 通过 gRPC metadata 中的 token 验证请求合法性 |
| `anonymous` | Realm SDK 无 token，仅公开 API 可用 | Runtime 拒绝需认证的 RPC（`UNAUTHENTICATED`） |

**Desktop 与 RuntimeAuthService 的关系**：

Desktop **不直接使用** RuntimeAuthService（K-AUTHSVC-001~013）的 `OpenSession` / `RefreshSession` / `RevokeSession`。Desktop 认证 token 来自 Realm 后端（通过 Realm SDK REST 调用获取），而非 Runtime daemon 的 session 管理。RuntimeAuthService 的 session 管理面向以下场景：

- 外部 Agent 通过 SDK 建立 Runtime session（K-AUTHSVC-006、RegisterExternalPrincipal）
- 独立 SDK 消费者（非 Desktop）直接与 Runtime 交互

Runtime 对 Desktop 请求的认证路径：Desktop → Realm SDK 注入 `Authorization: Bearer <realm_access_token>` → Runtime gRPC metadata → K-AUTHN-001~008 token 验证拦截器。此 token 由 Realm 后端签发，Runtime 仅做 claims 校验，不管理其生命周期。

**AppMode 声明**（K-AUTHSVC-009）：Desktop 使用 `AppMode=FULL`、`WorldRelation=RENDER` 注册（K-AUTHSVC-010）。`FULL` 模式允许同时访问 `runtime.*` 和 `realm.*` 域。若注册时使用错误的 AppMode，Runtime 返回 `APP_MODE_DOMAIN_FORBIDDEN`（D-ERR-007 映射表兜底处理）。

**RegisterApp 调用路径**：Desktop 通过 SDK Runtime client 在 bootstrap 阶段（D-BOOT-004）调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。此调用属于 Runtime SDK 高阶方法透传，不等同于 Desktop 直接使用 RuntimeAuthService 的 session 管理方法（OpenSession/RefreshSession/RevokeSession）。

- **调用时机**：D-BOOT-004 Runtime Host Assembly 完成 gRPC 连接后、D-BOOT-007 Auth Session 引导前。
- **失败处理**：进入 D-BOOT-008 错误路径，`bootstrapReady=false`。
- **参数来源**：`appMode` 和 `worldRelation` 由 Desktop 编译时确定（非用户配置）。

认证状态变更驱动数据同步：DataSync 监听 `authChange` 事件，认证成功时同步 token 并启动 polling，认证失效时停止 polling 并清除缓存。这是启动序列（10.1）和数据同步（10.5）之间的关键连接点。

**D-AUTH-005 — — Auth 事件联动**

DataSync 监听 `authChange` 事件：

- `isAuthenticated = true`：调用 `setToken(auth.token)`。
- `isAuthenticated = false`：清空 token，停止所有轮询。

### 10.5 数据同步：十二条独立流

数据同步是 Desktop 最庞大的子系统——12 个业务流域，每个都有独立的触发条件、缓存策略和错误处理。为什么不用一个统一的"sync all"？因为各域的数据生命周期截然不同：Chat 需要 polling + outbox 实时推送，Notification 只需定时拉取，Economy 需要精确的余额一致性。

12 个流域共享 6 项基础设施：API init 初始化、hot state 同步、context lock 防并发、polling 调度、error log 记录、facade delegate 委托。这意味着每个流域只需声明"拉什么"和"怎么缓存"，基础设施自动处理重试和错误收集。

**D-DSYNC-001 — — Auth 数据流**

认证流方法：`login`、`register`、`logout`。

- 使用基础设施：上下文锁、错误日志。
- `login`/`register` 成功后通过 `setToken()` 更新热状态和 store。
- `logout` 触发 `clearAuth()` + `stopAllPolling()`。

**D-DSYNC-002 — — User 数据流**

用户资料读写方法：`loadCurrentUser`、`updateUserProfile`、`loadUserProfile`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- `loadCurrentUser` 在 `loadInitialData()` 中首先执行。

**D-DSYNC-003 — — Chat 数据流**

聊天数据流方法：`loadChats`、`loadMoreChats`、`startChat`、`loadMessages`、`loadMoreMessages`、`sendMessage`、`syncChatEvents`、`flushChatOutbox`、`markChatRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志、初始数据加载。
- `syncChatEvents` 通过 `PollingManager` 定期轮询。
- `flushChatOutbox` 处理离线消息队列。

Chat 流域是最复杂的：它结合了 polling（定时拉取会话列表和未读计数）和 outbox（消息先写入本地 outbox，异步 flush 到服务器）。消息发送失败时保留在 outbox 中等待重试，不丢弃。

**领域数据流**

**D-DSYNC-004 — — Social 数据流**

社交数据流方法：`loadContacts`、`loadSocialSnapshot`、`searchUser`、`requestOrAcceptFriend`、`rejectOrRemoveFriend`、`removeFriend`、`blockUser`、`unblockUser`、`loadFriendRequests`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- 辅助方法：`isFriend(userId)` 在 contacts 状态中检查好友关系。

**D-DSYNC-005 — — World 数据流**

世界数据流方法：`loadWorlds`、`loadWorldDetailById`、`loadWorldSemanticBundle`、`loadMainWorld`、`loadWorldLevelAudits`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-006 — — Economy 数据流**

经济数据流方法：

- 余额：`loadCurrencyBalances`
- 交易：`loadSparkTransactionHistory`、`loadGemTransactionHistory`
- 订阅：`loadSubscriptionStatus`
- 提现：`loadWithdrawalEligibility`、`loadWithdrawalHistory`、`createWithdrawal`
- 礼物：`loadGiftCatalog`、`sendGift`、`claimGift`、`rejectGift`、`createGiftReview`

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-007 — — Feed 数据流**

社交 feed 方法：`loadPostFeed`、`createPost`、`createImageDirectUpload`、`createVideoDirectUpload`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-008 — — Explore 数据流**

探索发现方法：`loadExploreFeed`、`loadMoreExploreFeed`、`loadAgentDetails`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-009 — — Notification 数据流**

通知方法：`loadNotificationUnreadCount`、`loadNotifications`、`markNotificationsRead`、`markNotificationRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志。
- `loadNotificationUnreadCount` 通过 `PollingManager` 定期轮询。

**D-DSYNC-010 — — Settings 数据流**

设置方法：`loadMySettings`、`updateMySettings`、`loadMyNotificationSettings`、`updateMyNotificationSettings`、`loadMyCreatorEligibility`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-011 — — Agent 数据流**

Agent 方法：`loadMyAgents`、`recallAgentMemoryForEntity`、`listAgentCoreMemories`、`listAgentE2EMemories`、`loadAgentMemoryStats`、`resolveChatRoute`。

- 使用基础设施：上下文锁、错误日志。

**D-DSYNC-012 — — Transit 数据流**

世界穿越方法：`loadSceneQuota`、`startWorldTransit`、`listWorldTransits`、`getActiveWorldTransit`、`startTransitSession`、`addTransitCheckpoint`、`completeWorldTransit`、`abandonWorldTransit`。

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

**D-HOOK-006 — — Capability Key 格式**

Capability key 采用点分层级格式：`<subsystem>.<action>.<target>`。

- 归一化：`normalizeCapabilityKey()` — trim 空白。
- 匹配：`capabilityMatches(pattern, key)` — 支持 `*` wildcard。
- 批量匹配：`anyCapabilityMatches(patterns, key)` — 任一模式匹配即通过。

**D-HOOK-007 — — Source-Type 权限网关**

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

在此基础上，5 个子系统各覆盖一个扩展面：

**Event 子系统** — pub/sub 事件总线，能力键 `event.publish.*` / `event.subscribe.*`。**Data 子系统** — 数据查询和注册，能力键 `data.query.*` / `data.register.*`，sideload 来源限制为 query-only。

**D-HOOK-001 — — Event 子系统**

Pub/sub 事件总线：

- `event.publish.<topic>`：发布事件到指定主题。
- `event.subscribe.<topic>`：订阅指定主题事件。
- 所有 source types 均支持 `event.publish.*`，但 `sideload` 不支持 subscribe。

**D-HOOK-002 — — Data 子系统**

共享数据能力注册与查询：

- `data.query.<name>`：查询已注册的数据能力。
- `data.register.<name>`：注册新的数据能力。
- `sideload` 仅支持 query，不支持 register。

**Turn 子系统** — 对话轮次 hook，4 个注入点（pre-policy → pre-model → post-state → pre-commit），source type 限制注入点访问。**UI 子系统** — 8 个预定义 slot 的组件注册，codegen 来源有前缀限制。**Inter-Mod 子系统** — 跨 Mod 的 RPC 通信（`inter-mod.request.*` / `inter-mod.provide.*`）。

**D-HOOK-003 — — Turn 子系统**

AI 对话生命周期拦截点：

- `turn.register.<point>`：注册到指定 hook point。
- 4 个 hook points（按执行顺序）：`pre-policy` → `pre-model` → `post-state` → `pre-commit`。
- `injected` source type 仅允许 `pre-model` 和 `post-state`。
- `sideload` 和 `codegen` 不允许 turn hook。

**与 Runtime 拦截器链的时序关系**：Turn hook 在 renderer 进程执行，时序先于 SDK 发送请求到 Runtime。Runtime K-DAEMON-005 拦截器链（lifecycle → protocol → authz → audit）在 daemon 收到请求后执行。两层无重叠：Desktop turn hook 负责请求编排（策略门控、模型选择、状态更新、提交确认），Runtime 拦截器负责请求验证（健康门控、幂等性、授权、审计）。

**D-HOOK-004 — — UI 子系统**

UI 扩展槽位注册：

- `ui.register.<slot>`：注册 UI 组件到指定槽位。
- 8 个预定义槽位（参考 `tables/ui-slots.yaml`）。
- `codegen` 仅允许 `ui-extension.app.*` 前缀的槽位。

**D-HOOK-005 — — Inter-Mod 子系统**

跨 mod RPC 通信：

- `inter-mod.request.<channel>`：发送请求到指定通道。
- `inter-mod.provide.<channel>`：在指定通道提供服务。
- `builtin` 支持 request + provide，其他 source types 仅支持 request。

Hook 系统还提供两个共享能力域：**LLM Capability** 覆盖文本/图像/视频/嵌入生成和语音操作，**Action Capability** 覆盖 discover/dry-run/verify/commit 操作：

**D-HOOK-008 — — LLM Capability 域**

所有非 codegen source types 共享完整 LLM 能力集：

- `llm.text.generate` / `llm.text.stream`
- `llm.image.generate` / `llm.video.generate` / `llm.embedding.generate`
- `llm.lifecycle.read`
- `llm.speech.*`（providers.list、voices.list、synthesize、stream.*、transcribe）

**D-HOOK-009 — — Action Capability 域**

所有非 codegen source types 共享 action 能力集：

- `action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`

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

4 种 access mode 决定了每个阶段的验证严格度：`official` 要求完整签名链，`community` 要求社区签名，`sideload` 跳过签名但限制能力，`local-dev` 最宽松但只允许本地开发。

**D-MOD-001 — — Discovery 阶段**

定位 mod 包并验证源引用：

- 输入：`DiscoverInput`（modId、version、mode、source）。
- 验证：source ref 存在性、mod ID 格式。
- 成功：状态 → `DISCOVERED`。

**D-MOD-002 — — Manifest/Compat 阶段**

解析清单并检查兼容性：

- 解析 `ModManifest`（id、version、capabilities、dependencies、entry）。
- 检查 `nimi.minVersion` / `nimi.maxVersion` 约束。
- 失败：输出决策记录，不进入下一阶段。

**D-MOD-003 — — Signature/Auth 阶段**

验证 mod 签名和签署者身份：

- `official` / `community` mode：要求 signerId、signature、digest。**（Phase 2 detail — Phase 1 仅支持 `local-dev` / `sideload`，签名验证基础设施待实现）**
- `local-dev` / `sideload` mode：跳过签名验证。
- 成功：状态 → `VERIFIED`。

**Phase 1 信任假设**：Phase 1 假设桌面端用户对本地文件系统有完全控制权。`local-dev` 和 `sideload` 的完全信任等价于用户自行安装本地软件的信任模型——用户对加载到 Desktop 的本地 mod 代码负责。此假设的安全影响：任何有权写入本地 mod 目录的进程可注入 mod，获得 `sideload` 级别的全部能力（`D-HOOK-007` 白名单：event.pub、data.query、ui、inter-mod.req、LLM、action、audit、meta），但仍受 Runtime token authz 正交约束（`D-MOD-011`）。**Phase 2 必须在引入社区分发渠道前完成签名验证基础设施。**

**D-MOD-004 — — Dependency/Build 阶段**

解析依赖并构建 mod bundle：

- 解析 `manifest.dependencies` 列表。
- 验证所有依赖已注册或可用。**（Phase 2 detail — Phase 1 mod 无跨 mod 依赖，此阶段执行空依赖校验后直接通过）**
- 成功：状态 → `INSTALLED`。

阶段 ⑤ 的沙箱策略评估是安全核心：它根据 Mod 声明的 capability 需求和 source type 的 allowlist 做交叉匹配，超出允许范围的能力请求直接 DENY。

**D-MOD-005 — — Sandbox/Policy 阶段**

评估 capability 策略和沙箱约束：

- 解析 `requestedCapabilities`。
- 根据 `sourceType` → `AccessMode` 映射查找允许的能力白名单（参考 `D-HOOK-007`）。
- Grant ref 验证（如提供 `grantRef`）。
- 决策结果：`ALLOW`、`ALLOW_WITH_WARNING`、`DENY`。

**正交性说明**：Mod capability 检查是 renderer 本地门控，在 mod 调用 SDK 方法前执行。此机制与 Runtime K-GRANT token 授权正交——即使 mod 通过 Desktop capability 检查，其 SDK 请求仍需通过 Runtime K-DAEMON-005 authz 拦截器的 token 验证。两层各自独立执行，不存在绕过关系。

**D-MOD-006 — — Load 阶段**

加载 mod 入口到运行时上下文：

- 读取 `manifest.entry` 指向的源码。
- 在沙箱环境中执行 mod 注册。

**D-MOD-007 — — Lifecycle 阶段**

执行生命周期迁移：

- `enable`：`INSTALLED` / `DISABLED` → `ENABLED`
- `disable`：`ENABLED` → `DISABLED`
- `uninstall`：`INSTALLED` / `DISABLED` → `UNINSTALLED`
- `update`：`ENABLED` → `UPDATING` → `ENABLED`（失败时 → `ROLLBACK_DISABLED`）

每个阶段的决策结果有三种语义：`ALLOW` 无条件通过，`ALLOW_WITH_WARNING` 通过但记录警告（提示用户注意），`DENY` 阻止并终止管道。审计阶段将完整的 decision record 链写入本地存储。

**D-MOD-008 — — Audit 阶段**

写入审计决策记录：

- `DecisionRecord`：decisionId、modId、version、stage、result、reasonCodes、createdAt。
- `LocalAuditRecord`：id、modId、stage、eventType、decision、reasonCodes、payload、occurredAt。
- 每个 kernel stage 完成后必须产出至少一条审计记录。

**D-MOD-009 — — Access Mode 策略**

4 种访问模式的能力约束：

| Mode | 签名要求 | 能力白名单映射 | 信任级别 |
|---|---|---|---|
| `local-dev` | 无 | 按 sourceType 查表 | high |
| `community` | 必须 | 按 sourceType 查表 | medium |
| `official` | 必须（平台签名） | 按 sourceType 查表 | high |
| `sideload` | 无 | `sideload` 白名单 | low |

**D-MOD-010 — — Decision Result 语义**

- `ALLOW`：通过，进入下一阶段。
- `ALLOW_WITH_WARNING`：通过但记录警告 reason codes。
- `DENY`：拒绝，终止流水线，记录拒绝原因。

### 10.8 LLM 适配器与语音引擎

Desktop 的 LLM 层有一个关键设计决策：**不直接调用外部 AI API**。所有 AI 推理——无论是 OpenAI、Gemini 还是本地 Qwen——全部通过 SDK 的 Runtime 接口执行。Desktop 只在 Runtime 之上添加三层本地增强：provider 适配（路由到正确的 Runtime 方法）、Connector 凭据路由（通过 `connector_id` 路由到 Runtime ConnectorService 管理的凭据）、本地模型健康检查（验证 endpoint 可达性和模型状态）。

这意味着 Desktop 层面的 LLM 代码量极小——路由决策通过 `resolveChatRoute` 确定执行模式，凭据通过 `connector_id` 委托 Runtime 管理而非本地持有，健康检查通过 `checkLocalLlmHealth` 在推理前执行。

**D-LLM-001 — — Provider 适配层**

LLM 请求通过 provider 适配层路由，对齐 K-KEYSRC-001 两路径模型：

- **managed 路径**（`connector_id` 存在）：通过 ConnectorService 解析 provider / endpoint / credential（K-KEYSRC-009）。`connector_id` 由用户在 Runtime Config UI 选择 connector 后写入运行时字段。
- **inline 路径**（Phase 2，K-KEYSRC-001 inline metadata）：Desktop Phase 1 不使用 inline 路径。
- `provider` 字段仍用于 UI 展示和路由选择，但执行层凭据注入由 `connector_id` 驱动。Runtime K-PROV-005 定义 provider 归一化映射（provider 名称到 ProviderType 枚举的规范化），Desktop 应使用归一化后的 provider 名称发送请求，确保 Runtime 侧正确路由。
- `runtimeModelType` 指定模型能力类型（chat、image、video、tts、stt、embedding）。
- `localProviderEndpoint` / `localProviderModel`：本地引擎绑定。
- `localOpenAiEndpoint`：OpenAI 兼容端点。

**跨层引用**：K-KEYSRC-001、K-KEYSRC-009、K-PROV-005。

**D-LLM-002 — — 路由策略**

执行内核 turn 路由：

- 通过 `resolveChatRoute` DataSync 方法确定目标 agent 和 provider。
- `ExecutePrivateTurnInput` 封装完整请求（sessionId、turnIndex、mode、provider、model 参数）。
- `mode: 'STORY' | 'SCENE_TURN'` 确定对话模式。

**D-LLM-003 — — Connector 凭据路由**

AI 请求的凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径）：

- 用户在 Runtime Config UI 选择 connector → `connector_id` 存入运行时字段 → SDK 请求 metadata 携带 `connector_id`（K-KEYSRC-003）。
- Runtime ConnectorService 在 K-KEYSRC-004 step 5~6 加载 connector 并解密凭据注入执行上下文。
- Desktop renderer 全程不接触原始凭据，凭据安全策略由 `D-SEC-009` 定义。
- `credentialRefId` 概念废弃，统一使用 `connector_id`。

**跨层引用**：K-KEYSRC-001~004、CONN-001（spec/runtime/connector.md）。

**D-LLM-004 — — 本地 LLM 健康检查**

`checkLocalLlmHealth` 验证本地引擎可用性：

- 检查本地端点可达性。
- 验证模型已加载且状态为 `active`。
- 返回健康状态用于 UI 指示。

**与 Runtime 健康监测的关系**：Desktop `checkLocalLlmHealth` 是按需调用的即时检查（用户触发或 UI 渲染时），返回瞬时快照。Desktop 端本地健康探测应遵循 K-LENG-007 协议（`GET /v1/models`，5s 超时，HTTP 200 + 有效模型列表 = 健康）。Runtime 端有两种持久探测机制：K-LENG-007（本地引擎健康探测）和 K-PROV-003（云端 provider 周期性探测，默认 8s 间隔）。Desktop 即时检查与 Runtime 持久探测互补：Desktop 端驱动 UI 反馈，Runtime 端驱动路由降级和审计事件。

**跨层引用**：K-LENG-007（本地引擎健康探测协议）、K-PROV-001（健康状态机）。

语音引擎集成遵循相同的"不绕过 Runtime"原则。Desktop 通过 Hook 注册语音能力（7 个 speech capability keys），设置 fetch/route resolver，最终仍通过 Runtime 执行语音推理。本地 AI 推理事件通过 `LocalAiInferenceAuditPayload` 记录，包含 eventType 和 source 追踪。

**D-LLM-005 — — 语音引擎集成**

Hook runtime 提供语音能力：

- `setSpeechFetchImpl(proxyFetch)`：设置语音请求的 fetch 实现。
- `setSpeechRouteResolver(resolver)`：设置语音路由解析器。
- 路由解析：从当前 runtime fields 读取 provider、model、endpoint 配置。

语音 capability 键：
- `llm.speech.providers.list` / `llm.speech.voices.list`
- `llm.speech.synthesize` / `llm.speech.transcribe`
- `llm.speech.stream.open` / `llm.speech.stream.control` / `llm.speech.stream.close`

**D-LLM-006 — — 本地 AI 推理审计**

`LocalAiInferenceAuditPayload` 记录推理事件：

- `eventType`：`inference_invoked` / `inference_failed` / `fallback_to_token_api`（映射到 Runtime 审计字段 `operation`）
- `source`：`local-runtime` / `token-api`（映射到 Runtime 审计载荷 `payload.source`）
- `modality`：`chat` / `image` / `video` / `tts` / `stt` / `embedding`
- `adapter`：`openai_compat_adapter` / `localai_native_adapter`
- `policyGate`：策略门控信息

**审计角色定位**：Desktop `LocalAiInferenceAuditPayload` 是**展示层补充审计记录**，用于 UI 侧的推理事件追踪和本地调试。它不替代 Runtime 层的持久化审计：

- **Runtime K-AUDIT-001**（全局审计最小字段）和 **K-LOCAL-016**（本地审计）由 daemon 层写入，包含完整的 `request_id`、`trace_id`、`user_id`、`usage` 等运行时上下文字段。
- **Desktop D-LLM-006** 侧重于记录 renderer 可观测的推理决策信息（eventType、source、adapter、policyGate），不具备 runtime 上下文字段。
- 两者通过 `D-IPC-011` 的 `local_ai_append_inference_audit` 命令桥接：Desktop 将审计载荷提交到 Tauri backend，最终存入 Runtime 审计存储。

### 10.9 UI Shell 与导航体系

UI Shell 定义了 Desktop 的视觉骨架：两栏布局（可折叠侧边栏 + 内容面板），3 组导航（Core Nav 6 项 + Quick Nav 1 项 + Detail Tab），以及 lazy-load 代码分割策略。

**D-SHELL-001 — — 导航 Tab 体系**

导航由 `navigation-config.tsx` 定义，分为三组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、contacts、explore、runtime（gated）、settings
2. **Quick Nav**（`getQuickNavItems()`）：marketplace（gated）
3. **Detail Tab**：profile、agent-detail、world-detail、notification、privacy-policy、terms-of-service

Feature flag 门控：
- `enableRuntimeTab` 控制 runtime tab 可见性。
- `enableMarketplaceTab` 控制 marketplace tab 可见性。

Mod 通过 feature flag 控制组件渲染和 workspace tab，通过 slot 注入扩展 UI：

**D-SHELL-002 — — Mod UI 扩展**

Mod UI 通过 feature flag 门控：

- `enableModUi`：启用 mod 组件渲染。
- `enableModWorkspaceTabs`：启用 mod workspace tab 管理。
- `enableSettingsExtensions`：启用 settings panel 扩展区域。

Mod 导航项通过 `ui-extension.app.sidebar.mods` slot 注入（参考 `D-HOOK-004`）。

窗口管理支持原生拖拽（Desktop 通过 `enableTitlebarDrag` 启用，Web 不适用）。布局结构使用 `MainLayoutView` 两栏布局，侧边栏可折叠，内容面板根据导航状态映射。图标系统通过 `renderShellNavIcon` 提供 inline SVG 图标，未知 tab 回退到 puzzle 图标。

**D-SHELL-003 — — 窗口管理**

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。

**D-SHELL-006 — — 布局结构**

`MainLayoutView` 定义两栏布局：

- **左侧 sidebar**：可折叠，包含 core nav + quick nav + mod nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatList` + `MessageTimeline` + `TurnInput`
- `contacts` → `ContactsPanel`
- `explore` → `ExplorePanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfileView`
- `runtime` → `RuntimeView`
- `marketplace` → `MarketplaceView`
- `mod:*` → `ModWorkspacePanel`

**D-SHELL-007 — — 图标系统**

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、contacts、explore、runtime、profile、settings、store/marketplace、globe/world-studio、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout、local-chat
- 未知图标名回退到 puzzle 图标。

代码分割采用两级策略：`shell-core` 和 `bridge` 同步加载（启动关键路径），feature 模块（chat、social、economy 等）按路由 lazy-load。i18n 使用 `react-i18next` 框架，locale 文件和导航标签支持翻译。

**D-SHELL-004 — — Vite 分包策略**

代码分割策略：

- **同步加载**：shell-core、bridge（首屏必需）。
- **懒加载**：chat、contacts、explore、settings、profile、runtime-view、mod-ui、local-ai、external-agent。

懒加载通过 `React.lazy(() => import(...))` 实现，配合 `Suspense` 边界。

**D-SHELL-005 — — i18n 规范**

- 翻译框架：`react-i18next`。
- 导航 label 使用 `t('Navigation.${id}', { defaultValue: item.label })`。
- locale 文件：`locales/en.json`、`locales/zh.json`。

### 10.10 错误边界与归一化

Desktop 的错误来自 4 个来源：Runtime gRPC 错误、Realm HTTP 错误、IPC Bridge 错误、本地逻辑错误。错误边界的职责是将这 4 种异构错误**归一化为统一格式**，让上层代码不必关心错误的原始来源。

归一化采用两阶段匹配：先尝试精确 code match（如 `LOCAL_AI_IMPORT_*`、`LOCAL_AI_MODEL_*`），再尝试 pattern regex match，最后 fallback 到通用错误。每种错误码都有对应的 domain 分类和用户消息。

**D-ERR-001 — — Local AI 错误码**

本地 AI 模型管理相关错误（参考 `tables/error-codes.yaml`）：

- `LOCAL_AI_IMPORT_*`：导入路径、清单、哈希校验错误。
- `LOCAL_AI_MODEL_*`：模型不存在、哈希为空、能力无效。
- 所有错误通过 `BRIDGE_ERROR_CODE_MAP` 映射为中文用户消息。

**D-ERR-002 — — Endpoint 安全错误码**

- `LOCAL_AI_ENDPOINT_NOT_LOOPBACK`：端点非回环地址。
- `LOCAL_AI_ENDPOINT_INVALID`：端点格式无效。

安全要求：本地运行时端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

**D-ERR-003 — — Qwen TTS 环境错误码**

Qwen TTS 引擎依赖检查错误：

- `LOCAL_AI_QWEN_GPU_REQUIRED`：无可用 NVIDIA GPU。
- `LOCAL_AI_QWEN_PYTHON_REQUIRED`：缺少 Python 3.10+。
- `LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED`：Python 版本过低。
- `LOCAL_AI_QWEN_BOOTSTRAP_FAILED`：运行时依赖安装失败。

**D-ERR-004 — — Runtime 路由错误码**

- `LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED`：source type 无权执行生命周期写操作。
- `RUNTIME_ROUTE_CAPABILITY_MISMATCH`：路由绑定的模型能力不匹配。

Bridge 层的错误归一化（`BRIDGE_ERROR_CODE_MAP`）是两阶段的：先 exact code match，再 pattern regex match，最后 fallback。Bootstrap 期间的错误通过 `bootstrapRuntime().catch()` 处理，设置 `bootstrapError`、清除 auth、记录失败日志。

**D-ERR-005 — — Bridge 错误归一化**

`toBridgeUserError(error)` 两阶段错误转换：

1. **精确码匹配**：`extractBridgeErrorCode` 提取 `CODE:` 前缀 → `BRIDGE_ERROR_CODE_MAP` 查表。
2. **模式匹配**：`BRIDGE_ERROR_MAP` 正则数组依次匹配错误消息。
3. **兜底**：返回通用 `'操作失败，请稍后重试'`。

**D-ERR-006 — — Bootstrap 错误边界**

`bootstrapRuntime()` 的 `.catch()` 处理：

- 设置 `bootstrapError = message`。
- 设置 `bootstrapReady = false`。
- 清除 auth session。
- 记录 `phase:bootstrap:failed` error 日志。
- 重新抛出错误。

### 10.11 遥测与可观测性

遥测层的目标是让每个"事情发生了"都可追踪——无论是 IPC 调用、网络重试还是 bootstrap 阶段转换。

日志载荷采用结构化格式 `RuntimeLogPayload`，包含 level、area、message、traceId、flowId、source、costMs、details。消息格式有严格约定：必须使用 `action:` 或 `phase:` 前缀，`normalizeRuntimeLogMessage` 自动补充缺失的前缀。

**D-TEL-001 — — 日志载荷结构**

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

**D-TEL-002 — — 消息格式约定**

消息必须符合两种前缀之一：

- `action:<name>` — 动作类日志（如 `action:invoke-start:http_request`）
- `phase:<name>` — 阶段类日志（如 `phase:bootstrap:done`）

归一化：`normalizeRuntimeLogMessage` 自动添加 `action:` 前缀。

Logger 通过 `setRuntimeLogger(logger)` 注入，未注入时 fallback 到 `console.*`。每个 `invoke()` 调用自动生成 `invokeId` 并记录 invoke-start/success/failed 日志。

**D-TEL-003 — — Logger 注入**

`setRuntimeLogger(logger)` 注入运行时 logger：

- 非空时：日志转发到注入的 logger 函数。
- 为空时：回退到 `console.*`（`fallbackConsoleLog`）。
- 启动序列中在 `bootstrapRuntime()` 入口处注入（早于 `D-BOOT-001`），通过 `desktopBridge.logRendererEvent` 转发到 Tauri backend。

**D-TEL-005 — — Bridge 调用追踪**

每次 `invoke()` 调用生成追踪信息：

- `invokeId`：`${command}-${timestamp}-${random}`（格式由 `D-IPC-009` 定义）
- `sessionTraceId`：renderer 会话级追踪 ID。
- 日志事件：`invoke-start`（info）、`invoke-success`（debug）、`invoke-failed`（error）。

流程追踪 ID 通过 `createRendererFlowId` 生成（格式：`${prefix}-${timestamp}-${random}`），支持跨组件的请求关联。Renderer 日志可通过 IPC 转发到 Tauri 后端（`RendererLogPayload`）。网络层日志使用独立的 `net` area，记录 retrying/recovered/exhausted 事件并映射 log level。

**D-TEL-004 — — 流程追踪 ID**

`createRendererFlowId(prefix)` 生成唯一流程 ID：

- 格式：`${prefix}-${timestamp}-${random}`
- 用途：关联同一流程的多条日志（如 bootstrap 流程）。

**D-TEL-006 — — Renderer 日志转发**

Renderer 日志通过 IPC 转发到 Tauri backend：

- `RendererLogPayload` 与 `RuntimeLogPayload` 结构对齐。
- `toRendererLogMessage()` 确保消息格式正确。

**D-TEL-007 — — 网络层日志区域**

`net` 日志区域用于网络重试事件和错误归一化日志：

- 重试事件：`action:retry:retrying`、`action:retry:recovered`、`action:retry:retry_exhausted`。
- 日志级别：retrying=warn、recovered=info、exhausted=error。
- 来源：`request-with-retry.ts` 中的 `requestWithRetry` 函数。

### 10.12 网络层：代理、重试与实时

Desktop 的网络层解决三个问题：CORS 绕过、失败重试、实时通信。

**代理 Fetch**：`createProxyFetch()` 将所有 HTTP 请求代理到 Tauri 后端的 `http_request` IPC 命令，从根本上绕过浏览器 CORS 限制。错误通过 `normalizeApiError()` 统一格式化（status + message + fallback）。

**D-NET-004 — — 代理 Fetch**

`createProxyFetch()` 创建通过 Tauri backend 代理的 fetch 实现：

- 所有 HTTP 请求通过 `http_request` IPC 命令（`D-IPC-004`）转发。
- 绕过浏览器 CORS 限制。
- Desktop 模式的 DataSync 和 LLM 请求均使用此 fetch。

**D-NET-005 — — 错误归一化**

`normalizeApiError(error, fallbackMessage?)` 统一错误格式：

- API 错误：保留 status、message。
- 网络错误：转为统一 Error 对象。
- fallbackMessage：无法解析时的兜底消息。

**重试策略**：7 个 HTTP 状态码被标记为可重试（408、425、429、500、502、503、504）。`requestWithRetry` 使用指数退避：maxAttempts=3、initialDelayMs=120、maxDelayMs=900。每次重试触发 `RetryEvent` 回调（retrying/recovered/retry_exhausted），携带 reason 追踪。

**D-NET-001 — — 可重试状态码**

以下 HTTP 状态码触发自动重试（参考 `tables/retry-status-codes.yaml`）：

- `408` Request Timeout
- `425` Too Early
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout

**D-NET-002 — — 重试策略**

`requestWithRetry` 实现指数退避重试：

默认参数：
- `maxAttempts: 3`
- `initialDelayMs: 120`
- `maxDelayMs: 900`

退避算法：`delayMs = min(maxDelayMs, initialDelayMs * 2^(attempt-1) + uniform_jitter[0, initialDelayMs/2])`

重试条件：
- **状态码重试**：`RETRYABLE_STATUS_CODES.has(error.status)` — `RetryReasonKind: 'status'`
- **网络错误重试**：`AbortError` 或 `TypeError` — `RetryReasonKind: 'network'`

**跨传输重试参数差异说明**：Desktop HTTP 重试参数（120ms initial / 900ms cap）与 SDK Runtime gRPC 重试参数（SDKR-045: 200ms initial / 3000ms cap）不同。此差异是设计意图：

**参数选取依据**（同 K-DAEMON-006/007 注释模式）：
- HTTP（Realm API）初始退避 120ms：Realm REST API 平均响应 <50ms，120ms 足以覆盖瞬时抖动且不引入用户可感知延迟。Cap 900ms：3 次重试总等待 ≈120+240+480≈840ms（含 jitter <1.2s），用户体验上限约 1s。
- gRPC（Runtime）初始退避 200ms：AI 推理 RPC 本身延迟高（首包 1-10s），200ms 退避在推理超时上下文中忽略不计。Cap 3000ms：推理场景更可能因 provider 过载导致暂时不可用，更大退避区间降低 thundering herd 风险。

**D-NET-003 — — 重试事件**

`RetryEvent` 通过 `onRetryEvent` 回调通知：

- `retrying`：开始重试，包含 delayMs、reasonKind、status。
- `recovered`：重试后恢复，包含 retryCount。
- `retry_exhausted`：重试耗尽，最终失败。

**实时传输**：Socket.IO WebSocket 连接绕过 CORS，携带 auth token 和 session protocol。内建事件去重和断线恢复机制。

**D-NET-006 — — Realtime Transport**

**SDK 契约引用**：SDK SDKREALM-035/036/037 定义 Realm 实时传输的 SDK 层约束（token 注入、事件不丢失保证）。D-NET-006 是 Desktop 层的具体实现，满足 SDK 层约束。

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

**D-SEC-001 — — Endpoint 回环限制**

本地运行时端点必须为回环地址：

- 允许：`localhost`、`127.0.0.1`、`[::1]`
- 错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`（`D-ERR-002`）

此规则防止本地 AI 推理流量意外路由到远程地址。

**安全深度说明**：Desktop renderer 层仅执行回环地址校验作为前端防线。完整的端点安全模型由 Runtime daemon 层执行（K-SEC-002~005），包括：HTTPS-only 默认策略、loopback 显式开关（`allow_loopback_provider_endpoint`）、高风险地址无条件拒绝（link-local `169.254.0.0/16`、私网 `fc00::/7`）、DNS 解析后 IP 重验证、TOCTOU pin 防护。两层协同保护确保本地端点安全。

**Layer 2: Bearer Token 管理** — Token 存储在 Zustand `auth.token` 中，同步到 DataSync hot state。Desktop 和 Web 通过各自的持久化机制管理 Realm access token（Web 使用 localStorage 加过期机制，敏感页面需二次验证，logout 时完全清除）。

**D-SEC-002 — — Bearer Token 管理**

- Token 存储在 Zustand store `auth.token` 字段。
- DataSync 热状态中保持 token 副本。
- Token 更新通过 `setToken()` 同步到所有消费者。
- Token 清除触发：logout、auth 失败、bootstrap 错误。

**D-SEC-010 — — Web 端 Token 存储安全**

Web 环境 token 存储安全约束（参考 `D-AUTH-003`）：

- localStorage 存储的 token 必须设置合理的过期时间。
- 敏感页面（economy、auth）需在操作前重新验证 token 有效性。
- 禁止将 token 写入 cookie 以避免 CSRF 风险。
- logout 操作必须清除所有 localStorage 中的认证数据。

**Layer 2.5: AI 凭据委托** — AI provider API key 的唯一托管者是 Runtime ConnectorService（CONN-001: custodian not distributor）。Desktop renderer 不接触原始 API key，通过 SDK `CreateConnector` / `UpdateConnector` 将凭据写入 Runtime 后即刻丢弃内存副本。AI 请求通过 `connector_id` 路由，Desktop/Web 统一使用 SDK ConnectorService 接口。

**D-SEC-009 — — AI 凭据委托模型**

AI provider 凭据（API key）的唯一托管者是 Runtime ConnectorService（CONN-001: custodian not distributor，定义于 spec/runtime/connector.md）：

- Desktop renderer **不接触**原始 API key。用户通过 UI 输入凭据后，Desktop 调用 SDK `CreateConnector` / `UpdateConnector`（K-RPC-007/008）将凭据写入 Runtime，写入后即刻丢弃内存副本。
- AI 请求通过 `connector_id`（managed 路径，K-KEYSRC-001）路由到 Runtime，Runtime 在执行上下文中解密注入凭据（K-KEYSRC-004 step 6），下游不直接访问 CredentialStore。
- Realm access token（非 AI 凭据）仍由 `D-AUTH-002` / `D-AUTH-003` 管理，与 ConnectorService 无关。
- Desktop / Web 统一使用 SDK ConnectorService 接口，无平台差异。

**跨层引用**：CONN-001、K-RPC-003、K-RPC-007~009、K-KEYSRC-001/004。

**Layer 3: OAuth 安全** — OAuth 流程通过 Tauri IPC 执行，支持 PKCE 和 clientSecret 两种模式，通过 redirect URI 监听完成授权。

**D-SEC-003 — — OAuth 安全**

OAuth 流程通过 Tauri IPC 执行（参考 `D-IPC-006`）：

- 支持 PKCE：`codeVerifier` 参数。
- 支持 `clientSecret` 模式。
- Redirect URI 监听：`oauth_listen_for_code` 命令在本地端口监听回调。
- 超时：`timeoutMs` 参数防止无限等待。

**Layer 4: IPC 桥接隔离** — `hasTauriInvoke()` 检查 `window.__TAURI__` 存在性，统一 `invoke()` 入口确保所有 IPC 调用经过单一校验点。CSP 策略约束 script/style 加载和 connect-src 白名单。

**D-SEC-004 — — IPC 桥接安全**

- `hasTauriInvoke()` 检查 `window.__TAURI__` 存在性。
- 非 Tauri 环境抛出明确错误而非静默失败。
- 所有 IPC 调用通过统一入口 `invoke()` 执行，确保日志追踪覆盖。

**D-SEC-008 — — CSP 策略**

Content Security Policy 约束：

- Tauri webview 默认启用 CSP，限制外部脚本和样式加载。
- `connect-src` 仅允许 realm API 域名和回环地址。
- `script-src` 禁止 `eval` 和 inline script（mod 通过沙箱 iframe 隔离）。
- Web 模式下依赖服务端 CSP header 而非 Tauri webview 策略。

**Layer 5: Mod 能力沙箱** — Mod 在 capability sandbox 中执行，source-type 强制执行最小权限（如 10.6 所定义）。本地 AI 模型要求非空 `manifest.hashes` 进行完整性校验。External Agent 的 token 支持签发、撤销、列表和网关监控。

**D-SEC-005 — — Mod 能力沙箱**

Mod 执行在能力沙箱内（参考 `D-HOOK-007`、`D-MOD-005`）：

- Source type 决定可用能力集。
- 未声明的能力调用被拒绝。
- `codegen` source type 使用最小权限原则。

**D-SEC-006 — — 模型完整性校验**

本地 AI 模型安装要求完整性验证：

- `manifest.hashes` 非空。
- 导入时执行 `LOCAL_AI_IMPORT_HASH_MISMATCH` 检查。
- 空哈希模型无法启动（`LOCAL_AI_MODEL_HASHES_EMPTY`）。

**跨层引用**：Runtime K-LOCAL-009 在 `InstallLocalModel` 路径执行清单验证（格式校验、引擎类型校验）。Desktop D-SEC-006 的 hash 完整性检查是 UX 前端防线，与 Runtime 层清单验证互补。

**信任边界声明**：Desktop D-SEC-006 的 hash 校验是 UX 层防线，防止用户通过 Desktop UI 启动未经验证的模型。Runtime K-LOCAL-009 是格式/引擎校验的权威层，但 Phase 1 不做 hash 验证。通过 Runtime gRPC 直接安装的模型（绕过 Desktop UI）可能缺少 hash 信息——Desktop 启动该模型时会被 `LOCAL_AI_MODEL_HASHES_EMPTY` 拦截，此为设计意图（Desktop 作为 UX 守护层）。

**D-SEC-007 — — External Agent Token 安全**

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
5. 目标 spec 域的 CI 一致性检查必须通过（对应 `check:<domain>-spec-kernel-consistency`）。此条件确保毕业后的 spec 不会破坏已有的一致性守护。

毕业是一个**原子操作**——三个步骤必须在同一个变更集中完成：① 在目标 spec 域创建/扩展对应文档，② 在 `graduation-log.yaml` 中追加毕业记录，③ 更新 backlog item 状态为 `spec-drafted`。拆分为多个 commit 会产生中间不一致状态。

**F-GRAD-002 — 毕业流程**

1. 在目标 spec 域（`spec/runtime/` 或 `spec/sdk/`）创建或扩展对应文档。
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
| Generate | unary |
| StreamGenerate | server_stream |
| Embed | unary |
| SubmitMediaJob | unary |
| GetMediaJob | unary |
| CancelMediaJob | unary |
| SubscribeMediaJobEvents | server_stream |
| GetMediaResult | unary |
| GetSpeechVoices | unary |
| SynthesizeSpeechStream | server_stream |

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

**RuntimeLocalRuntimeService**

| 方法 | 类型 |
|---|---|
| ListLocalModels | unary |
| InstallLocalModel | unary |
| RemoveLocalModel | unary |
| StartLocalModel | unary |
| StopLocalModel | unary |
| CheckLocalModelHealth | unary |
| ListVerifiedModels | unary |
| SearchCatalogModels | unary |
| ResolveModelInstallPlan | unary |
| InstallVerifiedModel | unary |
| ImportLocalModel | unary |
| CollectDeviceProfile | unary |
| ListLocalServices | unary |
| InstallLocalService | unary |
| StartLocalService | unary |
| StopLocalService | unary |
| CheckLocalServiceHealth | unary |
| RemoveLocalService | unary |
| ListNodeCatalog | unary |
| ResolveDependencies | unary |
| ApplyDependencies | unary |
| ListLocalAudits | unary |
| AppendInferenceAudit | unary |
| AppendRuntimeAudit | unary |

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

**ScriptWorkerService**

| 方法 | 类型 |
|---|---|
| Execute | unary |

### 12.2 Runtime — ReasonCode 错误码表

| 名称 | 值 | 族 |
|---|---:|---|
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
| AI_LOCAL_MODEL_ALREADY_INSTALLED | 354 | MODEL |
| AI_LOCAL_ENDPOINT_REQUIRED | 355 | MODEL |
| AI_LOCAL_TEMPLATE_NOT_FOUND | 356 | MODEL |
| AI_LOCAL_MANIFEST_INVALID | 357 | MODEL |
| AI_FINISH_LENGTH | 370 | FINISH |
| AI_FINISH_CONTENT_FILTER | 371 | FINISH |
| AI_MODEL_PROVIDER_MISMATCH | 380 | MODEL_ROUTE |
| AI_PROVIDER_ENDPOINT_FORBIDDEN | 390 | PROVIDER |
| AI_PROVIDER_AUTH_FAILED | 391 | PROVIDER |
| AI_PROVIDER_UNAVAILABLE | 202 | PROVIDER |
| AI_PROVIDER_INTERNAL | 392 | PROVIDER |
| AI_PROVIDER_RATE_LIMITED | 393 | PROVIDER |
| AI_PROVIDER_TIMEOUT | 394 | PROVIDER |
| AI_STREAM_BROKEN | 208 | PROVIDER |
| AI_MEDIA_SPEC_INVALID | 410 | MEDIA |
| AI_MEDIA_OPTION_UNSUPPORTED | 411 | MEDIA |
| AI_MEDIA_JOB_NOT_FOUND | 412 | MEDIA |
| AI_MEDIA_JOB_NOT_CANCELLABLE | 413 | MEDIA |
| AI_MEDIA_IDEMPOTENCY_CONFLICT | 414 | MEDIA |
| AI_MODULE_CONFIG_INVALID | 430 | MODULE |
| WF_DAG_INVALID | 440 | WORKFLOW |
| WF_NODE_CONFIG_MISMATCH | 441 | WORKFLOW |
| WF_TIMEOUT | 442 | WORKFLOW |
| WF_TASK_NOT_FOUND | 443 | WORKFLOW |
| APP_MODE_DOMAIN_FORBIDDEN | 500 | APP_AUTH |
| APP_MODE_SCOPE_FORBIDDEN | 501 | APP_AUTH |
| APP_MODE_MANIFEST_INVALID | 502 | APP_AUTH |
| APP_SCOPE_FORBIDDEN | 503 | APP_AUTH |
| APP_SCOPE_REVOKED | 504 | APP_AUTH |
| GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND | 510 | GRANT |
| GRANT_TOKEN_CHAIN_ROOT_REQUIRED | 511 | GRANT |
| PAGE_TOKEN_INVALID | 520 | PAGE |

### 12.3 Runtime — 错误映射矩阵

| ReasonCode | gRPC Code | 场景 | 出口形态 |
|---|---|---|---|
| SESSION_EXPIRED | UNAUTHENTICATED | authn_session_check | grpc_status |
| AUTH_TOKEN_INVALID | UNAUTHENTICATED | authn_all | grpc_status |
| AUTH_TOKEN_EXPIRED | UNAUTHENTICATED | external_principal_proof_expired | grpc_status |
| AUTH_UNSUPPORTED_PROOF_TYPE | INVALID_ARGUMENT | external_principal_registration | grpc_status |
| AI_CONNECTOR_NOT_FOUND | NOT_FOUND | consume_remote_or_hidden_connector | grpc_status |
| AI_CONNECTOR_DISABLED | FAILED_PRECONDITION | consume_or_connector_probe | grpc_status |
| AI_CONNECTOR_CREDENTIAL_MISSING | FAILED_PRECONDITION | consume_or_list_models | grpc_status |
| AI_CONNECTOR_INVALID | INVALID_ARGUMENT | connector_manage_input_validation | grpc_status |
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
| AI_STREAM_BROKEN | UNAVAILABLE | stream_mid_flight_disconnect | grpc_status |
| AI_PROVIDER_AUTH_FAILED | FAILED_PRECONDITION | media_snapshot_credential_invalid | grpc_status |
| AI_MEDIA_SPEC_INVALID | INVALID_ARGUMENT | submit_media_job | grpc_status |
| AI_MEDIA_OPTION_UNSUPPORTED | INVALID_ARGUMENT | submit_media_job | grpc_status |
| AI_MEDIA_JOB_NOT_FOUND | NOT_FOUND | media_control | grpc_status |
| AI_MEDIA_JOB_NOT_CANCELLABLE | FAILED_PRECONDITION | cancel_media_job | grpc_status |
| AI_MEDIA_IDEMPOTENCY_CONFLICT | ALREADY_EXISTS | submit_media_job | grpc_status |
| AI_FINISH_LENGTH | OK | generate_or_stream_terminal_reason | terminal_reason_non_error |
| AI_FINISH_CONTENT_FILTER | OK | generate_or_stream_terminal_reason | terminal_reason_non_error |
| AI_MODEL_PROVIDER_MISMATCH | INVALID_ARGUMENT | model_prefix_provider_mismatch | grpc_status |
| AI_LOCAL_MODEL_PROFILE_MISSING | FAILED_PRECONDITION | local_consume_or_probe | grpc_status_or_payload_ok_false |
| AI_LOCAL_MODEL_UNAVAILABLE | FAILED_PRECONDITION | local_consume_or_probe | grpc_status_or_payload_ok_false |
| AI_LOCAL_MODEL_ALREADY_INSTALLED | ALREADY_EXISTS | install_local_model_duplicate | grpc_status |
| AI_LOCAL_ENDPOINT_REQUIRED | INVALID_ARGUMENT | install_or_start_local_model_nexa_no_endpoint | grpc_status |
| AI_LOCAL_TEMPLATE_NOT_FOUND | NOT_FOUND | install_verified_model_template_missing | grpc_status |
| AI_LOCAL_MANIFEST_INVALID | INVALID_ARGUMENT | import_local_model_manifest_parse_fail | grpc_status |
| AI_MODULE_CONFIG_INVALID | FAILED_PRECONDITION | runtime_module_boot_or_reload | grpc_status |
| APP_MODE_DOMAIN_FORBIDDEN | PERMISSION_DENIED | app_mode_gate | grpc_status |
| APP_MODE_SCOPE_FORBIDDEN | PERMISSION_DENIED | app_mode_gate | grpc_status |
| APP_MODE_MANIFEST_INVALID | INVALID_ARGUMENT | register_app_manifest_validation | grpc_status |
| APP_SCOPE_FORBIDDEN | PERMISSION_DENIED | scope_prefix_gate | grpc_status |
| APP_SCOPE_REVOKED | PERMISSION_DENIED | scope_revocation_check | grpc_status |
| WF_DAG_INVALID | INVALID_ARGUMENT | workflow_submit | grpc_status |
| WF_NODE_CONFIG_MISMATCH | INVALID_ARGUMENT | workflow_submit | grpc_status |
| WF_TIMEOUT | DEADLINE_EXCEEDED | workflow_execute | grpc_status |
| WF_TASK_NOT_FOUND | NOT_FOUND | workflow_query | grpc_status |
| GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND | NOT_FOUND | grant_list_token_chain | grpc_status |
| GRANT_TOKEN_CHAIN_ROOT_REQUIRED | INVALID_ARGUMENT | grant_list_token_chain | grpc_status |
| PAGE_TOKEN_INVALID | INVALID_ARGUMENT | list_rpc_page_token_validation | grpc_status |

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

**media_job**

状态: QUEUED → RUNNING → COMPLETED → FAILED → CANCELLED → EXPIRED

| 从 | 到 | 触发条件 |
|---|---|---|
| QUEUED | RUNNING | provider_accepts_job |
| QUEUED | FAILED | terminal_error_before_run |
| QUEUED | CANCELLED | user_cancel |
| QUEUED | EXPIRED | ttl_expired |
| RUNNING | COMPLETED | provider_success |
| RUNNING | FAILED | provider_or_runtime_failure |
| RUNNING | CANCELLED | user_cancel |
| RUNNING | EXPIRED | ttl_expired |

**local_model_lifecycle**

状态: INSTALLED → ACTIVE → UNHEALTHY → REMOVED

| 从 | 到 | 触发条件 |
|---|---|---|
| INSTALLED | ACTIVE | start_or_health_recovered |
| ACTIVE | UNHEALTHY | health_probe_failed |
| UNHEALTHY | ACTIVE | recovery_probe_passed |
| ACTIVE | REMOVED | remove_model |
| UNHEALTHY | REMOVED | force_remove_model |
| ACTIVE | INSTALLED | stop_model |
| UNHEALTHY | INSTALLED | stop_model_from_unhealthy |
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
| localai | http://127.0.0.1:1234/v1 | attached_endpoint | openai_compatible |
| nexa | — | attached_endpoint | openai_compatible |

### 12.7 Runtime — 本地适配器路由

| Provider | Capability | Adapter |
|---|---|---|
| nexa | * | nexa_native_adapter |
| localai | image | localai_native_adapter |
| localai | video | localai_native_adapter |
| localai | tts | localai_native_adapter |
| localai | stt | localai_native_adapter |
| * | * | openai_compat_adapter |

### 12.8 SDK — 错误码

| 名称 | 族 | 描述 |
|---|---|---|
| SDK_APP_ID_REQUIRED | SDK_CONFIG | — |
| SDK_TRANSPORT_INVALID | SDK_CONFIG | — |
| SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED | SDK_CONFIG | — |
| SDK_RUNTIME_VERSION_INCOMPATIBLE | SDK_CONFIG | — |
| SDK_RUNTIME_METHOD_UNAVAILABLE | SDK_CONFIG | — |
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
| SDK_TARGET_REQUIRED | SDK_CONFIG | — |
| OPERATION_ABORTED | SDK_SYNTHETIC_REASON | — |
| RUNTIME_UNAVAILABLE | SDK_SYNTHETIC_REASON | — |
| RUNTIME_BRIDGE_DAEMON_UNAVAILABLE | SDK_SYNTHETIC_REASON | — |

### 12.9 SDK — 导入边界

| 子路径 | 禁止导入 | 基线规则 |
|---|---|---|

### 12.10 SDK — Runtime 方法投影分组

**ai_service_projection** → AIService

- Generate
- StreamGenerate
- Embed
- SubmitMediaJob
- GetMediaJob
- CancelMediaJob
- SubscribeMediaJobEvents
- GetMediaResult
- GetSpeechVoices
- SynthesizeSpeechStream

**connector_service_projection** → ConnectorService

- CreateConnector
- GetConnector
- ListConnectors
- UpdateConnector
- DeleteConnector
- TestConnector
- ListConnectorModels

**local_runtime_service_projection** → RuntimeLocalRuntimeService

- ListLocalModels
- InstallLocalModel
- RemoveLocalModel
- StartLocalModel
- StopLocalModel
- CheckLocalModelHealth
- ListVerifiedModels
- SearchCatalogModels
- ResolveModelInstallPlan
- InstallVerifiedModel
- ImportLocalModel
- CollectDeviceProfile
- ListLocalServices
- InstallLocalService
- StartLocalService
- StopLocalService
- CheckLocalServiceHealth
- RemoveLocalService
- ListNodeCatalog
- ResolveDependencies
- ApplyDependencies
- ListLocalAudits
- AppendInferenceAudit
- AppendRuntimeAudit

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

**script_worker_service_projection** → ScriptWorkerService

- Execute

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
| runtime_bridge_status | Get runtime daemon status (running, managed, launchMode, grpcAddr) |
| runtime_bridge_start | Start runtime daemon |
| runtime_bridge_stop | Stop runtime daemon |
| runtime_bridge_restart | Restart runtime daemon |
| runtime_bridge_config_get | Get runtime bridge configuration |
| runtime_bridge_config_set | Set runtime bridge configuration |
| http_request | Proxy HTTP request through Tauri backend (bypasses browser CORS) |
| open_external_url | Open external URL in system browser |
| confirm_private_sync | Confirm private data sync for agent/session |
| start_window_drag | Start native window drag operation |
| oauth_token_exchange | Exchange OAuth authorization code for tokens |
| oauth_listen_for_code | Listen for OAuth callback code on redirect URI |
| runtime_mod_list_local_manifests | List local mod manifest summaries |
| runtime_mod_read_local_entry | Read local mod entry source code |
| external_agent_issue_token | Issue external agent access token |
| external_agent_revoke_token | Revoke external agent access token |
| external_agent_list_tokens | List external agent tokens |
| external_agent_sync_action_descriptors | Sync external agent action descriptors |
| external_agent_complete_execution | Complete external agent action execution |
| external_agent_gateway_status | Get external agent gateway status |
| local_ai_list_models | List local AI models |
| local_ai_list_verified_models | List verified local AI models |
| local_ai_install_model | Install a local AI model |
| local_ai_install_verified_model | Install a verified local AI model |
| local_ai_import_model | Import a local AI model from file |
| local_ai_start_model | Start a local AI model |
| local_ai_stop_model | Stop a local AI model |
| local_ai_remove_model | Remove a local AI model |
| local_ai_health_models | Health check for local AI models |
| local_ai_list_audits | List local AI inference audits |
| local_ai_append_inference_audit | Append a local AI inference audit record |
| local_ai_pick_manifest_path | Pick a local AI model manifest file path |
| local_ai_subscribe_download_progress | Subscribe to local AI model download progress events |

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
| marketplace | Marketplace | quick | enableMarketplaceTab |
| profile | Profile | detail | — |
| agent-detail | Agent Detail | detail | — |
| world-detail | World Detail | detail | — |
| notification | Notification | detail | — |
| privacy-policy | Privacy Policy | detail | — |
| terms-of-service | Terms of Service | detail | — |
| mod:* | Mod Workspace | mod | enableModWorkspaceTabs |

### 12.14 Desktop — Store Slices

| Slice | 描述 | Factory |
|---|---|---|
| auth | Authentication status, user object, and token management | createAuthSlice |
| runtime | Runtime execution fields (provider, model, agent, world bindings) | createRuntimeSlice |
| mod-workspace | Mod workspace tabs, fused mod tracking, mod failures | createModWorkspaceSlice |
| ui | Active tab, selected IDs, navigation history, status banner | createUiSlice |

### 12.15 Desktop — Hook 子系统

| 子系统 | Namespace | 描述 |
|---|---|---|
| event | event.publish.*|event.subscribe.* | Pub/sub event bus for inter-mod and system event communication |
| data | data.query.*|data.register.* | Shared data capability registration and querying |
| turn | turn.register.* | Turn hook points for intercepting AI conversation lifecycle |
| ui | ui.register.* | UI slot registration for visual extension points |
| inter-mod | inter-mod.request.*|inter-mod.provide.* | Cross-mod RPC-style request/provide channels |

### 12.16 Desktop — UI Slots

| 槽位 | 描述 |
|---|---|
| auth.login.form.footer | Login form footer area for additional auth providers or links |
| chat.sidebar.header | Chat sidebar header for custom controls or branding |
| chat.chat.list.item.trailing | Trailing content in chat list item rows |
| chat.turn.input.toolbar | Turn input toolbar for custom action buttons |
| settings.panel.section | Settings panel additional section for mod settings |
| ui-extension.app.sidebar.mods | Sidebar mod navigation entries |
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
| builtin | event.publish.*, event.subscribe.*, data.query.*, data.register.*, turn.register.*, ui.register.*, inter-mod.request.*, inter-mod.provide.*, llm.text.generate, llm.text.stream, llm.image.generate, llm.video.generate, llm.embedding.generate, llm.lifecycle.read, llm.speech.providers.list, llm.speech.voices.list, llm.speech.synthesize, llm.speech.stream.open, llm.speech.stream.control, llm.speech.stream.close, llm.speech.transcribe, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self, meta.read.all | Default desktop mods loaded via manifest+sideload pipeline |
| injected | event.publish.*, event.subscribe.*, data.query.*, data.register.*, turn.register.pre-model, turn.register.post-state, ui.register.*, inter-mod.request.*, llm.text.generate, llm.text.stream, llm.image.generate, llm.video.generate, llm.embedding.generate, llm.lifecycle.read, llm.speech.providers.list, llm.speech.voices.list, llm.speech.synthesize, llm.speech.stream.open, llm.speech.stream.control, llm.speech.stream.close, llm.speech.transcribe, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self | Third-party injected mods with restricted turn hook access |
| sideload | event.publish.*, data.query.*, ui.register.*, inter-mod.request.*, llm.text.generate, llm.text.stream, llm.image.generate, llm.video.generate, llm.embedding.generate, llm.lifecycle.read, llm.speech.providers.list, llm.speech.voices.list, llm.speech.synthesize, llm.speech.stream.open, llm.speech.stream.control, llm.speech.stream.close, llm.speech.transcribe, action.discover.*, action.dry-run.*, action.verify.*, action.commit.*, audit.read.self, meta.read.self | Locally sideloaded mods with no subscribe/register/provide access |
| codegen | llm.text.generate, llm.text.stream, ui.register.ui-extension.app.*, data.register.data-api.user-*.*.*, data.query.data-api.user-*.*.*, audit.read.self, meta.read.self | AI-generated mods with minimal capabilities |

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
| enableMarketplaceTab | true | false | Show Marketplace tab in quick navigation |
| enableModUi | true | false | Enable mod UI extension rendering |
| enableModWorkspaceTabs | true | false | Enable mod workspace tab management |
| enableSettingsExtensions | true | false | Enable settings panel extension sections |
| enableTitlebarDrag | true | false | Enable native window titlebar drag |
| enableRuntimeBootstrap | true | false | Execute full runtime bootstrap sequence (hook runtime, mods, external agent) |

### 12.22 Desktop — 数据同步流

| 领域 | 方法 | 描述 |
|---|---|---|
| auth | login, register, logout | Authentication flows (credential exchange, session teardown) |
| user | loadCurrentUser, updateUserProfile, loadUserProfile | User profile read/write |
| chat | loadChats, loadMoreChats, startChat, loadMessages, loadMoreMessages, sendMessage, syncChatEvents, flushChatOutbox, markChatRead | Chat list, message timeline, outbox, event sync |
| social | loadContacts, loadSocialSnapshot, searchUser, requestOrAcceptFriend, rejectOrRemoveFriend, removeFriend, blockUser, unblockUser, loadFriendRequests | Contacts, friend requests, social graph |
| world | loadWorlds, loadWorldDetailById, loadWorldSemanticBundle, loadMainWorld, loadWorldLevelAudits | World listing, detail, semantic data |
| transit | loadSceneQuota, startWorldTransit, listWorldTransits, getActiveWorldTransit, startTransitSession, addTransitCheckpoint, completeWorldTransit, abandonWorldTransit | World transit and scene management |
| economy | loadCurrencyBalances, loadSparkTransactionHistory, loadGemTransactionHistory, loadSubscriptionStatus, loadWithdrawalEligibility, loadWithdrawalHistory, createWithdrawal, loadGiftCatalog, sendGift, claimGift, rejectGift, createGiftReview | Currency, transactions, subscriptions, gifts |
| feed | loadPostFeed, createPost, createImageDirectUpload, createVideoDirectUpload | Social feed posts and media uploads |
| explore | loadExploreFeed, loadMoreExploreFeed, loadAgentDetails | Explore discovery feed and agent detail |
| notification | loadNotificationUnreadCount, loadNotifications, markNotificationsRead, markNotificationRead | Notification listing and read status |
| settings | loadMySettings, updateMySettings, loadMyNotificationSettings, updateMyNotificationSettings, loadMyCreatorEligibility | User settings and notification preferences |
| agent | loadMyAgents, recallAgentMemoryForEntity, listAgentCoreMemories, listAgentE2EMemories, loadAgentMemoryStats, resolveChatRoute | Agent listing, memory, chat routing |

### 12.23 Desktop — 错误码

| Error Code | Domain | 描述 |
|---|---|---|
| LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT | local-ai | Import path not within Local Runtime models directory |
| LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID | local-ai | Only model.manifest.json files may be imported |
| LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND | local-ai | Model manifest file not found at import path |
| LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED | local-ai | Model manifest JSON parsing failed |
| LOCAL_AI_IMPORT_HASH_MISMATCH | local-ai | Model file checksum verification failed |
| LOCAL_AI_ENDPOINT_NOT_LOOPBACK | local-ai | Local runtime endpoint must be localhost/127.0.0.1/[::1] |
| LOCAL_AI_ENDPOINT_INVALID | local-ai | Local runtime endpoint format invalid |
| LOCAL_AI_MODEL_NOT_FOUND | local-ai | No installed/active model found |
| LOCAL_AI_MODEL_HASHES_EMPTY | local-ai | Model integrity check incomplete, cannot start |
| LOCAL_AI_MODEL_CAPABILITY_INVALID | local-ai | Model capability configuration invalid |
| LOCAL_AI_QWEN_GPU_REQUIRED | local-ai | Qwen TTS requires available NVIDIA GPU |
| LOCAL_AI_QWEN_PYTHON_REQUIRED | local-ai | Qwen TTS requires Python 3.10+ |
| LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED | local-ai | Qwen TTS Python version too low |
| LOCAL_AI_QWEN_BOOTSTRAP_FAILED | local-ai | Qwen TTS runtime dependency installation failed |
| LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED | runtime | Source has no permission for model lifecycle write operations |
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
| F-HEARTBEAT-001 | 心跳驱动的主动 Agent | high | platform | proposed |
| F-AIMETA-001 | AI 产物元数据标准 | high | platform | proposed |
| F-MULTIMODAL-001 | 多模态 AI 能力（TTS/STT/图像/视频生成） | high | platform | proposed |
| F-RAG-001 | 知识库/RAG 系统 | medium | platform | proposed |
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
| F-WFTRIGGER-001 | 工作流触发器系统 | high | platform | proposed |
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

### 12.27 Future — Research Sources

| Source ID | 标题 | 路径 |
|---|---|---|
| RESEARCH-OFANG-001 | OpenFang 竞品深度审计报告 | dev/research/openfang-competitive-audit-2026-03-01.md |

### 12.28 Future — Graduation Log

> *暂无毕业记录*
