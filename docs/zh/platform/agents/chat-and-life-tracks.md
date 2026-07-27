# Chat 与 Life 双轨

每个 Nimi Agent 跑在两条独立的执行轨道上。这不是 UX 特性，是硬的架构切分。理解平台为什么把它们分开，就是"会回应你的 Agent"和"有自己生活的 Agent"之间的差别。

## 两条轨道

| 轨道 | 触发方 | 拥有者 |
| --- | --- | --- |
| Chat Track | 反应式——用户或应用输入 | Runtime |
| Life Track | 自主——Agent 主动 + Runtime hook 调度 | Runtime |

两条轨道共享 Agent 的状态——同一个 Soul、同一份记忆、同一份 Worldview——但调度面绝不合二为一。

| 维度 | Chat Track | Life Track |
| --- | --- | --- |
| 触发 | 用户 / 应用输入 | Runtime hook 调度 |
| 默认 | 始终可用 | 默认关，需开通 |
| 节奏 | 按输入 | `off` / `low` / `medium` / `high` |
| Token 预算 | 按请求 | 默认按天 |
| 输出 | 聊天回复，可能流式 | Life 回合输出，可能持久化 |
| 另一条繁忙时 | 可用 | 在 Chat 进行中时按 Runtime 准入挂起 |

Life Track 默认关有原因：Agent 主动行动会消耗 Token，无论有没有人在和它说话。默认关让"开"这件事成为显式选择。

## 为什么是硬切分

天真的设计会用同一个调度面处理"用户说了点什么"和"Agent 自己决定做点什么"。Nimi 故意拆开：

| 关注点 | 拆开的理由 |
| --- | --- |
| Token 预算 | 反应式按请求计费；自主式按天计费。混在一起两者都模糊 |
| 聊天可用性 | 聊天必须始终可用。Life Track 占满不能让 Agent 不能回话 |
| 审计 | 聊天输出与 Life 输出的审计类别不同；混在一起会分不清"被问"与"主动" |
| 审批 | Life Track 的某些动作可能需要审批；聊天回复一般不需要。两条轨道走不同闸口 |
| 重放 | 自主时刻的重放与聊天回合的重放不是一回事。两条流分开记录 |

混在一起会逼着每一种分析（计费、审计、重放、调试）去拆开统一循环刚做了什么。拆开就是把这种区分写进平台。

## 节奏

Life Track 有四种节奏：

| 节奏 | 含义 |
| --- | --- |
| `off` | Life 停；Agent 仅反应式 |
| `low` | 偶发自主时刻，按每日预算 |
| `medium` | 更频繁的自主时刻 |
| `high` | 最积极的自主行为；每日预算大概率会被消耗 |

默认 `off`。用户（或宿主产品）选择是否打开 Life，以及节奏。

Life 节奏不是"Agent 多聪明"，是"Agent 多频繁主动行动"。`high` 节奏的 Agent 消耗更多 Token，但不会变成不同的 Agent。

## Token 预算

Life Track 默认按每日 Token 预算。预算用完，Life 停止派发新回合，直到预算重置。

Chat Track 不共用这份预算。聊天回复在任何 Life 预算状态下都会发生。

用户（或宿主产品）可以调预算；平台默认值有意保守。

## 场景：Chat 与 Life 都在运行

用户有个 Agent 叫 Yuki。Yuki 的 Life Track 开在 `medium`。

一天里：

- 上午：用户问 Yuki 天气。Chat Track 激活；Yuki 回复。回复的预算按请求计。
- 下午：用户离开。Yuki 的 Life Track 被 hook 调度器派发。Yuki 注意到一份记忆——用户提过明天有面试。Yuki 发出强类型 `HookIntent`，"明天 8 点提醒祝好运"。这条 intent 进入 hook 生命周期。
- 傍晚：用户回来。Yuki 的聊天响应正常——下午的 Life 活动没有妨碍聊天可用性。
- 第二天 8 点：hook 触发。Yuki 的 Life Track 产出一条简短的祝福。用户在聊天里看到一条主动消息。

两条轨道；同一个 Agent。用户体验是连续的；平台审计与预算分开记。

## 场景：Life 满了，聊天还能用

设 Yuki 的 Life Track 把当日 Token 预算消耗完了——可能节奏 `high`，已经派发过几次自主时刻。

- Life Track 停派新回合，直到预算重置。
- Chat Track 不受影响。用户的任何输入都得到聊天回复。
- 用户感觉不到任何饱和；体验是"我跟 Yuki 正常说话"。当天没有更多自主时刻。

这种分离就是架构带来的回报：反应式可用性不被自主成本绑架。

## 场景：默认关是合理的默认值

新用户安装 Nimi，创建第一个 Agent。

- Life Track 默认 `off`。Agent 仅反应式。
- 用户还没决定要不要主动型 Agent。平台不会在没有显式同意的前提下自主消耗 Token。
- 用户可以稍后开 `low`，观察一段时间，再决定是否升到 `medium`。

如果默认是开的，每个新 Agent 一上来就开始消耗预算并产生自主时刻。默认关尊重用户的同意与预算。

## 来源依据

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
