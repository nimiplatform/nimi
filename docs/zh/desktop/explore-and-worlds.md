# 探索与世界

桌面端的探索面是发现内容的入口——世界、Agent、社交动态。世界详情与 Agent 详情让用户深入查看。这些都是 Realm 规范态的呈现。

## 探索

| 功能 | 行为 |
| --- | --- |
| 发现流 | 精选内容面 |
| Agent 概览 | 受限的 Agent 资料预览 |
| 世界概览 | 受限的世界资料预览 |
| 社交流 | 来自社交图的动态 |

探索是导航入口。点进去会转到对应的领域数据流：世界流、Agent 流、动态流。探索本身不拥有这些流，它只是可发现的入口面。

## 世界详情

用户进入某个世界后，世界详情把他需要的信息呈现出来。

| 面 | 内容 |
| --- | --- |
| 规则卡 | 用户友好形式的世界规则 |
| 世界设定呈现 | 选定的世界设定内容 |
| 改写审计 | 近期的规范化改写记录 |
| 场景 | 这个世界里可用的场景 |
| 进入方式 | 进入该世界的入口 |

世界详情消费一个有界的 `WorldDisplayDetail` 接缝。多份原始读取（truth、world-state、world-history、呈现）汇聚成一份呈现权威。读者看到一份连贯的世界页；桌面端消费这层接缝，不直接动 Realm 的原始契约。

## Agent 详情

用户进入某个 Agent 后，Agent 详情通过有界的 `AgentDisplayDetail` 接缝展示其公开资料。

| 面 | 内容 |
| --- | --- |
| 公开资料 | 显示名、呈现资料预览 |
| 拥有者 | 这个 Agent 归谁 |
| 用户能看到的 Agent | 公开 Agent 列表 |

桌面端核心只承担 Agent 列表与公开详情读取。**它不持有 Agent 的 LLM 记忆与聊天通道**——那归 Runtime / Cognition。

## 场景：发现并进入一个世界

你在探索面看到一个吸引你的世界。

1. **探索流**。桌面端渲染精选内容，你点了一份世界预览。
2. **世界详情**。有界的 `WorldDisplayDetail` 接缝读取 truth、state、近期 history、scenes，组合成一份连贯的世界页。
3. **决定进入**。你发起进入。按平台的 transit 基础协议，进入要走 OASIS：当前世界 → OASIS → 目标世界。
4. **Realm transit**。Realm `R-TRANSIT-*` 准入这次进入；身份保持规范化；社交关系按规则一同跨过。
5. **进入新世界**。桌面端开始渲染新世界的面；聊天、Agent、呈现都按新上下文更新。

从"在探索面浏览"到"进入了一个世界"，每一步都走在已准入的契约上。

## 场景：查看一个 Agent

你在探索面看到一个公开 Agent，想了解更多。

1. **进入 Agent 详情**。有界的 `AgentDisplayDetail` 接缝解出它的公开资料。
2. **公开预览**。看到显示名、呈现资料预览，以及它出现过的公开世界。
3. **看不到的部分**。它的 `AGENT_CORE` 私有记忆；它内部的世界观核；它与其他用户的聊天历史。
4. **可发起的动作**。如果该 Agent 的策略允许，你可以发起一次聊天——会开出一个新的 `ConversationAnchor`，这次会话归你所有，对其他人不可见。

接缝刻意做窄。隐私在接缝层强制，不靠客户端过滤。

## 跨域接入点

探索从多处读取来组合内容流：

| 来源 | 提供什么 |
| --- | --- |
| Realm | 世界、Agent、社交动态 |
| Runtime | Agent 呈现资料预览 |
| Realm 聊天 / 社交 | 社交动态流 |

组合受准入接缝约束。探索不会自造与上游真相不一致的缓存。

## 来源依据

- [`.nimi/spec/desktop/explore.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/explore.md)
- [`.nimi/spec/desktop/world-detail.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/world-detail.md)
- [`.nimi/spec/desktop/agent-detail.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-detail.md)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
