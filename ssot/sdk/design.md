---
title: Nimi SDK Design Skeleton
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# SDK Design (V0.1 必填骨架)

## 0. 文档定位（必填）

本文件用于把 `@nimiplatform/sdk` 从“概念入口”推进到可发布的稳定接口合同。

- 当前状态：`FROZEN`
- 用途：SDK 实现与文档同步的冻结草案
- 非目标：不定义具体业务场景编排

## 1. 目标与边界（必填）

**目标**：定义 `@nimiplatform/sdk` 作为唯一开发者接入面的稳定合同。  
**边界**：只定义 SDK 结构、导入面、错误与版本策略（strict-only）。

补充边界：
- App 可只接入 runtime，不强依赖 realm。
- ExternalPrincipal 访问 App 的授权由 SDK 封装流程，但 token 签发/校验由 runtime 执行。
- SDK 负责 scope catalog 定义与版本发布；授权判定/签发/执行不在 SDK 内完成。

## 2. 包结构与职责（必填）

SDK 采用**单包模型**：仅 `@nimiplatform/sdk` 一个发布包，通过稳定子路径分域暴露能力。

| 子路径 | 角色 | 约束 |
|----|------|---------|
| `@nimiplatform/sdk` | 聚合入口（facade） | 仅转发稳定子路径，不暴露私有实现路径 |
| `@nimiplatform/sdk/realm` | realm HTTP/WS 客户端 | 禁止暴露 `core/models/services/generated` 深层导入 |
| `@nimiplatform/sdk/runtime` | runtime gRPC/IPC 客户端 | 禁止跨域引用 realm 私有实现 |
| `@nimiplatform/sdk/types` | 全域共享语义类型 + `ReasonCode` | 不依赖 IO 客户端 |
| `@nimiplatform/sdk/scope` | scope catalog 能力 | 仅暴露稳定 schema/发布接口 |
| `@nimiplatform/sdk/mod/*` | mod/hook 公开接口 | host 装配仅 `mod/host` 可见 |
| `@nimiplatform/sdk/ai-provider` | AI SDK provider 适配层 | 依赖 runtime/types 稳定面 |

稳定规则：
- `MUST`：所有对外能力仅经 `@nimiplatform/sdk/*` 发布。
- `MUST NOT`：出现 legacy 包名或兼容壳。
- `MUST NOT`：公开 `internal/generated` 私有路径。

## 3. 稳定导入面（必填）

### 3.1 入口约束

- 推荐导入：
  - `@nimiplatform/sdk`（聚合入口，适合快速接入）
  - `@nimiplatform/sdk/realm`
  - `@nimiplatform/sdk/runtime`
  - `@nimiplatform/sdk/types`
  - `@nimiplatform/sdk/ai-provider`
- 约束：
  - `@nimiplatform/sdk` 与子路径导出语义必须一致，不允许同名能力出现行为差异
  - 生产环境 `SHOULD` 使用子路径导入以保持依赖边界清晰
- 禁止导入：
  - `internal/*`
  - `generated/*`（除显式公开入口）
  - 跨包私有实现路径

### 3.2 初始化入口（V1 冻结）

```ts
createNimiClient({
  appId: 'app_xxx',
  realm: { baseUrl: '...' }, // optional
  runtime: {
    transport: {
      type: 'node-grpc',
      endpoint: 'unix:///... or tcp://...',
    },
    // or:
    // transport: { type: 'tauri-ipc', commandNamespace: 'runtime_bridge', eventNamespace: 'runtime_bridge' },
  },
});
```

冻结规则：
1. `MUST`：`appId` 必填。
2. `MUST`：`realm` 与 `runtime` 至少配置一个。
3. `MUST`：初始化失败返回结构化 `NimiError`，不得抛出裸字符串错误。
4. `SHOULD`：默认注入统一 `traceId` 生成器，允许调用方覆盖。
5. `MUST`：`runtime.transport` 必须显式声明，V1 支持 `node-grpc`（trusted 进程）与 `tauri-ipc`（desktop renderer，经 Rust bridge 转 runtime gRPC）。

## 4. @nimiplatform/sdk/realm 合同（必填）

