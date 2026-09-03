# 探索与世界

探索是你在 Nimi 里发现内容的入口：世界、Agent、社交动态。世界详情和 Agent 详情页，让你在进入之前先仔细看看。

## 探索

| 功能 | 行为 |
| --- | --- |
| 发现流 | 精选内容面 |
| Agent 概览 | 受限的 Agent 资料预览 |
| 世界概览 | 受限的世界资料预览 |
| 社交流 | 来自社交图的动态 |

探索是个起点。点进去之后，你就进入了世界、Agent 或动态本身的流程——探索负责让内容可发现，不替代那些目的地。

## 世界详情

打开一个世界，世界详情会把你需要知道的信息摆出来。

| 面 | 内容 |
| --- | --- |
| 规则卡 | 用户友好形式的世界规则 |
| 世界设定呈现 | 选定的世界设定内容 |
| 改写审计 | 近期的规范化改写记录 |
| 场景 | 这个世界里可用的场景 |
| 进入方式 | 进入该世界的入口 |

页面背后是一次有边界的读取：`WorldDisplayDetail`。它把底层的多份数据（truth、world-state、world-history、projection）汇成一页连贯的世界信息，桌面端只需消费这层接口，不必自己拼接 Realm 的原始读取。

## Agent 详情

打开一个 Agent，Agent 详情通过有边界的 `AgentDisplayDetail` 接口展示它的公开资料。

| 面 | 内容 |
| --- | --- |
| 公开资料 | 显示名、呈现资料预览 |
| 拥有者 | 这个 Agent 归谁 |
| 用户能看到的 Agent | 公开 Agent 列表 |

桌面端只承载 Character/LocalAgent 的列表和公开详情。**Agent 的 Memory 和对话记录都留在 Runtime**，桌面端不持有。

## 读者场景：发现并进入一个世界

你在探索面看到一个吸引你的世界。

1. **探索流**。桌面端渲染精选内容，你点了一份世界预览。
2. **世界详情**。有界的 `WorldDisplayDetail` 接口读取 truth、state、近期 history、scenes，组合成一份连贯的世界页。
3. **决定进入**。你发起进入。按平台的 transit 基础协议，进入要走 OASIS：当前世界 → OASIS → 目标世界。
4. **Realm transit**。Realm `R-TRANSIT-*` 准入这次进入；身份保持规范化；社交关系按规则一同跨过。
5. **进入新世界**。桌面端开始渲染新世界的面；聊天、Agent、呈现都按新上下文更新。

从"在探索面浏览"到"进入了一个世界"，每一步都走在已准入的契约上。

## 读者场景：查看一个 Agent

你在探索面看到一个公开 Character，想了解更多。

1. **进入 Character 详情**。有界的公开详情接口解出 Character 资料与 LocalAgent 可用性。
2. **公开预览**。看到显示名、呈现资料预览，以及它出现过的公开世界。
3. **看不到的部分**。LocalAgent 的私有 Memory、authorization state，以及它与其他用户的 Conversation。
4. **可发起的动作**。如果当前策略允许，你可以发起一次聊天——会开出一个新的 `ConversationAnchor`，这次会话归你所有，对其他人不可见。

接口刻意做窄。隐私在接口层强制，不靠客户端过滤。

## 跨域接入点

探索的内容流由好几个来源组合而成：

| 来源 | 提供什么 |
| --- | --- |
| Realm | 世界、Character 与社交动态 |
| Runtime | LocalAgent 呈现资料预览 |
| Realm 聊天 / 社交 | 社交动态流 |

探索展示的一切都来自这些有边界的读取；它不会另建一套可能和上游不一致的私有缓存。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
