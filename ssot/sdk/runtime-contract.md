---
title: Nimi SDK Runtime Subpath Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - `@nimiplatform/sdk/runtime` 是 runtime 协议的唯一 SDK 封装入口。
  - method-id、codec、bridge allowlist 必须保持一致，不允许漂移。
  - 写请求必须具备幂等键注入策略，读请求不得注入伪幂等键。
---

# runtime 子路径合同

## 1. 对外能力（事实）

来源：`sdk/src/runtime/index.ts`。

导出包含：

1. `errors/types/method-ids/workflow-builder`
2. runtime proto 关键 enum（`Modal`、`RoutePolicy`、`FallbackPolicy` 等）
3. `createRuntimeClient`
4. transport 工厂：`createNodeGrpcTransport`、`createTauriIpcTransport`

## 2. RuntimeClient 结构

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

## 3. transport 合同

### 3.1 node-grpc

1. 要求 `endpoint` 非空，否则 `SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED`。
2. 支持 TLS 选项与 metadata header 注入。
3. gRPC 错误会规范化为 `NimiError`，含 reasonCode/actionHint/retryable。

### 3.2 tauri-ipc

1. 依赖 `window.__TAURI__.core.invoke` 与 `window.__TAURI__.event.listen`。
2. 缺失时分别报 `SDK_RUNTIME_TAURI_INVOKE_MISSING` / `SDK_RUNTIME_TAURI_LISTEN_MISSING`。
3. request/response 走 base64 protobuf bytes。
4. 支持自定义 `commandNamespace/eventNamespace`，并可回退到默认 `runtime_bridge_*`。

## 4. 请求规范化与校验

1. AI 请求必须显式 `routePolicy`，否则 `SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED`。
2. AI `fallback` 未指定时默认改写为 `DENY`。
3. `appAuth.authorizeExternalPrincipal` 对关键字段有强校验（domain/appId/consent/decisionAt/policy/scopeCatalogVersion 等）。
4. 写方法自动注入 `idempotencyKey`；读方法不注入。

## 5. metadata 合同

来源：`sdk/src/runtime/core/metadata.ts`。

默认值策略：

1. `protocolVersion` / `participantProtocolVersion` 默认 `1.0.0`
2. `participantId` / `callerId` 默认 `appId`
3. `domain` 默认 `runtime.rpc`
4. `callerKind` 默认 `third-party-app`
5. `extra` 仅透传 `x-nimi-*` 头

## 6. Workflow Builder 合同

来源：`sdk/src/runtime/workflow-builder.ts`。

提供 typed node 构造器：

1. AI 节点：`aiGenerate|aiStream|aiEmbed|aiImage|aiVideo|aiTts|aiStt`
2. 变换/控制节点：`extract|template|script|branch|merge|noop`
3. 图结构：`workflowEdge` + `workflowDefinition`

## 7. 验收门禁

1. `sdk/test/runtime/runtime-client.test.ts`
2. `sdk/test/runtime/runtime-node-grpc-integration.test.ts`
3. `sdk/test/runtime/runtime-bridge-method-parity.test.ts`
4. `sdk/test/runtime/workflow-builder.test.ts`
5. `pnpm check:runtime-bridge-method-drift`
