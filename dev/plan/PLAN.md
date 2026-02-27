# SDK vNext 重构执行计划（Runtime/Realm 主线，P0 决策已锁定）

## 实现状态（2026-02-27）
1. P0 五项闭环已实现：Realm 生成链路迁移、Runtime 重连语义、`AUTH_CONTEXT_MISSING` 对齐、OpenAPI 全局态全仓移除、`desktop-mods-smoke` 可复现硬门禁。
2. 关键验证命令均已通过：
`pnpm --filter @nimiplatform/sdk lint`；
`pnpm --filter @nimiplatform/sdk test`；
`pnpm check:sdk-coverage`；
`pnpm check:sdk-consumer-smoke`；
`pnpm check:no-create-nimi-client`；
`pnpm check:no-openapi-base-assignment`；
`pnpm check:no-openapi-token-assignment`；
`pnpm check:no-openapi-singleton-import`；
`pnpm check:desktop-mods-smoke`；
`pnpm lint`。
3. 实施证据见：
[dev/report/sdk-vnext-remediation-2026-02-27.evidence.md](/Users/snwozy/nimi-realm/nimi/dev/report/sdk-vnext-remediation-2026-02-27.evidence.md)。

## 摘要
1. 采用 `Runtime` / `Realm` 双 class 作为唯一主入口，移除 `createNimiClient` 主入口地位。
2. Realm 生成链路切换为 `openapi-typescript + openapi-fetch`，实现实例隔离，彻底移除全局 `OpenAPI` 单例污染。
3. AI Provider 与 Mod 子系统同批迁移，改为显式注入 `Runtime`/`Realm`，不再依赖全局单例。
4. Runtime 身份上下文采用 `Provider + per-call override`，并定义 auto 连接断线重连、请求等待与失败语义。
5. 以“能力不回退”为硬门槛，建立 runtime/realm/scope/ai-provider/mod 覆盖矩阵与 CI 阻断规则。

## 已锁定决策
1. Realm 技术路线：`openapi-typescript + openapi-fetch`。
2. AI Provider / Mod：同批迁移并保留为官方导出子路径。
3. subjectUserId 注入：`RuntimeOptions.authContext` 提供默认值，每次调用可 override。
4. Runtime 连接策略：`auto` 下自动重连 + 限时等待，不做无限排队。
5. Realm 错误模型：完整分层映射到统一 `NimiError`。

## 公开 API/类型变更（必须落地）
1. 顶层导出：
`@nimiplatform/sdk` 仅主推 `Runtime`, `Realm`, `NimiError` 与核心类型；`createNimiClient` 进入 hard-fail 移除路径。
2. Runtime 类：
`connect/ready/close/state/health/call`；模块包含 `auth/appAuth/ai/media/workflow/model/localRuntime/knowledge/app/audit/scope/raw`。
3. Realm 类：
`connect/ready/close/state`；稳定 facade（`auth/users/posts/worlds/notifications/media/search/transits`）+ `services` 全量能力透传 + `raw.request`。
4. 身份上下文：
新增 `RuntimeAuthContextProvider`：
`getSubjectUserId(): string | Promise<string>`；
调用参数允许 `subjectUserId?: string` 覆盖。
5. 错误对象：
统一 `NimiError { code, reasonCode, actionHint, source, traceId, retryable, details }`。
6. 连接配置：
`RuntimeOptions.connection.mode = 'auto' | 'manual'`；
`retry` 明确作用于重连与可重试请求。
7. 流式语义：
文本流统一 `AsyncIterable<TextStreamPart>`；`close` 可选暴露。
8. 原始逃生口：
`runtime.raw.call` / `runtime.raw.closeStream`；
`realm.raw.request`。

## 目标目录与代码组织（实施后）
1. Runtime：
保留并内聚 [sdk/src/runtime](/Users/snwozy/nimi-realm/nimi/sdk/src/runtime) 现有 transport/proto 能力；新增 `Runtime` class facade 与连接状态机层。
2. Realm：
新增实例化客户端层，围绕 [scripts/generate-realm-sdk.mjs](/Users/snwozy/nimi-realm/nimi/scripts/generate-realm-sdk.mjs) 改造生成产物。
3. AI Provider：
保留 [sdk/src/ai-provider/index.ts](/Users/snwozy/nimi-realm/nimi/sdk/src/ai-provider/index.ts) 子路径，签名改为接收 `Runtime`。
4. Mod：
保留 `@nimiplatform/sdk/mod/*` 导出，改为显式依赖注入而非全局 hook runtime。

## 实施切片（决策完成、可直接开工）
### Slice 0：规范冻结与门禁先行
1. 冻结两份 vNext 文档为实现基线：
[dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/plan/sdk-vnext-typescript-interface-spec-2026-02-27.md)；
[dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md](/Users/snwozy/nimi-realm/nimi/dev/plan/sdk-vnext-user-centric-implementation-plan-2026-02-27.md)。
2. 增加 CI 阻断：
`no-createNimiClient`；
`no-global-openapi-config`；
`no-OpenAPI-BASE-assignment`；
`no-OpenAPI-TOKEN-assignment`。
3. 建立覆盖矩阵检查脚本：runtime 方法数、realm operation 覆盖、scope 行为覆盖、ai-provider/mod 可用性。

### Slice 1：Runtime class 落地（可与 Slice 2 并行）
1. 在 runtime 层实现 `Runtime` facade，内部复用现有 `createRuntimeClient` 与 transport。
2. 实现连接状态机：
`idle -> connecting -> ready -> closing -> closed`。
3. 定义 auto 连接行为：
首次请求 `ensureConnected`；
断线触发退避重连；
请求等待超时失败。
4. 实现 authContext 解析：
调用前合并 `per-call input > authContext.subjectUserId > authContext.getSubjectUserId()`；
缺失时抛 `AUTH_CONTEXT_MISSING`。
5. 保留 raw 能力与 method-id escape hatch。
6. 兼容映射：
当前 `runtime.ai.*` 扁平方法映射到 `runtime.ai` 与 `runtime.media` 新分层。

