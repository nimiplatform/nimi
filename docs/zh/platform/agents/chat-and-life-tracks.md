# Chat 与 Life 双轨

每个 Nimi Agent 跑在两条独立的执行轨道上。这不是 UX 特性，而是硬的架构切分。理解平台为什么把它们分开，就是"会回应你的 Agent"和"有自己生活的 Agent"之间的差别。

## 两条轨道

| 轨道 | 由什么驱动 | 拥有者 |
| --- | --- | --- |
| Chat Track | 反应式 — 用户或 App 输入 | Runtime |
| Life Track | 主动式 — Agent 自主 + Runtime hook 调度 | Runtime |

两轨共享 Agent 的状态 — 同一个 Soul、同一个 Memory、同一个 Worldview — 但它们的调度面**永远不**塌成一个。

| 属性 | Chat Track | Life Track |
| --- | --- | --- |
| 触发 | 用户 / App 输入 | Runtime hook 调度 |
| 默认 | 永远在线 | 默认关；opt-in |
| 节奏 | 按输入 | `off` / `low` / `medium` / `high` |
| Token 预算 | 按请求语义 | 默认按日 |
| 输出 | 聊天回应，可流式 | life-turn 输出，可持久 |
| 另一轨忙时 | 仍可用 | 如果 Chat 在传送，Life 暂停（Runtime 已认可） |

Life Track 默认 opt-in 是有原因的：主动式 Agent 不论有没有人在跟它说话都会消耗 token。默认关让 opt-in 是显式的。

## 为什么两轨是硬架构切分

朴素设计会有一个统一的调度面，"用户说话了"和"Agent 决定自己做点什么"都走同一个面。Nimi 故意拆开：

| 关注 | 为什么两轨 |
| --- | --- |
| Token 预算 | 反应式成本是按请求；主动式成本是按日。混在一起两边都看不清。 |
| 聊天可靠性 | 聊天必须永远在线。Life Track 满了不应该挡住 Agent 回应。 |
| 审计 | 聊天输出和 Life 输出有不同的审计类别；混在一起会混淆"被问了"和"自己动了"。 |
| 批准 | 一些 Life Track 动作可能要批准。聊天回应不需要。每轨不同 gate。 |
| Replay | 重放一个自主时刻和重放一个聊天 turn 不一样。记录的流保持分开。 |

混在一起会让每一项分析 — 计费、审计、replay、debug — 都得先反推统一回路刚刚做了什么。拆开就把这种反推内嵌到平台里了。

## 节奏

Life Track 有四种节奏：

| 节奏 | 含义 |
| --- | --- |
| `off` | Life Track 暂停；Agent 只反应 |
| `low` | 偶尔的自主时刻，受日预算约束 |
| `medium` | 更频繁的自主时刻 |
| `high` | 最积极的自主行为；日预算很可能被耗尽 |

默认是 `off`。用户（或宿主产品）选择是否打开 Life，以及在什么节奏。

Life 节奏不是"Agent 多聪明"。它是"Agent 多频繁自己动"。`high` 节奏的 Agent 消耗更多 token；它不会变成另一个 Agent。

## Token 预算

Life Track 默认有日 token 预算。预算耗尽，Life Track 停发新 turn 直到下一日重置。

Chat Track 不共享这个预算。聊天回应不论 Life 预算是什么状态都会发生。

用户（或宿主产品）可以调预算；平台默认有意做得保守。

## 阅读场景：Chat 和 Life 都开着

用户有个 Agent 叫 Yuki。Yuki 的 Life Track 开在 `medium` 节奏。

整天：

- 早上：用户问 Yuki 今天天气。Chat Track 启动，Yuki 回应。聊天回应的 token 预算是按请求。
- 下午：用户不在。Yuki 的 Life Track 被 hook 调度器派出。Yuki 想起记忆里有事 — 用户提过明天有面试。Yuki 发出一个类型化的 `HookIntent`：明天 8 点提醒祝好运。这个 intent 进入 hook 生命周期。
- 晚上：用户回来。Yuki 聊天可用 — 下午的 Life Track 活动没影响聊天可用性。
- 第二天 8 点：hook 触发。Yuki 的 Life Track 生成一条简短的祝好运消息。用户看到的是聊天里的一条主动消息。

两条轨道；一个 Agent。用户感觉 Agent 是连续的；平台分开追踪审计和预算。

## 阅读场景：Life 满了，Chat 还能聊

设想 Yuki 的 Life Track 在傍晚就把日 token 预算用完了 — 也许节奏是 `high`，自主时刻派出了好几次。

- Life Track 停发新 turn 直到预算重置。
- Chat Track 不受影响。用户的输入照样得到聊天回应。
- 用户感受不到任何可见的"满了" — 看到的是"可以正常跟 Yuki 说话"。**没**发生的是今天再有自主时刻。

这种切分就是架构上的回报。反应式可用性不会被主动式成本绑架。

## 阅读场景：默认关是对的

新用户安装 Nimi，创建第一个 Agent。

- Life Track 默认 `off`。Agent 只反应。
- 用户还没决定要不要主动式 Agent。平台不会未经用户显式同意就开始自主消耗 token。
- 用户可以之后开 `low` 观察行为，决定是否升到 `medium` 等等。

如果默认是 `on`，每个新 Agent 都会立刻开始消耗预算、产出自主时刻。Opt-in 默认尊重用户的同意和预算。

## 来源

- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
