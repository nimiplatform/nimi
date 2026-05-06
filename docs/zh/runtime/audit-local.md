# 本地审计

Runtime 写一份本地审计 ledger，覆盖每一次 AI 调用、Model 操作、App 间消息、授权决定。审计是**本地真相** — 它住在你这台机器上。Realm 的云端审计是另一个面，Runtime 可以选择把聚合上报上去。

## 本地审计记录什么

Runtime 记录：

| 事件家族 | 例子 |
| --- | --- |
| AI 调用 | 工作流启动、节点执行、`ScenarioJob` 生命周期、终态 |
| Model 操作 | Provider 路由、本地引擎路由、Model 解析 |
| App 间消息 | 通过 Runtime 的 App-to-App 消息 |
| 授权决定 | Token 校验、scope 校验、能力准入 |
| 委派 lineage | 外部 AI session、firewall 裁定、审批决定、动作 lineage |
| 记忆写入与复制 | 写入准入、复制状态迁移、冲突 / 失效 |
| Hook 生命周期 | 准入、调度、触发、终态 |

每条事件都有结构化字段、principal lineage、跨 Runtime 重启不丢的 trace id。

## 本地优先

审计本地优先是有意姿态。云不是必需品；审计 ledger 不依赖 Realm 在线。

| 关注点 | 为什么本地优先 |
| --- | --- |
| 隐私 | 审计是你自己的；不必上传 |
| 独立性 | 离线状态下 Runtime 审计照样工作 |
| 权威 | 本地审计就是本地真相，不是云端审计的降级副本 |
| 可选聚合 | 配置允许时 Runtime 才把聚合往上送 |

如果用户后来登入 Realm 并选择聚合，Runtime 把聚合往上送。本地审计真相不会被回头改写；聚合是单向向前。

## 审计 Lineage

审计记录带类型化 lineage，让未来读者能重建发生了什么。

| Lineage 元素 | 用途 |
| --- | --- |
| Trace id | 标识一次端到端运行 |
| Principal id | 谁在动作（用户 / Agent / App / 外部 principal） |
| Workflow id | 这条事件属于哪个工作流 |
| Job id | `ScenarioJob` lineage |
| Provider id | 涉及的是哪个 Provider |
| Action lineage | 委派路径下，串起 suggestion → verdict → approval → action |

读者读审计能回答"发生了什么"，不只是"记了什么"。

## 审计统计与健康快照

审计合同准入结构化统计与健康快照。`nimi doctor` 暴露：

| 指标 | 含义 |
| --- | --- |
| 审计写入量 | 单位时间内的记录数 |
| 复制 backlog | 等待云端聚合的待发记录（如启用） |
| 失败率 | 近期失败事件相对总量 |
| 工作流吞吐 | 近期工作流完成率 |

这些指标可观测；订阅审计健康的 App 拿到的是类型化事件流。

## 阅读场景：重建一次失败的工作流

昨天出过事。用户想精确知道发生了什么。

1. **按 trace id 定位。** 用户拿到 trace id（来自聊天错误信息或 App 日志），按 trace id 查审计。
2. **工作流 lineage。** 工作流生命周期被记下：`ACCEPTED → QUEUED → RUNNING → ... → FAILED`，沿途每个 `NODE_STARTED → NODE_PROGRESS → NODE_FAILED`。
3. **Scenario job lineage。** 每个 AI 节点扇出到 `ScenarioJob`；审计写出 job 状态迁移。
4. **Provider lineage。** 路由到的是哪个 Provider；Provider 当时是什么状态；返回的错误码是什么。
5. **流式 lineage。** 让工作流走到 `FAILED` 的那个终止帧被记下。
6. **重建。** 用户拿到一条结构化链：「这次请求 → 这个工作流 → 这个节点 → 这个 Provider → 这个错误 → 这个终态」，不靠猜。

审计是平台对"发生了什么"的回答。自由格式日志给不了这个；类型化审计 lineage 给得了。

## 阅读场景：一条委派审计链

某个外部 AI 做了一个动作。后来用户想看是怎么被授权的。

1. **Session 记录。** 外部 principal session 启动，带 trust tier 与策略快照。
2. **Suggestion 记录。** 类型化的委派请求形状。
3. **Firewall verdict。** Firewall 裁定。
4. **Approval 记录。** 用户审批（如果是 `APPROVAL_REQUIRED`）。
5. **Action 记录。** Runtime 拥有的动作及它自己的 lineage。
6. **Outcome 记录。** 动作的终态。

链是端到端的：审计员沿着这条链能回答"谁提议、谁授权、发生了什么"，没有歧义。

## 阅读场景：用户回看自己的记忆活动

用户想知道 Agent 都记了什么。

1. **记忆写入事件。** 审计写出每一次准入的写入，含 bank 范围与来源。
2. **复制事件。** 每次写入的状态迁移（`pending → synced` 等）。
3. **读取事件。** 后续轮次什么时候读到这条记忆。
4. **冲突 / 失效事件。** 任何调和步骤。

用户能通过审计回答："我的 Agent 记没记 X，后来有没有失效？"

## 可选地聚合到 Realm

Runtime 可以选择把审计聚合往 Realm 送。

| 性质 | 值 |
| --- | --- |
| 默认 | 聚合关闭 |
| 启用方式 | 用户配置 / 宿主产品配置 |
| 方向 | 本地 → Realm；从不 Realm → 本地改写 |
| 粒度 | 聚合与摘要；不是原始记录流 |

本地审计是真相来源。Realm 聚合是它的一种呈现。

## 来源

- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-audit-replay-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/tables/reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/reason-codes.yaml)
