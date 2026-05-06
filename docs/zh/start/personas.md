# Personas

Nimi 公开文档最常见读者的阅读路径。每个 persona 有一条主路径走文档；页之间也有横向链让读者在路径之间穿。

## 评估新手

你听说 Nimi 想 30 分钟决定这项目对你重不重要。

1. [平台 → 愿景](/zh/platform/vision)：这项目是干嘛的。
2. [平台 → 六个基础协议](/zh/platform/protocol)：让平台成为平台的跨世界合同面。
3. [平台 → 架构](/zh/platform/architecture/)：谁拥有什么的跨层 map。
4. [Nimi Coding → 总览](/zh/nimicoding/)：第二个共定位产品命题：Nimi Coding 作 AI 开发范式。
5. [参考 → 术语表](/zh/reference/glossary)：读时打开这个。

走完这条路你能跟别人描述 Nimi。

## 世界创作者

你想设计一个世界 — 它的规则、lore、Agent、Scene — 并发布。

1. [平台 → 愿景](/zh/platform/vision)：世界是什么。
2. [Realm](/zh/realm/)：语义真相、世界状态、世界历史。
3. [参考 → World 字段](/zh/reference/world-fields)：世界字段级长什么样。
4. [参考 → 六个基础协议](/zh/reference/six-primitives)：你世界参与的跨世界合同。
5. [Realm → 世界创作者经济](/zh/realm/)：给创作者的经济语义（admit 时；某些子页在后波 land）。

## Mod 开发者

你想用有界能力扩展桌面端。

1. [桌面端](/zh/desktop/)：桌面端是什么、为什么 mod 是一等面、不是 plugin。
2. [桌面端 → Mod](/zh/desktop/mods)：hook 能力边界。
3. [SDK → 边界](/zh/sdk/boundaries)：mod 不能绕的。
4. [参考 → 权威域](/zh/reference/authority-domains)：mod 必须尊重的所有权线。

## App 开发者

你想用 SDK 在 Nimi 上建 App。

1. [SDK → 总览](/zh/sdk/)：单一开发者面。
2. [SDK → 边界](/zh/sdk/boundaries)：App 能与不能触及什么。
3. [SDK → Runtime Client](/zh/sdk/runtime-client)：App 进 Runtime 的路径。
4. [SDK → Realm 与世界 Client](/zh/sdk/realm-world-client)：组合世界真相与 runtime 撑的生成。
5. [参考 → 状态机](/zh/reference/state-machines)：你 App 会观察的状态机。

## AI Agent 集成者

你想集成一个外部 AI host 作为参与者。

1. [平台 → 愿景](/zh/platform/vision)：Agent 作一等参与者。
2. [平台 → AI Agent 安全接口](/zh/platform/)：给外部 Agent 的安全模型（子页在后波 land）。
3. [Runtime → 委派能力](/zh/runtime/)：闸口与输出 firewall（子页在后波 land）。
4. [参考 → Agent 字段](/zh/reference/agent-fields)：Agent 长什么样、含外部 Agent 字段。
5. [参考 → 状态机](/zh/reference/state-machines)：委派 Provider 与委派 session 状态机。

## Nimi Coding 采纳者

你想在自己项目采纳 Nimi Coding 作 AI 开发方法学。

1. [Nimi Coding → 总览](/zh/nimicoding/)：范式与包。
2. [Nimi Coding → Whitepaper](/zh/nimicoding/whitepaper)：范式命题。
3. [Nimi Coding → Topic 工作流](/zh/nimicoding/topic-workflow)：topic / wave / packet / preflight / 审计 / closeout 生命周期。
4. [参考 → 禁用主张](/zh/reference/forbidden-claims)：禁用捷径心态用到文档上。
5. [参考 → 状态机](/zh/reference/state-machines)：Topic 与 wave 状态机。

（完整 Nimi Coding section 在后波扩展；当前子页仍可从 section 总览到达。）

## 审计 / Reviewer

你正对照 admitted 权威 review Nimi。你要把公开声明追回来源。

1. [参考 → Spec Map](/zh/reference/spec-map)：公开-section 到 spec-area 映射。
2. [参考 → 权威域](/zh/reference/authority-domains)：谁拥有什么。
3. [参考 → 术语表](/zh/reference/glossary)：词汇对齐。
4. [Nimi Coding → Topic 工作流](/zh/nimicoding/topic-workflow)：工作工件（topic.yaml、packet、preflight 结果、审计、closeout）怎么结构化。

## 来源

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
