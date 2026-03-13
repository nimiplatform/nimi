# 生产环境检查清单

在发布依赖 Nimi runtime 的应用之前，请参照此清单逐项确认。

## 超时与回退策略

为每个 AI 调用设置显式超时。定义回退行为（缓存响应、优雅降级、用户提示信息），以应对 Provider 不可达或本地 runtime 未运行的情况。

## 错误处理

- 基于 `reasonCode` 分支处理，而非错误消息文本。Reason code 在版本间保持稳定，消息文本则不然。
- 在日志和支持渠道中持久化 `traceId`，以便端到端关联问题。
- 遵守错误响应中返回的 `retryable` 标志。仅在 runtime 表明错误为临时性时才自动重试。

## 令牌生命周期

妥善处理 runtime 和 realm 令牌的刷新与过期。避免硬编码令牌值。使用 SDK 内置的令牌管理机制，监听刷新事件而非轮询。

## 版本兼容性

- SDK 和 runtime 应保持在同一 `major.minor` 发布系列内。版本不匹配可能导致未定义行为。
- 在 CI 中固定 workspace 发布集。
- 部署前运行版本矩阵检查：

```bash
pnpm check:sdk-version-matrix
```

## 健康检查集成

- 在部署环境中监控 `/v1/runtime/health` 端点。
- 在 CI 或启动探针中使用 `nimi doctor --json` 进行结构化环境验证。

## Provider 密钥管理

将 Provider API 密钥保存在 runtime 进程配置中，而非分散到各个应用里。使用 `nimi provider set` 或基于环境变量的凭据文件。这样可以在一处统一轮换密钥，避免密钥泄漏到客户端打包产物中。

## 日志与遥测

- 通过 `traceId` 传播聚合日志，使单个用户请求能够从应用层追踪到 runtime 再到 Provider。
- 在错误报告仪表板中展示 `reasonCode` 和 `actionHint`。这些字段专为程序化分类设计。

## 验证命令

在 CI 中运行以下检查，尽早发现偏差：

```bash
pnpm check:sdk-version-matrix
pnpm check:runtime-bridge-method-drift
pnpm check:scope-catalog-drift
```

## 相关资源

- [兼容性矩阵](../reference/compatibility-matrix.md)
- [错误码参考](../reference/error-codes.md)
- [Runtime 参考文档](../reference/runtime.md)