### 4.1 API 来源

- 来源：realm OpenAPI codegen 产物
- 发布：跟随 realm API 版本发布
- 变更：必须附升级说明

### 4.2 必填定义

- 认证模型（登录、token、刷新）
- realtime 事件模型（连接、重连、回放）
- 错误码映射（HTTP -> SDK reasonCode）
- 重试与幂等策略（默认策略 + 可覆盖）

## 5. @nimiplatform/sdk/runtime 合同（必填）

### 5.1 传输协议

- `node-grpc`：trusted 进程直连 runtime gRPC（unary/server streaming/bidi）
- `tauri-ipc`：desktop renderer -> tauri Rust bridge -> runtime gRPC（unary/server streaming）
- `local-broker`（FUTURE 占位）：IPC/loopback 到本地 broker（由 broker 代理到 runtime gRPC）

### 5.1.1 Local Broker 授权合同（FUTURE 占位）

`brokerGrant` 最小字段：
- `iss/aud`
- `origin`
- `appId`
- `subjectUserId`
- `effectiveScopes`
- `routePolicy=local-runtime`
- `exp`
- `jti`
- `keyId`

说明：
- 当前阶段仅保留字段与语义占位，不纳入 V1 实现/验收。
- 启用时再冻结 SDK 侧强约束与错误码映射。

### 5.2 必填定义

- 会话握手与鉴权注入
- L0 协议 metadata 注入（`protocolVersion/participantId/traceId/idempotencyKey`）
- 传输 profile 注入（V1：`node-grpc` + `tauri-ipc`）
- 超时与取消语义
- 大 payload 处理策略
- 连接恢复策略（断线重连、重订阅）

### 5.3 App 授权最小 API（必填）

规范来源：授权语义真相以 `platform/protocol.md §3.4` 为准；本节只定义 SDK 导入面与参数合同。

```ts
type AuthorizationPreset = 'readOnly' | 'full' | 'delegate';

runtimeClient.appAuth.authorizeExternalPrincipal({
  domain: 'app-auth',
  appId: 'app_a',
  externalPrincipalId: 'ext_principal_1',
  externalPrincipalType: 'external-app',
  subjectUserId: 'usr_1',
  consentId: 'cons_1',
  consentVersion: '1.0',
  decisionAt: '2026-02-24T10:00:00Z',
  policyVersion: '1.0.0',
  policyMode: 'preset',
  preset: 'readOnly', // or customPolicy
  scopes: ['app.app_a.chat.read'],
  resourceSelectors: { conversationIds: ['conv_1'] },
  canDelegate: false,
  maxDelegationDepth: 0,
  ttlSeconds: 86400,
  idempotencyKey: 'idem_1',
  scopeCatalogVersion: '1.0.0',
});

runtimeClient.appAuth.revokeToken({
  appId: 'app_a',
  tokenId: 'atk_xxx',
  idempotencyKey: 'idem_2',
});

runtimeClient.appAuth.issueDelegatedToken({
  parentTokenId: 'atk_parent',
  scopes: ['app.app_a.chat.read'],
  resourceSelectors: { conversationIds: ['conv_1'] },
  ttlSeconds: 1800,
  idempotencyKey: 'idem_3',
});
```

约束：
1. `MUST`：SDK 暴露 `preset + customPolicy` 同构接口，不维护两套 API。
2. `MUST`：SDK 不本地签发访问 token，只调用 runtime 签发接口。
3. `MUST`：同一 ExternalPrincipal 跨 App 授权必须显式传入不同 `appId`。
4. `SHOULD`：默认使用 preset，custom 仅在高级场景启用。
5. `MUST`：授权请求必须携带同意证据字段（`subjectUserId + consentId + consentVersion + decisionAt`）。
6. `MUST`：`resourceSelectors` 存在时，SDK 不得在本地忽略或降级该约束。
7. `MUST`：所有写操作 API 必须显式支持 `idempotencyKey`。
8. `MUST`：`preset=delegate` 默认按单跳委托构造策略（`maxDelegationDepth=1`），不默认开启二次委托。
9. `MUST`：策略更新后，SDK 必须将旧 token 视为失效并引导重新授权/重新签发。
10. `MUST`：授权创建与 token 签发必须通过单事务 RPC（`AuthorizeExternalPrincipal`），SDK 不拆成两次调用。
11. `MUST`：SDK 必须透出 `issuedScopeCatalogVersion` 到 token 描述与日志上下文。

