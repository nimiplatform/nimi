---
title: Nimi SDK Runtime/Realm Init Contract
status: ACTIVE
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - SDK 不提供 `createNimiClient`；初始化入口固定为 `Runtime` 与 `Realm` 两个 class。
  - 初始化失败必须返回结构化 `NimiError`，不得暴露裸字符串错误给调用方。
  - `Runtime` 内置 scope 与 appAuth 的 catalog-version 绑定约束必须保持开启。
  - Runtime 身份上下文优先级固定为 `per-call > authContext.subjectUserId > authContext.getSubjectUserId()`。
---

# Runtime/Realm 初始化合同

## 1. 初始化入口（事实）

来源：`sdk/src/runtime/runtime.ts`、`sdk/src/realm/client.ts`。

入口：

1. `new Runtime(options)`
2. `new Realm(options)`

无聚合入口；应用侧按需分别创建并编排两个客户端。

## 2. Runtime 初始化约束

1. `appId` 必填，空值拒绝。
2. `transport` 必填，且必须显式声明 `node-grpc` 或 `tauri-ipc`。
3. `connection.mode` 支持 `auto`（默认）与 `manual`。
4. `manual` 模式下未 `connect()` 调用 API 必须抛 `RUNTIME_UNAVAILABLE`。
5. `subjectUserId` 解析顺序固定为：
`per-call > authContext.subjectUserId > authContext.getSubjectUserId()`；
三层都缺失时必须抛 `AUTH_CONTEXT_MISSING`。

## 3. Realm 初始化约束

1. `baseUrl` 必填，空值拒绝。
2. `auth`/`headers` 支持静态值或 provider。
3. 配置必须实例隔离，不允许全局单例污染。

## 4. Runtime + Scope 绑定行为

`Runtime.appAuth.authorizeExternalPrincipal` 必须在发起授权前调用 `scope.resolvePublishedCatalogVersion`：

1. 保障请求中 `scopeCatalogVersion` 必为已发布版本。
2. 若 runtime 回包 `issuedScopeCatalogVersion` 与请求版本不一致，应发出 telemetry 事件。

## 5. 验收门禁

1. `sdk/test/runtime/runtime-class.test.ts`
2. `sdk/test/realm/realm-client.test.ts`
3. `pnpm --filter @nimiplatform/sdk lint`
4. `pnpm --filter @nimiplatform/sdk test`
