# 共享类型

`@nimiplatform/sdk/types` 装着每个其他 SDK 子路径都用到的共享公开类型。它是小且稳定的构件层；SDK 里跨子路径的东西不会自己再发明 `types` 已经 export 的类型。

## 这里有什么

Types 子路径 export 消费方需要的、跨切的符号，让消费方谈论 Nimi 而不必 import 私有内部。

| 符号 | 用途 |
| --- | --- |
| `NimiError` | SDK 调用方的类型化错误表面 |
| `ScopeName` | 类型化 scope 标识 |
| `ExternalPrincipalId` | 类型化外部 principal 标识 |
| Runtime ids | `WorldId`、`AgentId`、`ConversationId` 等 |
| Workflow ids | `WorkflowId`、`JobId`、`NodeId` |
| 流式基础协议 | 四种流式模式的类型化形状 |
| 多模态基础协议 | `ArtifactId`、规范化 artifact 字段类型 |

具体集合在 SDK kernel surface 合同里准入；新类型需要 kernel 准入。

## 为什么集中类型重要

没有共享类型，每个子路径就会各自再声明自己的 `AgentId`。来自两个子路径的两个 `AgentId` 名义上兼容，但结构上会漂移。一个类型化系统会**意外**变成弱类型。

集中在 `sdk/types` 让每个子路径上的同名类型保持同一个。把 `AgentId` 从 `sdk/runtime` 传到 `sdk/world` 的 App 传的是**同一个类型**，不是巧合形状一样的双胞胎。

## 边界规则

| 规则 | 为什么 |
| --- | --- |
| 别的子路径不再声明 `types` 里的类型 | 防漂移 |
| `types` 不 import 别的子路径 | 留在依赖图最底层 |
| `types` 不依赖 transport（`sdk/runtime`）或读视图（`sdk/realm`） | 让类型可移植 |
| 新类型需要 kernel 准入 | 跟其他表面一样的准入纪律 |

## 阅读场景：跨子路径传 ID

App 经 `sdk/realm` 读一个 Agent id，再用它去发起 runtime 调用。

1. **读。** `realm.agents.get(id)` 返回的 `Agent` 的 `agent.id` 类型是 `sdk/types` 的 `AgentId`。
2. **传。** App 调 `runtime.agent.startConversation(id)`。
3. **类型兼容。** 两个子路径共享 `sdk/types` 的 `AgentId` 类型。编译器接受这次调用。
4. **没有静默 coerce。** 如果同名类型在两个子路径里各声明一次，编译器要么拒绝、要么静默 coerce。集中类型让两种都不会发生。

App 不必在两个近似类型之间转换。共享类型层是结构上的修复。

## 阅读场景：类型化错误抵达 App 代码

某次 runtime 调用以合同失败结束。

1. **Runtime 发类型化错误。** 经 SDK 错误合同，错误变成带 reason code 的 `NimiError`。
2. **App import `NimiError`。** 自 `sdk/types`。
3. **类型窄化。** App 按 reason code 模式匹配决定 UX 行为。

```ts
import { NimiError } from '@nimiplatform/sdk/types';

try {
  await runtime.workflow.run(...);
} catch (err) {
  if (err instanceof NimiError) {
    // 类型化 reason code
    if (err.reasonCode === 'AUTH_TOKEN_EXPIRED') { ... }
    if (err.reasonCode === 'AUTH_UNSUPPORTED_PROOF_TYPE') { ... }
  }
}
```

错误是类型化的，因为它来自 `sdk/types`，不是 App 猜的。准入的精确 reason-code 列表在 SDK kernel 里。

## 阅读场景：库作者加一个 helper

库作者想写一个接受任意 Nimi 标识的 helper。

1. **从 `sdk/types` import。** 他们依赖 `@nimiplatform/sdk/types`，不依赖 `@nimiplatform/sdk/runtime` 或 `@nimiplatform/sdk/realm`。
2. **Helper 接受 `AgentId | WorldId | ConversationId`。** 来自 `sdk/types` 的类型化 union。
3. **库编译。** 无 transport 依赖；无 runtime 拉取；可移植。

依赖 `sdk/runtime` 拿类型信息的库会把整个 transport 层拖给消费方。从 `sdk/types` 拉保持依赖图细瘦。

## `types` 里**没有**什么

| 排除项 | 为什么 |
| --- | --- |
| 方法函数 | 它们住在 `sdk/runtime`、`sdk/realm` 等 |
| Transport 细节（`connectorId`、gRPC 元数据） | 分层，不在 `types` |
| Provider 名字 | 目录数据，不是类型系统 |
| 世界内容（规则、Agent 等） | 内容，不是类型 |

## 来源

- [`.nimi/spec/sdk/types.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/types.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-surfaces.yaml)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)
- [`.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml)
