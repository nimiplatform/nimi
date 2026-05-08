# 用户画像

按读者类型给出阅读路径。每条路径有一个主线，页面之间也彼此引用，方便横向跳跃。

## 新接触者

你听说了 Nimi，想用 30 分钟判断这件事跟你相关不相关。

1. [平台 → 愿景](/zh/platform/vision)：这个项目是为了什么。
2. [平台 → 六条基础协议](/zh/platform/protocol)：让平台之所以是平台的那层跨世界契约。
3. [平台 → 架构](/zh/platform/architecture/)：谁拥有什么的全景图。
4. [Nimi Coding → 概览](/zh/nimicoding/)：第二个并列产品论点，把 Nimi Coding 视为 AI 开发范式。
5. [参考 → 术语表](/zh/reference/glossary)：边读边看。

走完这条路径，你能向别人讲清楚 Nimi 是什么。

## 世界创作者

你想设计一个世界（规则、设定、Agent、场景），然后发布出来。

1. [平台 → 愿景](/zh/platform/vision)：世界是什么。
2. [Realm](/zh/realm/)：语义真相、世界状态、世界历史。
3. [参考 → 世界字段](/zh/reference/world-fields)：字段层面世界长什么样。
4. [参考 → 六条基础协议](/zh/reference/six-primitives)：你的世界要参与的跨世界契约。
5. [Realm → 世界创作者经济](/zh/realm/)：创作者的经济语义（准入后；部分子页在后续批次完成）。

## Mod 开发者

你想用受限能力扩展桌面端。

1. [桌面端](/zh/desktop/)：桌面端是什么、为什么 Mod 是一等表面而不是插件。
2. [桌面端 → Mod 体系](/zh/desktop/mods)：Hook 能力边界。
3. [SDK → 边界](/zh/sdk/boundaries)：Mod 不能绕开的地方。
4. [参考 → 权威域](/zh/reference/authority-domains)：Mod 必须遵守的归属线。

## 应用开发者

你想用 SDK 在 Nimi 上做应用。

1. [SDK → 概览](/zh/sdk/)：唯一的开发面。
2. [SDK → 边界](/zh/sdk/boundaries)：应用能与不能触达的范围。
3. [SDK → Runtime 客户端](/zh/sdk/runtime-client)：应用走向 Runtime 的通道。
4. [SDK → Realm 与世界客户端](/zh/sdk/realm-world-client)：把世界真相与 Runtime 生成组合起来。
5. [参考 → 状态机](/zh/reference/state-machines)：你的应用会观察到的状态机。

## AI Agent 接入方

你想把外部 AI 宿主接入为参与者。

1. [平台 → 愿景](/zh/platform/vision)：Agent 作为一等参与者。
2. [平台 → AI Agent 安全接口](/zh/platform/)：外部 Agent 的安全模型（子页在后续批次完成）。
3. [Runtime → 委派能力](/zh/runtime/)：网关与输出防火墙（子页在后续批次完成）。
4. [参考 → Agent 字段](/zh/reference/agent-fields)：Agent 长什么样，包括外部 Agent 字段。
5. [参考 → 状态机](/zh/reference/state-machines)：委派 Provider 与委派会话状态机。

## Nimi Coding 采用者

你想在自己的项目里把 Nimi Coding 作为 AI 开发方法论。

1. [Nimi Coding → 概览](/zh/nimicoding/)：范式与软件包。
2. [Nimi Coding → 白皮书](/zh/nimicoding/whitepaper)：范式论点。
3. [Nimi Coding → 议题工作流](/zh/nimicoding/topic-workflow)：topic / wave / packet / preflight / audit / closeout 生命周期。
4. [参考 → 禁止主张](/zh/reference/forbidden-claims)：把"禁捷径"心态用到文档上。
5. [参考 → 状态机](/zh/reference/state-machines)：topic 与 wave 状态机。

完整 Nimi Coding 章节在后续批次扩写；当前子页可以从概览页直达。

## 审计 / 评审

你在依据已准入权威评估 Nimi。要把公开主张追溯回源头。

1. [参考 → 规范地图](/zh/reference/spec-map)：公开章节到规范区域的映射。
2. [参考 → 权威域](/zh/reference/authority-domains)：谁拥有什么。
3. [参考 → 术语表](/zh/reference/glossary)：词汇对齐。
4. [Nimi Coding → 议题工作流](/zh/nimicoding/topic-workflow)：工作产物 (topic.yaml、packet、preflight 结果、audit、closeout) 的组织方式。

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
