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
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `TIMEOUT` | 是 |
| `CANCELED` | 是 |

## Runtime · Provider 异步任务

| 状态 | 终态？ |
| --- | --- |
| `queued` | 否 |
| `running` | 否 |
| `succeeded` | 是 |
| `failed` | 是 |
| `expired` | 是（等价于超时） |

Provider 异步状态使用 lower snake case；ScenarioJob 使用 upper
snake case。Provider 边界把终态结果映射到对应 ScenarioJob 结果。

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
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
