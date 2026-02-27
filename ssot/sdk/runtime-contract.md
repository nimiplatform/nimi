---
title: Nimi SDK Runtime Subpath Contract
status: ACTIVE
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - `@nimiplatform/sdk/runtime` 是 runtime 协议的唯一 SDK 封装入口。
  - `Runtime` class 是面向应用的主入口；`createRuntimeClient` 保留为底层协议层入口。
  - `subjectUserId` 解析优先级固定为 `per-call > authContext.subjectUserId > authContext.getSubjectUserId()`；缺失时必须抛 `AUTH_CONTEXT_MISSING`。
  - 流式请求中断后不得隐式续流；调用方必须显式重订阅。
  - method-id、codec、bridge allowlist 必须保持一致，不允许漂移。
  - 写请求必须具备幂等键注入策略，读请求不得注入伪幂等键。
---

# runtime 子路径合同

## 1. 对外能力（事实）

来源：`sdk/src/runtime/index.ts`。

导出包含：

1. `Runtime` class（`new Runtime(...)`）
2. `errors/types/method-ids/workflow-builder`
3. runtime proto 关键 enum（`Modal`、`RoutePolicy`、`FallbackPolicy` 等）
4. `createRuntimeClient`（底层协议入口）
5. transport 工厂：`createNodeGrpcTransport`、`createTauriIpcTransport`

## 2. Runtime class 合同

来源：`sdk/src/runtime/runtime.ts`、`sdk/src/runtime/vnext-types.ts`。

### 2.1 生命周期与连接语义

1. 生命周期面固定为：`connect/ready/close/state/health/call`。
2. `connection.mode` 仅允许 `auto|manual`，默认 `auto`。
3. `manual` 模式下，未先 `connect()` 调用 API 必须抛 `RUNTIME_UNAVAILABLE`。
4. `auto` 模式允许首次调用懒连接，并按重试配置执行有限重连。

### 2.2 身份上下文语义

1. `subjectUserId` 解析顺序固定：
`per-call > authContext.subjectUserId > authContext.getSubjectUserId()`。
2. 三层都缺失时，必须抛 `AUTH_CONTEXT_MISSING`。

### 2.3 流式语义

1. 连接中断后当前流必须结束并输出错误事件，不得隐式续流。
2. 后续流请求必须由调用方显式发起二次订阅。

### 2.4 Raw 逃生口

1. `runtime.raw.call` 必须可直达 method-id 调用路径。
2. `runtime.raw.closeStream` 必须保持可用，承载外部流关闭控制。

### 2.5 Scope 绑定

`Runtime.appAuth.authorizeExternalPrincipal` 调用前必须执行
`scope.resolvePublishedCatalogVersion`，保证授权请求使用已发布 catalog 版本。

## 3. RuntimeClient 结构

来源：`sdk/src/runtime/types.ts` + `sdk/src/runtime/core/client.ts`。

`RuntimeClient` 模块：

1. `auth`（7）
2. `appAuth`（5）
3. `ai`（12）
4. `workflow`（4）
5. `model`（4）
6. `localRuntime`（24）
7. `knowledge`（3）
8. `app`（2）
9. `audit`（7）
10. `closeStream(streamId)`

总计 68 个 method-id；其中 stream 方法 10 个，写方法 40 个。

## 4. transport 合同

### 4.1 node-grpc

1. 要求 `endpoint` 非空，否则 `SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED`。
2. 支持 TLS 选项与 metadata header 注入。
3. gRPC 错误会规范化为 `NimiError`，含 reasonCode/actionHint/retryable。

### 4.2 tauri-ipc

1. 依赖 `window.__TAURI__.core.invoke` 与 `window.__TAURI__.event.listen`。
2. 缺失时分别报 `SDK_RUNTIME_TAURI_INVOKE_MISSING` / `SDK_RUNTIME_TAURI_LISTEN_MISSING`。
3. request/response 走 base64 protobuf bytes。
4. 支持自定义 `commandNamespace/eventNamespace`，并可回退到默认 `runtime_bridge_*`。

## 5. 请求规范化与校验

1. AI 请求必须显式 `routePolicy`，否则 `SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED`。
2. AI `fallback` 未指定时默认改写为 `DENY`。
3. `appAuth.authorizeExternalPrincipal` 对关键字段有强校验（domain/appId/consent/decisionAt/policy/scopeCatalogVersion 等）。
4. 写方法自动注入 `idempotencyKey`；读方法不注入。
5. `token-api` 的 `credentialSource` 属于 transport profile 安全上下文，不通过 runtime `.proto` body 字段表达。
6. `@nimiplatform/sdk/runtime` 不暴露 `connectorId` 或明文 secret 字段到 runtime 请求体。

## 6. metadata 合同

来源：`sdk/src/runtime/core/metadata.ts`。

默认值策略：

1. `protocolVersion` / `participantProtocolVersion` 默认 `1.0.0`
2. `participantId` / `callerId` 默认 `appId`
3. `domain` 默认 `runtime.rpc`
4. `callerKind` 默认 `third-party-app`
5. `extra` 仅透传 `x-nimi-*` 头

## 7. Workflow Builder 合同

来源：`sdk/src/runtime/workflow-builder.ts`。

提供 typed node 构造器：

1. AI 节点：`aiGenerate|aiStream|aiEmbed|aiImage|aiVideo|aiTts|aiStt`
2. 变换/控制节点：`extract|template|script|branch|merge|noop`
3. 图结构：`workflowEdge` + `workflowDefinition`

## 8. 验收门禁

1. `sdk/test/runtime/runtime-client.test.ts`
2. `sdk/test/runtime/runtime-node-grpc-integration.test.ts`
3. `sdk/test/runtime/runtime-bridge-method-parity.test.ts`
4. `sdk/test/runtime/runtime-class.test.ts`
5. `sdk/test/runtime/runtime-class-coverage.test.ts`
6. `sdk/test/runtime/workflow-builder.test.ts`
7. `pnpm check:runtime-bridge-method-drift`
8. `pnpm check:sdk-vnext-matrix`
