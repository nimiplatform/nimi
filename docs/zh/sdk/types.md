# 共享类型

`@nimiplatform/sdk/types` 承载所有其他 SDK 子路径都用到的共享公开类型。它是小而稳的构建块层；SDK 中跨子路径的内容，凡是 `types` 已经导出的，就不再自己创建一套。

## 这里放什么

types 子路径导出使用方在不导入私有内部的前提下谈论 Nimi 所需要的跨切面符号。

| 符号 | 用途 |
| --- | --- |
| `NimiError` | SDK 调用方面对的强类型错误 surface |
| `ScopeName` | 强类型作用域标识 |
| `ExternalPrincipalId` | 强类型外部 Principal 标识 |
| Runtime ids | `WorldId`、`AgentId`、`ConversationId` 等 |
| Workflow ids | `WorkflowId`、`JobId`、`NodeId` |
| 流式基础协议 | 四种流式模式对应的强类型形状 |
| 多模态基础协议 | `ArtifactId`、规范产物字段类型 |

确切清单由 SDK 内核 surface 契约准入；新增类型需要内核准入。

## 集中类型为什么重要

没有共享类型，每个子路径都会自行声明一个 `AgentId`。两个子路径的两个 `AgentId` 名义上可能兼容，结构上却会漂移。强类型系统会因此意外退化成弱类型。

`@nimiplatform/sdk/types` 集中类型，能在所有公开 surface 之间保留同一个名义类型。App 把从 `@nimiplatform/sdk/runtime` 拿到的 `AgentId` 传给 Realm 或 root-client workflow，传的是同一个类型，而不是凑巧形状一致的双胞胎。

## 边界规则

| 规则 | 原因 |
| --- | --- |
| 其他子路径不重声明 `types` 中的类型 | 防漂移 |
| `types` 不从其他子路径导入 | 处在依赖图的最底层 |
| `types` 不依赖传输（`@nimiplatform/sdk/runtime`）或适配（`@nimiplatform/sdk/realm`） | 保持类型可移植 |
| 新增类型需要内核准入 | 与其他 surface 同样的准入纪律 |

## 场景：在子路径之间传递 ID

App 通过 `@nimiplatform/sdk/realm` 读取一个 Agent id，再用它发起 runtime 调用。

1. **读取。** `realm.agents.get(id)` 返回的 `Agent` 上 `agent.id` 类型是来自 `@nimiplatform/sdk/types` 的 `AgentId`。
2. **传递。** App 调用 `runtime.agent.startConversation(id)`。
3. **类型相容。** 两个子路径共享 `@nimiplatform/sdk/types` 的 `AgentId`，编译器接受这次调用。
4. **无静默强转。** 如果类型在不同子路径里被声明了两次，编译器要么拒绝，要么静默强转。集中类型让两件事都不会发生。

App 不必在两个近似类型之间手动转换。共享类型层就是这种问题的结构性修复。

## 场景：强类型错误传到 App 代码

一次 runtime 调用以契约失败告终。

1. **Runtime 发出强类型错误。** 通过 SDK 错误转换，错误成为带 reason code 的 `NimiError`。
2. **App 导入 `NimiError`。** 来自 `@nimiplatform/sdk/types`。
3. **类型收窄。** App 在 reason code 上做模式匹配以决定 UX 行为。

```ts
import { NimiError } from '@nimiplatform/sdk/types';

try {
  await runtime.workflow.run(...);
} catch (err) {
  if (err instanceof NimiError) {
    // typed reason code
    if (err.reasonCode === 'AUTH_TOKEN_EXPIRED') { ... }
    if (err.reasonCode === 'AUTH_UNSUPPORTED_PROOF_TYPE') { ... }
  }
}
```

错误是强类型的，因为它来自 `@nimiplatform/sdk/types`，不是因为 App 自己猜出来的。具体的 reason code 清单由 SDK 内核准入。

## 场景：库作者新增 helper

一位库作者想写一个接受任意 Nimi 标识的 helper。

1. **从 `@nimiplatform/sdk/types` 导入。** 依赖 `@nimiplatform/sdk/types`，不依赖 `@nimiplatform/sdk/runtime` 或 `@nimiplatform/sdk/realm`。
2. **Helper 接受 `AgentId | WorldId | ConversationId`。** 这是来自 `@nimiplatform/sdk/types` 的强类型联合。
3. **库可编译。** 没有传输依赖；不会引入 runtime；可移植。

如果一个库为了类型信息去依赖 `@nimiplatform/sdk/runtime`，就会把整个传输层拖进它的使用者。从 `@nimiplatform/sdk/types` 引入，能让依赖图保持轻薄。

## `types` 里没有的内容

| 不收录 | 原因 |
| --- | --- |
| 方法函数 | 那些在 `@nimiplatform/sdk/runtime`、`@nimiplatform/sdk/realm` 等子路径 |
| 传输细节（`connectorId`、gRPC 元数据） | 分层归属，不在 `types` |
| Provider 名 | 是 catalog 数据，不是类型系统 |
| 世界内容（规则、Agent 等） | 是内容，不是类型 |

## 来源依据

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-target-export-map.yaml)
- [`config/sdks-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-error-codes.yaml)
