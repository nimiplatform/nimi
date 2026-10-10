# 共享类型与错误

`@nimiplatform/sdk/types` 导出共享 JSON、请求元数据、错误、原因码和重试工具。按实际调用的公共操作选择类型，这个模块不是所有领域标识的统一集合。

## 当前导出

| 导出 | 用途 |
| --- | --- |
| `JsonPrimitive`、`JsonValue`、`JsonObject` | 强类型 JSON 值 |
| `NimiError`、`NimiErrorSource` | 包含原因、行动提示、追踪和重试信息的错误类型 |
| `isNimiError`、`asNimiError`、`createNimiError` | 判断、规范化或构造 SDK 错误 |
| `ReasonCode`、`ReasonCodeValue` | 共享原因常量及其类型 |
| `CoreMetadata`、`CoreUnaryRequest`、`CoreStreamRequest` | SDK 底层请求描述，不是另一条 App 访问路径 |
| `RetryOptions`、`RetryEvent`、`RetryReasonKind` | 重试工具的配置与观察信息 |
| `createNimiClientId`、`createNimiUlid` | 为已准入的调用者用途生成标识 |

Nimi App 从 `@nimiplatform/sdk` 导入 `NimiLocalAppClient`，通过生成的 Host 绑定取得客户端。能力请求和结果类型从所属的公共 SDK 入口导入。仅导入类型不要求执行该模块的传输代码。

## 保留标识的归属

不少 API 标识以字符串表示，不能假设编译器会拒绝所有跨领域误用。保留标识与签发它的结果、操作之间的关系。Character 引用不是 LocalAgent 操作选择器，artifact ID 也不授予访问权。

正式 App 的 Agent 操作使用已授权引用列表返回的会话级 `agentHandle`，不要自行生成或强转原始 LocalAgent ID。Runtime 仍检查当前账号、App、会话、目标与操作。

## 判断强类型错误

`NimiError` 是 TypeScript 类型。用 `isNimiError` 收窄捕获到的未知值：

```ts
import { isNimiError, type NimiError } from '@nimiplatform/sdk/types';

export function nimiFailureDetails(error: unknown): Pick<
  NimiError, 'message' | 'reasonCode' | 'actionHint' | 'retryable'
> | null {
  if (!isNimiError(error)) return null;
  return {
    message: error.message,
    reasonCode: error.reasonCode,
    actionHint: error.actionHint,
    retryable: error.retryable,
  };
}
```

同一函数在 [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts) 中参与编译检查。返回 `null` 表示该值不符合 SDK 错误形状，应保留原始失败并交给 App 的正常错误处理，不表示操作成功。

根据实际原因和行动提示选择下一步。`retryable` 不意味着外部结果不确定时可以重放业务操作。Job 应保留原身份，遵循[观察与恢复](/zh/runtime/streaming)。

## Source Basis

- [`sdks/typescript/types/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/index.ts)
- [`sdks/typescript/types/errors.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/errors.ts)
- [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
