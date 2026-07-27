# 本地审计

Runtime 写出一份本地审计账本，覆盖每一次 AI 调用、模型操作、应用消息、授权决策。审计是本地真相，存储在你这台机器上。Realm 云端审计是另一面，Runtime 在配置允许时可以选择把聚合上送过去。

## 本地审计记什么

Runtime 写下：

| 事件族 | 例子 |
| --- | --- |
| AI 调用 | 请求开始、ScenarioJob 生命周期、终态 |
| 模型操作 | provider 路由、本地引擎路由、模型解析 |
| 应用消息 | 应用之间经 Runtime 中转的消息 |
| 授权决策 | Token 校验、作用域核对、能力准入 |
| 委派链路 | 外部 AI 会话、防火墙裁决、审批决定、动作链路 |
| 记忆写入与复制 | 写入准入、复制状态迁移、冲突 / 失效 |
| Hook 生命周期 | 准入、调度、触发、终态 |

每条事件都有结构化字段、principal 链路和 trace id，并且能跨 Runtime 重启保留。

## 本地优先

审计本地优先是有意为之。云端不是必需，账本不依赖 Realm 在线。

| 关注点 | 本地优先的理由 |
| --- | --- |
| 隐私 | 审计是你的，不必上传 |
| 独立性 | 离线时审计照常工作 |
| 权威 | 本地审计是本地真相，不是云端的退化副本 |
| 可选聚合 | 配置开启后，Runtime 可向上送聚合 |

如果用户后来登录 Realm 并选择聚合上送，Runtime 把聚合送上去。本地审计真相不会被回溯改写，聚合只朝一个方向走。

## 审计链路

审计记录带强类型链路，便于事后还原现场。

| 链路元素 | 用途 |
| --- | --- |
| Trace id | 标识一次端到端的执行 |
| Principal id | 谁在动作（用户 / Character / LocalAgent / App / 外部 principal） |
| Job id | `ScenarioJob` 链路 |
| Provider id | 涉及的 provider |
| 动作链路 | 委派路径上：建议 → 裁决 → 审批 → 动作 |

事后查审计的人能回答"发生了什么"，而不仅是"日志写了什么"。

## 审计统计与健康快照

审计契约准入了结构化统计与健康快照。`nimi doctor` 暴露：

| 指标 | 含义 |
| --- | --- |
| 审计量 | 单位时间记录数 |
| 复制积压 | 等待向云端聚合的记录数（启用时） |
| 失败率 | 近期失败事件占比 |
| Job 吞吐 | 近期 ScenarioJob 完成速率 |

这些指标可观察，订阅审计健康的应用拿到的是一条强类型事件流。

## 读者场景：还原一次失败的 AI 请求

昨天出了点问题，用户想知道究竟发生了什么。

1. **用 trace id 定位。** 用户拿着 trace id（聊天里的错误信息或应用日志带来的）按 trace id 查审计。
2. **ScenarioJob 链路。** Job 生命周期被记下：`SUBMITTED → RUNNING → FAILED`。
4. **Provider 链路。** 路由到了哪个 provider、provider 当时什么状态、回了哪个错误码。
5. **流式链路。** 终止失败帧也被记下。
6. **现场重建。** 用户拿到的是一条结构化链：这次请求 → 这个 job → 这个 provider → 这个错误 → 这个终态，不必猜。

审计就是平台对"发生了什么"的回答。自由格式日志做不到这件事，强类型审计链路才行。

## 读者场景：一条委派审计链

某个外部 AI 做了一次动作，事后用户想看它是怎么被授权的。

1. **会话记录。** 外部 principal 会话开始，带信任层级与策略快照。
2. **建议记录。** 强类型委派请求形态。
3. **防火墙裁决。** 防火墙的判定。
4. **审批记录。** 用户审批（如果命中 `APPROVAL_REQUIRED`）。
5. **动作记录。** Runtime 持有的动作及其自身链路。
6. **结果记录。** 动作的终态。

整条链端到端：审阅人按链就能回答"谁提议、谁授权、最后做成了什么"，没有歧义。

## 读者场景：用户翻看记忆活动

用户想知道自家 Agent 都记了些什么。

1. **写入事件。** 审计列出每次准入的写入，含库作用域和来源。
2. **复制事件。** 每次写入的状态迁移（`pending → synced` 或别的）。
3. **读取事件。** 后续回合里何时读到了这条记忆。
4. **冲突 / 失效事件。** 任何对账步骤。

用户能据此回答"我的 Agent 记没记 X、有没有被作废过"。

## 可选聚合到 Realm

Runtime 可选地把审计聚合送到 Realm。

| 属性 | 取值 |
| --- | --- |
| 默认 | 关 |
| 启用方式 | 用户配置 / 宿主产品配置 |
| 方向 | 本地 → Realm，永远不反向改写 |
| 粒度 | 聚合与摘要，不是原始记录流 |

本地审计是真相源，Realm 聚合是它的一份改写。

## 来源依据

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`config/runtime-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-reason-codes.yaml)
