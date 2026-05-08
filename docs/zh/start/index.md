# 起步

这一页帮你挑一条合适的阅读路径。Nimi 还没正式公开发布，所以现阶段的公开文档主要是产品与架构介绍。Nimi Coding 已有自己的 npm 包；平台其余部分先讲清楚产品形态，再谈可运行的接入路径。

如果你是来找安装信息的，直接跳到[安装与可用性](/zh/start/install)。那一页把 Nimi Coding 的 npm 包与平台其它部分的文档分开列出。

## 第一次接触 Nimi

按这个顺序读：

1. [平台](/zh/platform/)：产品模型、世界这个核心概念，以及六条基础协议。
2. [Runtime](/zh/runtime/)：AI 工作如何被实际执行。
3. [SDK](/zh/sdk/)：应用接入 Nimi 的边界面。
4. [桌面端](/zh/desktop/)：第一方原生外壳，以及网页端与之有何不同。
5. [Realm](/zh/realm/)：语义真相与世界历史。

这条路径先建立心智模型，再进入实现细节。从"这是个什么样的系统"，到"AI 工作怎么做出来"，再到"应用怎么看见这一切"。

如果想要一份术语对照，[术语表](/zh/glossary)收齐了各个章节里通用的词。

## 你在评估这个项目

想快速过一遍，按这个顺序：

1. [平台愿景](/zh/platform/vision)：北极星定位。
2. [平台架构](/zh/platform/architecture/)：跨层全景图。
3. [Runtime 概览](/zh/runtime/) 与 [Runtime 工作流与多模态](/zh/runtime/workflows-and-multimodal)：AI 基础层负责什么。
4. [SDK 概览](/zh/sdk/) 与 [SDK 边界](/zh/sdk/boundaries)：应用要遵守的接入规矩。
5. [Nimi Coding 白皮书](/zh/nimicoding/whitepaper)：这个仓库里 AI 协助工程的治理方式。

这个量大致等同读一篇长博客的时间，能给出当前公开面真实的样子。

## 你在基于 Nimi 构建

从 [SDK](/zh/sdk/) 与 [Runtime](/zh/runtime/) 开始。SDK 是应用的公开接入面。Runtime 与 Realm 的私有边界不应被应用直接跨过；SDK 存在的意义就是让应用不需要这么做。

要看原生外壳行为，读[桌面端](/zh/desktop/)。要看网页端行为，读 [Web 模式](/zh/desktop/web-mode)。网页端是受限呈现，不会自动继承桌面原生能力。

## 场景：一个应用作者读完这套文档

你是一位刚听说 Nimi 的应用作者，比较合理的第一遍路径是：

1. 读[平台](/zh/platform/)，了解世界（不是聊天会话）才是核心对象。
2. 读 [Runtime](/zh/runtime/)，了解 Provider、工作流、流式、多模态产物归 Runtime 契约管，不归你的应用代码。
3. 读 [SDK](/zh/sdk/)，了解你的应用通过 `sdk/runtime`、`sdk/world`、`sdk/realm`、`sdk/ai-provider`、`sdk/scope`、`sdk/mod` 来消费这些契约，不要去 import 私有内部。
4. 读[桌面端](/zh/desktop/) 与 [Web 模式](/zh/desktop/web-mode)，了解为什么二者能力范围不同，以及这对你应用的分发计划意味着什么。
5. 等你开始贡献，再读 [Nimi Coding](/zh/nimicoding/)。在高风险或跨表面修改上，其他贡献者会期待你顺着这套工作流。

这一遍走完后，[规范地图](/zh/reference/spec-map)告诉你公开文字不够精确时应该到哪里读底层契约。

## 你在找安装指引

公开的安装信息必须有已准入的依据：命令真实存在、路径真实支持、发布或分发渠道真实。Nimi Coding 的 npm 包已具备这些条件；其它表面目前用契约页讲清产品模型。

详见[安装与可用性](/zh/start/install)。

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
