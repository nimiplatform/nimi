# 共享类型与错误处理

`@nimiplatform/sdk/types` 集中导出了跨模块共享的基础 JSON 结构、请求元数据、标准错误模型、结构化原因码 (Reason Code) 以及重试控制工具。

推荐开发者根据具体调用的业务方法按需引入类型；该模块主要提供通用的基础数据类型与错误抽象，各业务领域的特化实体类型请从对应功能子路径导入。

## 核心公开导出速查

| 导出类型 / 工具 | 核心定位与用途 |
| --- | --- |
| `JsonPrimitive`、`JsonValue`、`JsonObject` | 严谨的强类型 JSON 数据表示 |
| `NimiError`、`NimiErrorSource` | 包含错误原因码、操作建议 (Action Hint)、链路追踪与重试标识的标准化错误接口与来源联合类型 |
| `isNimiError`、`asNimiError`、`createNimiError` | 用于运行时收窄、规范化或构造 SDK 错误的工具函数 |
| `ReasonCode`、`ReasonCodeValue` | 平台共享的标准错误原因常量与类型定义 |
| `CoreMetadata`、`CoreUnaryRequest`、`CoreStreamRequest` | 底层请求描述符与客户端通信契约结构 |
| `RetryOptions`、`RetryEvent`、`RetryReasonKind` | 传输层重试机制的策略配置与观测回调 |
| `createNimiClientId`、`createNimiUlid` | 用于生成规范唯一标识符的工具函数 |

在标准 Nimi App 中，从 `@nimiplatform/sdk` 导入 `NimiLocalAppClient` 即可。仅引入类型定义属于编译期语法，不会引入任何额外的运行时传输层开销。

## 严格保持标识符的上下文归属

在系统设计中，许多底层标识符在表现形式上均为字符串（如各种 ID）。开发者需注意保持标识符与其签发上下文的对应关系，避免语义混淆：
- 例如，角色引用 (Character Ref) 不等同于智能体句柄 (Agent Handle)；
- 产物文件 ID (Artifact ID) 本身并不代表调用方拥有该文件的访问权；
- 标准 App 在调用 Agent 能力时，必须使用受权列表返回的会话级 `agentHandle`，切勿手动拼接或强制类型转换原始的本地智能体 ID。底层 Runtime 依然会在执行时严格校验当前账号、App 身份、会话生命周期与目标权限。

## 强类型错误捕获与类型收窄 (Type Narrowing)

`NimiError` 提供了丰富的排错元数据。在 `try...catch` 块中，可以使用 `isNimiError` 守卫函数安全收窄未知捕获值：

```ts
import { isNimiError, type NimiError } from '@nimiplatform/sdk/types';

export function nimiFailureDetails(error: unknown): Pick<
  NimiError, 'message' | 'reasonCode' | 'actionHint' | 'retryable'
> | null {
  // 1. 类型守卫收窄
  if (!isNimiError(error)) return null;

  // 2. 提取标准错误诊断属性
  return {
    message: error.message,
    reasonCode: error.reasonCode,
    actionHint: error.actionHint,
    retryable: error.retryable,
  };
}
```

参考示例代码可参阅 [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts)。若返回 `null`，说明抛出的值不符合 `NimiError` 形状；应保留原始错误对象，按应用常规异常流程处理。

根据返回的 `reasonCode` 与 `actionHint` 引导用户采取下一步操作。需要特别注意的是：`retryable: true` 是操作层面的重试提示，并不意味着在外部业务结果尚未确认时可以盲目重试具有副作用的非幂等写入。涉及异步 Job 的任务，应保留原 Job ID，核实其实际执行结果后再决定是否重新提交。

## Source Basis

- [`sdks/typescript/types/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/index.ts)
- [`sdks/typescript/types/errors.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/types/errors.ts)
- [`examples/sdk/06-errors.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/06-errors.ts)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