### 5.3.1 custom policy 最小字段（V1 冻结）

当 `policyMode=custom` 时，最小字段必须完整提供：

- `scopes`
- `resourceSelectors`（可为空对象但字段必须显式出现）
- `ttlSeconds`
- `canDelegate`
- `maxDelegationDepth`
- 同意证据字段：`subjectUserId + consentId + consentVersion + decisionAt`

示例：
- `external-agent`：OpenClaw 访问聊天 App。
- `external-app`：小说生成 App 只读访问聊天 App 指定会话记录。

### 5.4 SDK API -> Runtime RPC 映射（必填）

Schema 真相源：`runtime/proto-contract.md`（SDK 映射必须与 proto 字段/方法名一致，不允许在 SDK 文档内重定义 proto 字段语义）。

| SDK API | Runtime RPC | 说明 |
|---------|-------------|------|
| `appAuth.authorizeExternalPrincipal` | `AuthorizeExternalPrincipal` | 单事务创建授权策略并签发一次性 secret |
| `appAuth.validateToken` | `ValidateAppAccessToken` | 统一校验过期/撤销/scope/resource/consent |
| `appAuth.revokeToken` | `RevokeAppAccessToken` | 支持主 token 与子 token 级联撤销 |
| `appAuth.issueDelegatedToken` | `IssueDelegatedAccessToken` | 子 token 必须是父 token 权限子集 |
| `appAuth.listTokenChain` | `ListTokenChain` | 用于审计与可视化委托链 |

### 5.5 Scope Catalog 自动生成（必填）

目标：把授权 scope 的定义真相收敛到 SDK，减少手工声明导致的不一致。

规则：
1. `MUST`：SDK 是 `scope catalog` 的唯一发布面（面向 app 开发者）。
2. `MUST`：核心 scopes 自动生成：`realm.*` 来自 Realm OpenAPI，`runtime.*` 来自 Runtime proto。
3. `MUST`：App 自有能力 scope 通过 SDK 的扩展声明入口（scope manifest）并入 catalog，不允许 runtime 侧手工补录。
4. `MUST`：`readOnly/full/delegate` preset 从 scope catalog 自动映射生成。
5. `MUST`：SDK 在授权请求中透传已发布的 `scopeCatalogVersion`，并接收 `issuedScopeCatalogVersion` 写入 token 描述。
6. `MUST`：SDK 不执行最终授权；`app-auth/runtime.*` 由 Runtime 执行，`realm.*` 由 Realm 执行。
7. `SHOULD`：Realm/Runtime 固定能力通过 `capabilityProfileRef` 发布，SDK 默认读取 profile 而非手工声明。
8. `MUST`：六原语 `PROVIDER` 由 Realm 独占，SDK 不暴露给第三方 App 的原语提供方声明入口。
9. `MUST`：App 扩展 scope 仅能通过 SDK scope 模块注册（注册即分发入口）。
10. `MUST`：扩展 scope 必须在 `app.<appId>.*` 命名空间，禁止声明/覆盖 `realm.*`、`runtime.*`、`platform.*`。
11. `MUST`：scope manifest 发布前必须通过 SDK 自动审核（schema/命名空间/冲突/preset 映射/版本规则一致性）。
12. `MUST`：App 授权页面与 external principal 的 scope 查询必须读取 SDK scope 模块，不读 app 私有副本。
13. `MUST`：World 扩展写入相关 scope 由 Realm 发布为 `realm.world.extension.*`，不允许 App 扩展 manifest 自行声明。

SDK scope 模块（V1 最小接口示例）：

```ts
const catalog = sdk.scope.listCatalog({
  appId: 'app_a',
  include: ['realm', 'runtime', 'app'],
});

await sdk.scope.registerAppScopes({
  appId: 'app_a',
  manifest: {
    manifestVersion: '1.0.0',
    scopes: ['app.app_a.chat.read', 'app.app_a.chat.write'],
  },
});

const published = await sdk.scope.publishCatalog({
  appId: 'app_a',
});
// published.scopeCatalogVersion -> 透传到授权请求
```

