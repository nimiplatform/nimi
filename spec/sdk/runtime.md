# Runtime SDK Domain Spec

> Scope: `@nimiplatform/sdk/runtime` 主题导引（构造、连接事件、重试与投影）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/runtime-contract.md`（S-RUNTIME-010, S-RUNTIME-011, S-RUNTIME-012, S-RUNTIME-015, S-RUNTIME-023, S-RUNTIME-028, S-RUNTIME-045, S-RUNTIME-050, S-RUNTIME-066, S-RUNTIME-067, S-RUNTIME-068, S-RUNTIME-069, S-RUNTIME-070, S-RUNTIME-071）
- `kernel/surface-contract.md`（S-SURFACE-002, S-SURFACE-003, S-SURFACE-004）
- `kernel/transport-contract.md`（S-TRANSPORT-001, S-TRANSPORT-002, S-TRANSPORT-005, S-TRANSPORT-007, S-TRANSPORT-008, S-TRANSPORT-009, S-TRANSPORT-010, S-TRANSPORT-011, S-TRANSPORT-012, S-TRANSPORT-013）
- `kernel/error-projection.md`（S-ERROR-001, S-ERROR-006, S-ERROR-009, S-ERROR-012, S-ERROR-014, S-ERROR-015）
- `kernel/boundary-contract.md`（S-BOUNDARY-001, S-BOUNDARY-002）
- `kernel/tables/sdk-runtime-behavioral-checks.yaml`

## 1. 文档定位

本文件是 runtime 子路径导引。公开方法、连接语义与重试基线由 sdk kernel 定义。

## 2. 阅读路径

1. runtime 主合同：`kernel/runtime-contract.md`。
2. 方法投影来源：`kernel/surface-contract.md` + `runtime-method-groups.yaml`。
3. 传输与版本协商：`kernel/transport-contract.md`。
4. 错误投影与重试语义：`kernel/error-projection.md`。

## 3. 与 runtime kernel 的关系

运行时服务语义来自 `spec/runtime/kernel/*`；SDK 负责协议封装与类型投影。

当前 runtime projection 已包含 LocalAI 动态图片工作流所需的本地 surface，并且上层消费面必须遵守以下 kernel 约束：

- `S-RUNTIME-010` / `S-TRANSPORT-001`: Node.js 环境允许 `new Runtime()` 走本地 `node-grpc` 默认值；非 Node 环境缺失 transport 时必须 fail-close。
- `S-RUNTIME-011` / `S-SURFACE-002`: runtime 子路径公开方法集合以 `runtime-method-groups.yaml` 为权威，不能漂移到 legacy runtime surface。
- `S-RUNTIME-011`: `Runtime.generate()` / `Runtime.stream()` 允许作为 first-run convenience surface，但必须复用现有 runtime text projection，并采用 bare local / provider default / provider explicit 的 high-level targeting 语义。
- `S-RUNTIME-011`: `runtime.media.music.iterate()` 允许作为 music iteration 的 first-class convenience surface，但必须继续复用 `MUSIC_GENERATE` + `ScenarioJob` + artifact 主链，不得新增私有 RPC。
- `S-SURFACE-003`: 已移除的 legacy runtime interface naming 不得回流。
- `S-RUNTIME-012`: `connectorId`、业务 body 与 metadata 必须分层传递，不能把 transport 元数据塞回请求体。
- `S-RUNTIME-023`: deferred 服务必须显式暴露“不可用”语义，不冒充 active。
- `S-RUNTIME-067` / `S-RUNTIME-068`: `auth.accessToken` 与 `subjectContext` 分离建模，公开配置仅使用 `subjectContext` 命名。
- `S-TRANSPORT-007` / `S-TRANSPORT-008` / `S-TRANSPORT-009`: 流式终帧、超时与 chunk 边界必须按 runtime 协议透传。
- `S-TRANSPORT-010`: Bearer 注入只允许发生在规定的路由/方法集，anonymous local consume 与只读 local RPC 不得强塞鉴权。
- `S-ERROR-009` / `S-ERROR-012` / `S-ERROR-014`: 非错误终端 reason、Mode D `CANCELLED`、以及 `node-grpc` / `tauri-ipc` 的结构化错误投影必须等价。
- `S-RUNTIME-072`: `runtime.media.music.iterate()` 必须对 iteration 输入做客户端 fail-fast 预校验，但不得替代 runtime 权威校验。

- `LocalArtifact*` RPC 与 companion asset 列表/安装/导入/删除
- 主模型 `engine_config` 字段投影
- runtime image helper `buildLocalImageWorkflowExtensions()`，用于编码 `components` 与 `profile_overrides`
- runtime music helper `buildMusicIterationExtensions()`，仅作为低层 escape hatch；官方主路径是 `runtime.media.music.iterate()`

## 4. 非目标

- 不在本文件定义本地规则体系。
- 不在 domain 文档维护实现态测试清单。
