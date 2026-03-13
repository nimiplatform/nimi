# 错误码

Nimi 使用稳定的 `reasonCode` 值来返回结构化错误。

```ts
type NimiError = Error & {
  code: string
  reasonCode: string
  actionHint: string
  traceId: string
  retryable: boolean
  source: 'realm' | 'runtime' | 'sdk'
  details?: Record<string, unknown>
}
```

## 开发指南

- 根据 `reasonCode` 进行业务逻辑分支判断，不要依赖非结构化的错误消息文本。
- 在日志和支持渠道中持久化并暴露 `traceId`。
- 遵循 `retryable` 字段制定自动重试策略。

## 源码参考

- Runtime reason code 定义：[`proto/runtime/v1/common.proto`](../../../proto/runtime/v1/common.proto)
- SDK reason-code 工具：[`sdk/src/types`](../../../sdk/src/types)
