# 传输通道与错误处理

SDK 传输通道与错误处理机制规范了 SDK 如何通过受支持的传输通道（如桌面 IPC、gRPC）与 Runtime 进行通信，以及底层的运行时错误如何被准确转译为可预期的强类型 SDK 错误，帮助应用程序实现健壮的容错。

## 传输通道管理

| 核心关注点 | 规范定义与约定 |
| --- | --- |
| 传输层绑定 | `.nimi/spec/sdks/client-core.authority.yaml` |
| 连接生命周期 | 由各类受支持传输通道独立维护（如状态机与保活心跳） |
| 重连策略 | 仅限传输层网络闪断自动恢复（不负责兜底业务契约级错误） |

传输层负责可靠的字节流通信；它只保障数据通道的连通性，而绝不负责在底层“静默修补”契约级业务错误。

## 错误映射体系

| 核心关注点 | 规范定义与约定 |
| --- | --- |
| Runtime 到 SDK 的错误映射 | `.nimi/spec/sdks/client-core.authority.yaml` |
| 原因码 (Reason Code) 透传 | 强类型结构化透传；严禁静默丢弃任何错误元数据 |
| 解码失败 / Content-Type / Schema 违规 | 映射为强类型校验错误；严禁盲目重试 |
| 认证失效 / 传输物理断开 | 映射为强类型连接错误；由传输策略决定是否重连重试 |

> [!IMPORTANT]
> **自动重试与凭据刷新仅是传输层与鉴权层的恢复机制**。它们无法修复数据解码失败、Content-Type 不匹配、Schema 校验不通过或业务契约违规。一个格式非法的响应，绝不会因为重复重试而变成合法响应。

## 典型场景：服务返回不符合 Schema 的响应

Runtime 接口返回的数据未能通过 SDK 的 Schema 结构校验：

1. **类型化转译**：SDK 将校验异常封装为携带明确 Schema 错误原因码的标准 SDK 异常。
2. **禁止静默重试**：传输重试仅用于物理网络波动，此类语义错误严禁发起静默重发。
3. **应用层容错处理**：应用捕获标准异常并向用户展示清晰友好的错误说明，而不是伪造调用成功。

## 典型场景：传输连接意外断开

Runtime 后台服务进入终止状态或正在重启，SDK 传输信道断开：

1. **状态感知**：SDK 依据协议事件（如 `runtime.disconnected` 或底层 gRPC 状态）捕获连接中断。
2. **触发传输重连**：按照预设的传输重连退避策略尝试恢复连接。
3. **抛出传输错误**：SDK 抛出强类型的连接异常，由上层应用决定是否在连接恢复后重试业务请求。
4. **忠实反映状态**：断连期间严禁伪造空数据或伪造执行成功。

## 架构边界与设计约束

- **网络重试不跨层**：自动重试仅用于操作策略允许重放的暂时性传输失败；外部结果未确认时先查原调用状态，绝不可用于掩盖 Schema 校验失败、数据解码异常或业务契约违规。
- **完整保留错误上下文**：错误转译过程中必须完整保留结构化原因码 (Reason Code) 与诊断元数据，禁止静默吞咽。
- **鉴权恢复边界明确**：Token 刷新仅用于恢复鉴权会话，绝不能滥用于规避或修复数据校验异常。
- **真实透传异常**：底层异常必须向调用方如实传递，严禁合成虚假数据或假定操作成功。

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