### Slice 2：Realm 实例化生成链路落地（与 Slice 1 并行）
1. 改造 `generate-realm-sdk.mjs`：
输入仍是 `api.yaml`；
输出改为 typed schema + operation metadata + service registry builder；
客户端基于 openapi-fetch 实例化。
2. 移除所有对全局 `OpenAPI` 的写入依赖。
3. 实现 `new Realm(options)` 私有 client 注入：
token/header/provider 全部实例级。
4. 生成 `realm.services` 全量能力透传；
实现稳定 facade 到 services 的一跳映射。
5. 保留命名规范化（TwoFactor 等）与公开命名门禁。

### Slice 3：AI Provider 与 Mod 同批迁移
1. `createNimiAiProvider` 改签名为接收 `Runtime` class（不再接旧 `RuntimeClient`）。
2. 完整回归 text/image/video/tts/stt/embedding 与 route/fallback 语义。
3. Mod 子路径改为显式注入 runtime/realm context；
移除对全局 runtime hook 的硬依赖路径。
4. desktop/web/nimi-mods smoke 测试覆盖新注入路径。

### Slice 4：Scope、错误模型、清理收口
1. 将当前 scope 内存状态机包装为 `runtime.scope` 异步 facade；
保持 `resolvePublishedCatalogVersion` 与 appAuth 绑定校验语义。
2. Realm 错误完整映射：
HTTP 状态 + body/header reasonCode + 网络错误 -> `NimiError`。
3. 删除 legacy 入口：
`createNimiClient`、全局 OpenAPI 配置写入、旧文档示例。
4. 完成 README/SSOT 同步与迁移指南（无兼容承诺，仅新接口）。

## 连接与重连语义（固定默认值）
1. `connection.mode` 默认 `auto`。
2. 重连退避默认：`base=200ms`, `factor=2`, `maxInterval=3000ms`。
3. 请求等待默认：`waitForReadyTimeoutMs=10000`，超时抛 `RUNTIME_UNAVAILABLE`。
4. 流式请求：连接断开后当前流结束并报错，不隐式续流；调用方显式重订阅。
5. `manual` 模式：未 `connect` 直接调用时报 `RUNTIME_UNAVAILABLE`（无隐式建连）。

## Realm 错误映射规则（固定）
1. 优先提取服务端 `reasonCode/actionHint/traceId`（body 或 header）。
2. HTTP 映射默认：
`401/403 -> AUTH_DENIED`；
`404 -> REALM_NOT_FOUND`；
`409 -> REALM_CONFLICT`；
`429 -> REALM_RATE_LIMITED`；
`5xx -> REALM_UNAVAILABLE`；
`400/422 -> CONFIG_INVALID`（若无更具体 reasonCode）。
3. 网络类错误（DNS/TLS/timeout/abort）：
`REALM_UNAVAILABLE` 或 `OPERATION_ABORTED`（用户取消）。
4. 始终保留 `details.rawReasonCode`（若存在）。

## 测试方案（必须全部通过）
1. Runtime 单元：
状态机、auto/manual、断线重连、等待超时、subject 注入优先级、raw.call。
2. Realm 单元：
实例隔离（双实例不同 base/token 不串扰）、headers provider、raw.request、service registry 构建。
3. 错误映射单元：
HTTP 4xx/5xx、body/header reasonCode、网络失败、abort。
4. 能力覆盖契约：
runtime 方法 parity（当前已公开方法 1:1）；
realm operation 覆盖率；
scope/appAuth 绑定行为。
5. 集成测试：
fake runtime + fake realm 组合；
四种跨域范式（A/B/C/D）全跑通。
对应测试文件：
[sdk/test/integration/runtime-realm-orchestration.test.ts](/Users/snwozy/nimi-realm/nimi/sdk/test/integration/runtime-realm-orchestration.test.ts)。
6. AI Provider 回归：
text/embedding/image/video/tts/stt；
route/fallback；
stream 中断重订阅行为。
对应测试文件：
[sdk/test/ai-provider/provider.test.ts](/Users/snwozy/nimi-realm/nimi/sdk/test/ai-provider/provider.test.ts)。
7. Mod 回归：
`@nimiplatform/sdk/mod/*` 子路径 smoke；
desktop mods smoke；
nimi-mods 典型调用 smoke。
8. 门禁脚本：
新增 no-global-openapi/no-createNimiClient/no-OpenAPI-assignment 必须绿。

## 验收标准
1. SDK 任意两个 Realm 实例可并行使用且配置不串扰。
2. Runtime/Realm 双客户端可独立接入，也可显式跨域编排。
3. runtime 现有公开能力无回退；realm 公开能力无回退。
4. AI Provider 与 Mod 子系统在 vNext 下可用且无全局依赖。
5. 所有文档示例仅使用 `new Runtime()` / `new Realm()`。
6. 所有新增 CI 门禁通过，且不存在 legacy 主入口残留。

## 默认假设（若未另行说明）
1. OpenAPI spec 具备稳定 `operationId` 与可分组 tag。
2. 运行环境 Node 24+，原生 `fetch` 可用。
3. 不考虑向后兼容旧 API 入口，允许一次性 breaking。
4. Runtime proto 不做破坏性变化；vNext 主要是 SDK facade 与连接/错误语义重构。
5. 若个别 realm operation 缺少稳定分组，先通过 `realm.services.misc` 暴露，不阻塞主线发布。
