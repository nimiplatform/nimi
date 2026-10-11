# 核心系统状态机模型（State Machines）

Runtime 健康状态、异步任务、应用与世界绑定各有独立的生命周期；Avatar 是否可用则取决于当前 App 会话和呈现条件。

## 1. Runtime 守护进程生命周期（Daemon Health）

| 状态 | 状态含义 | 允许的操作 |
| --- | --- | --- |
| `STARTING` | 守护进程正在启动，初始化各模块 | 加载本地配置与模型目录 |
| `READY` | 守护进程正在提供 RPC 服务 | 正常接收并处理 RPC 调用；具体推理能力的就绪取决于本地模型与环境要求 |
| `DEGRADED` | 核心守护进程正常运作，但特定子系统检查或诊断报告了降级状态 | 记录排查日志，仅提供受支持的非降级操作 |
| `STOPPING` | 正在优雅停机，排空处理中的流式请求 | 拒绝新请求，安全落盘当前写入流 |

## 2. 异步计算任务状态机（ScenarioJob）

耗时较长的多模态生成任务遵循标准的异步作业状态流转：

| 状态代码 | 是否为终态 | 业务说明 |
| --- | --- | --- |
| `SUBMITTED` | 否 | 任务已接收并完成参数校验，等待排队 |
| `QUEUED` | 否 | 任务已进入工作队列，等待硬件算力资源 |
| `RUNNING` | 否 | 模型正在执行推理计算或流式生成 |
| `COMPLETED` | **是（成功终态）** | 任务执行圆满完成，产物已成功生成并就绪 |
| `FAILED` | **是（异常终态）** | 执行过程中发生错误，包含具体错误诊断码 |
| `TIMEOUT` | **是（异常终态）** | 任务达到服务商过期时间或满足确定的超时判定条件 |
| `CANCELED` | **是（终态）** | 用户或调用方请求停止；需检查 `stopOutcome`（如 confirmed 或 unconfirmed）确认底层计算是否实际中止 |

作业可通过可选的 `submissionOutcome` 反映分发状态。对于 `CANCELED` 取消作业，会通过 `stopOutcome` 说明底层计算是否已确认中止（如 `confirmed`）或尚未确认（`stopOutcome: 'unconfirmed'`）。其他终态不会携带 `stopOutcome`；超时作业遵循既有的作业观测与恢复合同处理。

## 3. 应用与世界绑定状态（App-World Binding）

| 绑定状态 | 状态含义 |
| --- | --- |
| `(new)` | 世界已创建，当前尚无绑定的活跃 Extension App |
| `active` | 某个 Extension App 已获授权接入并开始写入状态 |
| `suspended` | 绑定临时挂起，暂不允许新状态提交 |
| `revoked` | 绑定已被正式撤销，该世界开放供新应用绑定 |

## 4. Avatar 就绪条件

Avatar 根据当前 App 会话、启动上下文、驱动和模型条件选择窗口内容。开放产品交互还需要后端呈现就绪。

| 当前条件 | 界面表现 | 产品交互 |
| --- | --- | --- |
| 窗口或 Runtime 尚未准备完成 | 加载界面 | 不可用 |
| 会话、启动参数、驱动或模型条件不满足 | 诊断界面，显示具体原因 | 不可用 |
| 已通过验证的开发预览（`fixture_not_verified`） | 显示模型，并明确标注为开发预览 | 不可用；预览画面不代表 Runtime 绑定有效 |
| App 会话来自 Runtime，所需条件有效，后端呈现已就绪 | 显示产品模型视图；需要时显示 Companion 面板 | 可用 |

当前 App 的诊断值和启动字段要求见 [Avatar 实例生命周期](/zh/avatar/instance-lifecycle)。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
