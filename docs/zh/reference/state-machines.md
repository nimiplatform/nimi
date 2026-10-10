# 状态机

本页只列当前核心产品面中的状态机，不把延期的 Workflow、World
Evolution、委派 provider 或 hook 调度模型列作 Runtime 前置。

## Runtime · Daemon Health

| 状态 | 含义 |
| --- | --- |
| `STARTING` | Daemon 初始化中 |
| `READY` | Daemon 提供服务 |
| `DEGRADED` | Daemon 以降级能力提供服务 |
| `STOPPING` | Daemon 排空中；流式请求干净取消 |

## Runtime · ScenarioJob

| 状态 | 终态？ |
| --- | --- |
| `SUBMITTED` | 否 |
| `QUEUED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `TIMEOUT` | 是 |
| `CANCELED` | 是 |

## Runtime · 观察事实

Provider 协议阶段保持私有。公共 Job 提供 `submission_outcome`（`UNSPECIFIED`、`NOT_DISPATCHED`、`UNKNOWN`、`ACCEPTED`、`REJECTED`）与 `stop_outcome`（`UNSPECIFIED`、`NOT_DISPATCHED`、`CONFIRMED`、`UNCONFIRMED`）。历史缺失值保持未知。

观察问题不改变 Job 状态。本地 canceled 不能单独证明外部执行停止。`TIMEOUT` 需要实际的有界 Host 终止或已确认 Provider 任务过期，不能仅凭 Job 已存在多久判断。对原 Job 使用 Get，并保留完整终态结果。

## Realm · App-World Binding

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在，尚无 App 绑定 |
| `active` | Extension App 已绑定并写入 |
| `suspended` | 绑定暂停 |
| `revoked` | 绑定移除 |

这一既有公共分发模型与当前 Windows 产品闭环隔离，不会让 App
或 Desktop 成为 Realm 真相 owner。

## Avatar · 组合状态

| 状态 | 含义 |
| --- | --- |
| `loading` | 初始加载 |
| `ready` | 形体组合完成并渲染中 |
| `degraded:*` | 降级，并带具体原因子状态 |
| `relaunch-pending` | 等待重启 |

## 来源依据

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