### 5.6 SDK scope 模块 API 合同（必填）

最小 API：

1. `scope.listCatalog({ appId, include })`
2. `scope.registerAppScopes({ appId, manifest })`
3. `scope.publishCatalog({ appId })`
4. `scope.revokeAppScopes({ appId, scopes })`

最小返回：

- `scopeCatalogVersion`
- `catalogHash`
- `status`（`draft|published|revoked`）

规则：
1. `MUST`：`registerAppScopes` 仅接收 `app.<appId>.*` 命名空间。
2. `MUST`：`publishCatalog` 前必须完成自动审核并生成唯一 `catalogHash`。
3. `MUST`：`publishCatalog` 成功后才能用于授权请求；未发布版本不得透传到 runtime。
4. `MUST`：`revokeAppScopes` 后，SDK 必须标记后续版本移除该 scope，并提示调用方重签授权策略。
5. `MUST`：scope 模块错误必须结构化透传，不允许 UI 层自行猜测失败原因。

## 6. AI Provider 合同（必填）

冻结定位：
- `@nimiplatform/sdk/ai-provider` 是 Vercel AI SDK v6 custom provider 适配层。
- 适配对象是单模型调用（unary/stream）。
- Workflow DAG 不走 provider，走 `sdk.runtime.workflow.*` 独立接口。

### 6.1 模型入口

- `text`
- `embedding`
- `image`

说明：
- `video/tts/stt` 在 V1 通过 `@nimiplatform/sdk/runtime` 扩展 API 提供，不要求映射到 Vercel AI SDK 标准模型接口。

### 6.2 适配规则

- 请求参数归一化
- provider 差异字段映射
- 错误码统一映射
- 流式事件统一封装

### 6.3 AI 最小 API（V1 冻结）

```ts
sdk.runtime.ai.generate({
  appId: 'app_a',
  subjectUserId: 'usr_1',
  modelId: 'chat/default',
  modal: 'text',
  input: [{ role: 'user', content: 'hello' }],
  routePolicy: 'local-runtime',
  timeoutMs: 30000,
  idempotencyKey: 'idem_ai_1',
});

sdk.runtime.ai.streamGenerate({
  appId: 'app_a',
  subjectUserId: 'usr_1',
  modelId: 'chat/default',
  modal: 'text',
  input: [{ role: 'user', content: 'tell me a joke' }],
  // trusted process: node-grpc; desktop renderer: tauri-ipc -> Rust bridge
  routePolicy: 'token-api',
  fallback: 'deny',
  timeoutMs: 120000,
  idempotencyKey: 'idem_ai_2',
});
```

`generate` 最小返回：
- `output`
- `finishReason`
- `usage`
- `routeDecision`
- `modelResolved`
- `traceId`

`streamGenerate` 事件最小字段：
- `eventType`（`started|delta|tool_call|tool_result|usage|completed|failed`）
- `sequence`
- `traceId`
- `timestamp`
- `payload`

### 6.4 AI 路由与回退（无 legacy）

1. `MUST`：SDK 请求必须显式传入 `routePolicy`，不允许隐式默认。
2. `MUST`：仅允许 `local-runtime|token-api`。
3. `MUST`：默认 `fallback=deny`，调用方显式开启才允许回退。
4. `MUST`：发生回退时 SDK 必须向调用方暴露 `routeDecision`，并透传 runtime 审计 trace。
5. `MUST`：未声明回退时的回退尝试必须失败（`AI_ROUTE_FALLBACK_DENIED`）。

### 6.5 AI SDK API -> Runtime RPC 映射（必填）

说明：
- 以下为 `sdk.runtime.ai.*` 公共调用面的映射，不等同于“全部由 Vercel AI SDK 标准模型接口承载”。
- `video/tts/stt` 属于 runtime 扩展 API，由 SDK 统一导出但不强制映射到 AI SDK 标准模型类型。
- `generateImage/generateVideo/tts` 在 runtime proto 层为 chunk streaming；SDK 默认可提供“聚合后一次返回”的便捷封装。

