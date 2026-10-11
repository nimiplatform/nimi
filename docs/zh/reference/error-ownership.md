# 错误模型与分层归属（Error Ownership）

在 Nimi 架构中，系统通过标准化的错误码前缀与分层映射机制，清晰标识错误的产生来源、责任主体与推荐处理方案。

## 各层级错误码前缀对照

| 架构层级 | 归属契约规范 | 规则前缀 | 核心职责与错误范畴 |
| --- | --- | --- | --- |
| **平台核心协议** | `.nimi/spec/platform/core-protocol.authority.yaml` | `P-PROTO-*` | 跨世界基础协议错误、世界准入拦截、时空连续性违规 |
| **本地运行时（Runtime）** | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-ERR-*` | 推理超时、硬件驱动不可用、显存溢出、凭据失效 |
| **Runtime 流式通道** | `.nimi/spec/runtime/rpc-foundations.authority.yaml` | `K-STREAM-*` | 增量分片解析错误、背压溢出、流提前中止 |
| **SDK 客户端** | `.nimi/spec/sdks/client-core.authority.yaml` | `S-ERROR-*` | 参数格式校验失败、客户端网络断开、本地状态不一致 |
| **桌面端前端（Desktop）** | `.nimi/spec/desktop/shell-ui.authority.yaml` | `rule.nimi.desktop.shell-ui.*` | UI 错误边界捕获、用户交互引导、视图渲染异常 |

## 错误分类与可恢复性判定

| 错误分类 | 典型表现 | 推荐处理策略 |
| --- | --- | --- |
| **瞬时传输错误** | 偶发网络超时、连接闪断、HTTP 502/503 | 传输重试严格遵循操作幂等契约：安全读或幂等调用可执行指数退避重试；外部副作用未确认的操作须先查询原任务/调用状态，禁止盲目重新提交 |
| **凭据过期** | Token 过期、会话需要刷新 | Runtime 在后台静默刷新凭据；重新发起未完成请求须遵循操作幂等契约与未确认副作用边界 |
| **契约与参数错误** | 缺少必填字段、MIME 类型不符、Schema 校验未通过 | 系统直接返回类型化错误，指导开发者在代码中修正入参 |
| **流式中断错误** | 模型生成中途中断、用户主动点击停止 | 前端优雅清理残缺未提交内容，并保留已落地的完整历史消息 |

## 端到端错误传播与呈现示例

当底层云端模型服务发生临时故障时，系统经历清晰的错误传播与映射链路：

1. **Provider 返回异常**：远程大模型服务返回 HTTP 500 内部错误；
2. **Runtime 归类与捕获**：本地执行驱动将其捕获，归类为规范 `K-ERR-*` 规则约束下的标准原因码 `AI_PROVIDER_INTERNAL`，并记录现场审计日志与 Trace ID；
3. **SDK 结构化封装**：SDK 门面将其包装为结构化 `NimiError` 对象（包含 `reasonCode: 'AI_PROVIDER_INTERNAL'` 与操作建议 `actionHint: 'retry_with_backoff_or_switch_provider'`）；
4. **桌面端友好呈现**：UI 界面在消息气泡旁展示准确的提示信息（例如：“模型服务商发生内部错误，请稍后重试或切换模型”），并提供明确的操作选项。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
