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

## Desktop · Mod Lifecycle

| 状态 | 含义 |
| --- | --- |
| `admitted` | mod 已准入系统 |
| `installed` | mod 已本地安装 |
| `active` | mod 已激活，可达 |
| `suspended` | mod 暂停 |
| `removed` | mod 已卸载 |

归属：`desktop/kernel/mod-governance-contract.md`，表 `desktop/kernel/tables/mod-lifecycle-states.yaml`。

## Nimi Coding · Topic State

| 状态 | 含义 |
| --- | --- |
| `proposal` | 准备阶段，未启动 |
| `ongoing` | 活跃执行 |
| `pending` | 暂停；等待证据或外部触发 |
| `closed` | 不再是活跃工作流 |

生命周期跃迁：`proposal_to_ongoing`、`ongoing_to_pending`、`pending_to_ongoing`、`ongoing_to_closed`、`pending_to_closed`、`proposal_to_closed`、`closed_to_ongoing`（显式重开）。

归属：`.nimi/contracts/topic.schema.yaml`、`.nimi/methodology/topic-lifecycle.yaml`、`.nimi/methodology/topic-lifecycle-report.yaml`。

## Nimi Coding · Wave State

| 状态 | 终态？ |
| --- | --- |
| `candidate` | 否 |
| `preflight_draft` | 否 |
| `preflight_admitted` | 否 |
| `implementation_admitted` | 否 |
| `implementation_active` | 否 |
| `needs_revision` | 否（退回修订） |
| `overflowed` | 否（需要显式续延或修订） |
| `continuation_packet_open` | 否 |
| `closed` | 是 |
| `retired` | 是 |
| `superseded` | 是 |

归属：`.nimi/contracts/wave.schema.yaml`。

## Nimi Coding · Packet State

| 状态 | 终态？ |
| --- | --- |
| `draft` | 否 |
| `preflight` | 否 |
| `candidate` | 否 |
| `admitted` | 否 |
| `dispatched` | 否 |
| `closed` | 是 |
| `superseded` | 是 |

冻结只允许从 `draft` / `preflight` / `candidate` 进入。

归属：`.nimi/contracts/packet.schema.yaml`。

## Nimi Coding · True-Close 状态

| 状态 | 含义 |
| --- | --- |
| `not_started` | 真闭合尚未尝试 |
| `pending` | 真闭合进行中 |
| `true_closed` | 真闭合通过 |
| `revoked` | 通过过的真闭合后被独立审计撤销 |
| `superseded` | 真闭合被后续准入取代 |

归属：`.nimi/contracts/topic.schema.yaml`、`.nimi/contracts/true-close.schema.yaml`。

## Nimi Coding · Result 判定

| 判定 | 含义 |
| --- | --- |
| `PASS` | 接受工作 |
| `NEEDS_REVISION` | 退回修订 |
| `FAIL` | 拒绝工作 |
| `OVERFLOW` | 工作超出 packet 边界；非 PASS、非 FAIL |

归属：`.nimi/contracts/result.schema.yaml`。

## 跨域状态机命名

ScenarioJob 与 Workflow 用 UPPER_SNAKE proto 枚举；provider 异步任务用 lower_snake，贴近 provider 语义；mod lifecycle 用小写产品语。大小写差异是有意的设计选择。

## 来源依据

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/daemon-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/daemon-lifecycle.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/methodology/topic-lifecycle.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