| SDK API | Runtime RPC | 说明 |
|---------|-------------|------|
| `ai.generate` | `Generate` | unary 推理 |
| `ai.streamGenerate` | `StreamGenerate` | streaming 推理 |
| `ai.embed` | `Embed` | embedding |
| `ai.generateImage` | `GenerateImage` | 图像生成 |
| `ai.generateVideo` | `GenerateVideo` | 视频生成 |
| `ai.tts` | `SynthesizeSpeech` | 语音合成 |
| `ai.stt` | `TranscribeAudio` | 语音识别 |

### 6.6 Workflow DAG 独立接口（V1 冻结）

```ts
const task = await sdk.runtime.workflow.submit({
  appId: 'app_a',
  subjectUserId: 'usr_1',
  definition: workflowDef,
  idempotencyKey: 'idem_wf_1',
});

const status = await sdk.runtime.workflow.get({ taskId: task.taskId });
await sdk.runtime.workflow.cancel({ taskId: task.taskId });
const stream = sdk.runtime.workflow.subscribeEvents({ taskId: task.taskId });
```

约束：
1. `MUST`：DAG 编排仅通过 `sdk.runtime.workflow.*`。
2. `MUST`：`@nimiplatform/sdk/ai-provider` 不暴露 DAG 提交/取消/订阅接口。
3. `MUST`：需要跨模型依赖、重试、进度、取消、审计回放的场景必须使用 workflow 接口。
4. `MUST`：禁止在 SDK 层用多次 `ai.generate/streamGenerate` 手工拼接替代 runtime DAG 编排。

## 7. 类型与错误系统（必填）

### 7.1 类型约束

- 公共类型单一来源：`@nimiplatform/sdk/types`
- 严禁稳定导入面出现隐式 `any`
- 跨域语义对象必须显式命名

App 授权核心类型（必填）：
- `AppGrantPolicy`
- `AuthorizationPreset`
- `AppAccessTokenDescriptor`
- `DelegatedAccessTokenDescriptor`
- `AppAuthorizationDecision`
- `AppConsentEvidence`
- `AppResourceSelectors`
- `DomainCapabilityDeclaration`
- `ScopeManifest`
- `ScopeCatalogDescriptor`
- `ScopeCatalogPublishResult`

### 7.2 错误封装（最小）

```ts
type NimiError = {
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: 'realm' | 'runtime' | 'sdk';
};
```

App 授权错误码最小集合（SDK 必须透传）：
- `APP_AUTHORIZATION_DENIED`
- `APP_GRANT_INVALID`
- `APP_TOKEN_EXPIRED`
- `APP_TOKEN_REVOKED`
- `APP_SCOPE_FORBIDDEN`
- `CAPABILITY_CATALOG_MISMATCH`
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

App 模式违规 `actionHint` 最小映射（SDK 必须透传）：
- `APP_MODE_DOMAIN_FORBIDDEN` -> `remove_realm_scopes_or_switch_mode_full` / `remove_runtime_scopes_or_switch_mode_full`
- `APP_MODE_SCOPE_FORBIDDEN` -> `adjust_scopes_for_app_mode`
- `APP_MODE_WORLD_RELATION_FORBIDDEN` -> `set_world_relation_render_or_none_or_switch_mode`
- `APP_MODE_MANIFEST_INVALID` -> `fix_mode_manifest_and_resubmit`

AI 错误码最小集合（SDK 必须透传）：
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

Scope 模块错误码最小集合（SDK 侧）：
- `APP_SCOPE_MANIFEST_INVALID`
- `APP_SCOPE_NAMESPACE_FORBIDDEN`
- `APP_SCOPE_CONFLICT`
- `APP_SCOPE_CATALOG_UNPUBLISHED`
- `APP_SCOPE_REVOKED`

## 8. 版本策略（strict-only，必填）

### 8.1 版本语义

- `major`：破坏性变更
- `minor`：功能新增（V1 要求同 minor 对齐）
- `patch`：行为修复与非语义改动

### 8.2 发布承诺（V1 预上线）

