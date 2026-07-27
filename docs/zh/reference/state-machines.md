# 状态机

Nimi 各栈中所有命名状态机的参考。归属契约附在每节末尾，细节在那些契约里。

## Runtime · Daemon Health

| 状态 | 含义 |
| --- | --- |
| `STARTING` | Daemon 初始化中 |
| `READY` | Daemon 提供服务 |
| `DEGRADED` | Daemon 提供服务但能力降级 |
| `STOPPING` | Daemon 排空中；流式干净取消 |

归属：`runtime/kernel/daemon-lifecycle.md`（`K-DAEMON-*`）。

## Runtime · ScenarioJob

| 状态 | 终态？ |
| --- | --- |
| `SUBMITTED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `TIMEOUT` | 是 |
| `CANCELED` | 是 |

归属：`runtime/kernel/scenario-job-lifecycle.md`（`K-JOB-*`）。

## Runtime · Workflow

| 状态 | 终态？ |
| --- | --- |
| `ACCEPTED` | 否 |
| `QUEUED` | 否 |
| `RUNNING` | 否 |
| `COMPLETED` | 是（成功） |
| `FAILED` | 是 |
| `CANCELED` | 是 |
| `SKIPPED` | 是 |

工作流事件流：`STARTED`、`NODE_STARTED`、`NODE_PROGRESS`、`NODE_COMPLETED`、`NODE_SKIPPED`、`COMPLETED`、`FAILED`、`CANCELED`，外加 external-async 变体。

归属：`runtime/kernel/workflow-contract.md`（`K-WF-*`）。

## Runtime · Provider Async Task

| 状态 | 终态？ |
| --- | --- |
| `queued` | 否 |
| `running` | 否 |
| `succeeded` | 是 |
| `failed` | 是 |
| `expired` | 是（等价于超时） |

provider 异步状态用 lower_snake；ScenarioJob 用 UPPER_SNAKE。映射规则（`K-MMPROV-027`）：`succeeded → COMPLETED`、`expired → TIMEOUT`、`failed → FAILED`。

归属：`runtime/kernel/multimodal-provider-contract.md`（`K-MMPROV-*`）。

## Runtime · Hook Lifecycle

| 状态 | 终态？ |
| --- | --- |
| `pending` | 否 |
| `running` | 否 |
| `completed` | 是 |
| `failed` | 是 |
| `canceled` | 是 |
| `rescheduled` | 否（转回 `pending`） |
| `rejected` | 是 |

归属：`runtime/kernel/agent-hook-intent-contract.md`（`K-AGCORE-*`）。

## Runtime · Memory Replication

| 状态 | 终态？ |
| --- | --- |
| `pending` | 否 |
| `synced` | 是 |
| `conflict` | 是（无法服务） |
| `invalidated` | 是（Realm 治理判失效） |

归属：`runtime/kernel/runtime-memory-service-contract.md`（`K-MEM-*`），表 `runtime-memory-replication-outcome.yaml`。

## Runtime · Delegated Provider

| 状态 | 终态？ |
| --- | --- |
| `REGISTERED` | 否 |
| `DISCOVERING` | 否 |
| `READY` | 否 |
| `DEGRADED` | 否 |
| `DISABLED` | 否 |
| `QUARANTINED` | 否 |
| `REMOVED` | 是 |

归属：`runtime/kernel/delegated-capability-gateway-contract.md`（`K-DELEG-*`）。

## Runtime · Delegated Session

| 状态 | 终态？ |
| --- | --- |
| `OPEN` | 否 |
| `PAUSED_FOR_APPROVAL` | 否 |
| `CLOSING` | 否 |
| `CLOSED` | 是 |
| `FAILED` | 是 |

归属：`runtime/kernel/delegated-capability-gateway-contract.md`（`K-DELEG-*`）。

## Runtime · World Evolution Engine 阶段

| 阶段 | 顺序 |
| --- | --- |
| `INGRESS` | 1 |
| `NORMALIZE` | 2 |
| `SCHEDULE` | 3 |
| `DISPATCH` | 4 |
| `TRANSITION` | 5 |
| `EFFECT` | 6 |
| `COMMIT_REQUEST` | 7 |
| `CHECKPOINT` | 8 |
| `TERMINAL` | 9 |

归属：`runtime/kernel/world-evolution-engine-contract.md`（`K-WEV-*`）。

## Realm · App-World Binding

| 状态 | 含义 |
| --- | --- |
| `(new)` | 世界存在；未绑定 App |
| `active` | extension-app 已绑定并写入 |
| `suspended` | 绑定挂起 |
| `revoked` | 绑定移除 |

一个世界至多一个活跃 extension-app 绑定。重新绑定必须先显式吊销。

归属：`realm/kernel/binding-contract.md`（`R-BIND-*`）。

## Avatar · 组合状态

| 状态 | 含义 |
| --- | --- |
| `loading` | 初始加载 |
| `ready` | 形体组合完成并渲染中 |
| `degraded:*` | 降级，带子状态（如 `degraded:asset_missing`） |
| `relaunch-pending` | 等待重启 |

归属：`avatar/kernel/index.md`。

## 跨域状态机命名

ScenarioJob 与 Workflow 用 UPPER_SNAKE proto 枚举；provider 异步任务用 lower_snake，贴近 provider 语义。大小写差异是有意的设计选择。

## 来源依据

- [`docs/spec/runtime-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/runtime-domain-index.md)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
