# 探索与世界

桌面端的探索面是发现内容的入口 — 世界、Agent、社交动态。世界详情与 Agent 详情面让用户深入了解。每一个都是规范化 Realm 真相的只读视图。

## 探索

| 功能 | 行为 |
| --- | --- |
| 发现 feed | 受策展的内容面 |
| Agent 详情预览 | 有界的 Agent 资料预览 |
| 世界详情预览 | 有界的世界资料预览 |
| 社交 feed | 来自你社交图的发帖与更新 |

探索是导航入口。点进去就委派给别的域数据流 — 世界流、Agent 流、动态 / feed 流。探索**不**拥有那些流；它是可发现的面。

## 世界详情

用户进入某个具体世界时，世界详情是把他们需要知道的东西呈现出来的视图。

| 面 | 内容 |
| --- | --- |
| 规则卡片 | 用户友好形式的世界规则 |
| Lorebook 视图 | 选定的 lore 内容 |
| 修改审计 | 近期规范化修改 |
| Scene | 这个世界里可用的场景 |
| 通行 | 进入世界的传送 / 入口 |

世界详情消费一个有界的 `WorldDisplayDetail` 接缝。多个原始读（truth、world-state、world-history、projection）汇成一个显示权威。读者看到一个连贯的世界页；桌面端消费的是接缝，不是直接读 realm 合同。

## Agent 详情

用户进入某个具体 Agent 时，Agent 详情通过有界的 `AgentDisplayDetail` 接缝展示该 Agent 的公开资料。

| 面 | 内容 |
| --- | --- |
| 公开资料 | 显示名、呈现层 profile 预览 |
| 拥有者 | 谁拥有这个 Agent |
| 用户能看到的 Agent | 公开 Agent 列表 |

桌面端核心只承载 Agent 列表 + 公开详情读。**它不承载 Agent LLM 记忆或聊天路由** — 那些住在 runtime / cognition 路径。

## 阅读场景：发现并进入一个世界

你在探索浏览，看到一个感兴趣的世界。

1. **探索 feed。** 桌面端渲染受策展的内容。你点一个世界预览。
2. **世界详情。** 一个有界的 `WorldDisplayDetail` 接缝读 truth、state、近期 history、scene — 拼成连贯的世界页。
3. **决定进入。** 你发起通行。按平台的通行基础协议，通行经 OASIS：当前世界 → OASIS → 目标世界。
4. **Realm 通行。** Realm `R-TRANSIT-*` 准入这次通行；身份保持规范化；社交身份相应跨过。
5. **进入新世界。** 桌面端开始渲染新世界的面；聊天、Agent、呈现层切到新上下文。

你从「在探索浏览」走到「世界里」，每一步都过准入合同。

## 阅读场景：看一个 Agent

你在探索看到一个公开 Agent 想了解。

1. **点进 Agent 详情。** 一个有界的 `AgentDisplayDetail` 接缝解析该 Agent 的公开资料。
2. **公开预览。** 你看到显示名、呈现层 profile 预览、Agent 出现的公开世界。
3. **你看不到什么。** 该 Agent 的 `AGENT_CORE` 私有记忆；该 Agent 的内部 worldview kernel；该 Agent 跟其他用户的聊天历史。
4. **动作。** 该 Agent 策略允许的话，你可以发起一段聊天 — 一个新的 `ConversationAnchor` 打开；对话归你，对其他人不可见。

接缝有意做窄。隐私在接缝层强制，不靠客户端过滤。

## 跨域接触点

探索从多处读以组合 feed：

| 来源 | 提供什么 |
| --- | --- |
| Realm | 世界、Agent、社交动态 |
| Runtime | Agent 呈现层 profile 预览 |
| Realm 聊天 / 社交 | 社交动态流 |

组合受准入接缝约束；探索**不**自建会跟上游真相漂移的缓存。

## 来源

- [`.nimi/spec/desktop/explore.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/explore.md)
- [`.nimi/spec/desktop/world-detail.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/world-detail.md)
- [`.nimi/spec/desktop/agent-detail.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-detail.md)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