1. `MUST`：仅支持当前发布主线（当前为 `1.x`）的最新可用版本组合。
2. `MUST`：跨 major 或跨 minor 版本组合直接判定 `Not supported`，不提供任何过渡态。
3. `MUST`：breaking 变更只能通过 `major` 升版引入，并提供升级说明与可执行示例。
4. `MUST`：experimental API 超过 2 个 `minor` 必须升级为稳定或移除。

### 8.3 版本矩阵（必填）

| SDK 版本 | Realm API 版本 | Runtime API 版本 | 状态 |
|---------|----------------|------------------|------|
| `1.x` | `1.x` | `1.x` | Supported |
| `1.x` | `1.x` | `2.x` | Not supported |
| `2.x` | `1.x` | `2.x` | Not supported |

## 9. 开发者体验（必填）

### 9.1 必填能力

- 最小初始化模板
- 健康检查 API
- 诊断信息导出
- mock/stub 测试入口
- ExternalPrincipal 授权向导（preset 三选一）
- custom policy 配置器（可选）

### 9.2 文档产物

- API 参考文档
- 错误码字典
- 最小可运行样例
- 升级指南

## 10. 发布与验收（必填）

- [x] 包边界与导入面冻结
- [x] realm/runtime 错误码统一
- [x] App 授权错误码映射冻结（authorize/revoke/delegate）
- [x] App 模式违规错误码与 actionHint 映射冻结（mode/domain/scope/worldRelation/manifest）
- [x] SDK API -> runtime RPC 映射冻结并回归校验
- [x] AI SDK API -> runtime RPC 映射冻结并回归校验
- [x] AI 流式事件 envelope 回归通过（started/delta/usage/completed/failed）
- [x] AI 路由/回退策略回归通过（explicit route + fallback deny）
- [x] scope catalog 自动生成与版本校验链路通过
- [x] scope 模块错误码映射冻结（manifest/publish/revoke）
- [x] 版本矩阵一致性校验通过
- [x] 样例工程可运行
- [x] runtime-only 接入样例可运行（不依赖 realm）
- [x] ExternalPrincipal 授权样例可运行（preset + custom）
- [x] 升级指南可执行
- [x] 禁止导入面检测脚本通过
- [x] 生成代码 CI 再生比对通过（零 diff）
- [x] experimental API 生命周期检查通过（未超期）

> REF-ERRATA (2026-02-25): §10 验收清单全量更新为已验收。依据：
> 包边界由 `check:sdk-import-boundary` CI 门禁保障；错误码映射由 runtime-compliance 23/23 gate 覆盖；
> SDK→RPC 映射由 `sdk-runtime` contract test + gRPC 回归保障；AI 流式事件由 `ai-provider` 测试保障；
> scope catalog 由 `check:scope-catalog-drift` 门禁保障；版本矩阵由 `check:sdk-version-matrix` 校验；
> 样例工程由 `check:examples` 门禁保障；禁止导入面由 `check:sdk-import-boundary` 保障；
> 生成代码 CI 再生由 `proto:drift-check` 保障；experimental API 由 `check:experimental-api-lifecycle` 保障。

## 11. 决策收敛（必填）

### 11.1 已决策（2026-02-24）

- [是] 提供单包聚合入口 `@nimiplatform/sdk`（并保留子路径导入）
- [是] 实验 API 采用 `@nimiplatform/sdk/experimental/*` 发布轨并带过期机制
- [是] 生成代码采用“提交仓库 + CI 可再生校验”策略
- [是] custom policy 最小字段集在 V1 冻结

### 11.2 冻结补充规则

1. `MUST`：实验 API 必须在路径与类型上显式标注 `experimental`，不得混入稳定导入面。
2. `MUST`：实验 API 默认最多存活 2 个 `minor` 版本，超期必须升级为稳定或删除。
3. `MUST`：代码生成产物提交仓库；CI 必须执行再生比对，出现 diff 直接失败。
4. `MUST`：V1 custom policy 最小字段固定为：`scopes + resourceSelectors + ttlSeconds + canDelegate + maxDelegationDepth + consent evidence`。

### 11.3 待定项

- 当前无待定项（新增待定需先写入 `INDEX.md` 决策记录）。
