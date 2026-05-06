# Start

这一页帮你选择合适的阅读路径。Nimi 文档从产品模型和架构边界讲起：平台是什么、各层分别拥有什么、应用和贡献者应该从哪里进入。

如果你来这里是为了判断能否接入或安装，请直接跳到 [安装与可用性](/zh/start/install)。

## 如果你是 Nimi 新手

按这个顺序读：

1. [平台](/zh/platform/) — 产品模型、世界概念、六个基础协议。
2. [Runtime](/zh/runtime/) — AI 工作究竟如何执行。
3. [SDK](/zh/sdk/) — 应用接入边界。
4. [桌面端](/zh/desktop/) — 第一方原生外壳，以及网页端与之的区别。
5. [Realm](/zh/realm/) — 语义真相与世界历史。

这条顺序在你遇到具体实现细节之前先把心智模型搭好。它从「这是什么样的系统」走到「AI 工作是怎么做的」，再走到「应用怎么看到它」。

要单页查术语，[术语表](/zh/glossary) 收集了每个章节都用到的跨域词汇。

## 如果你在评估这个项目

快速评估按这个顺序读：

1. [平台愿景](/zh/platform/vision)— 北极星定位。
2. [平台架构](/zh/platform/architecture/)— 跨层地图。
3. [Runtime](/zh/runtime/) 与 [Runtime 工作流与多模态](/zh/runtime/workflows-and-multimodal)— AI 底盘负责什么。
4. [SDK](/zh/sdk/) 与 [SDK 边界](/zh/sdk/boundaries)— 应用应有的接入纪律。
5. [Nimi Coding 白皮书](/zh/nimicoding/whitepaper)— 这个仓库怎么治理 AI 辅助工程。

这条路径耗时与读一篇长博客差不多，能给你一份对今天公开面板的可信图景。

## 如果你在基于 Nimi 构建

从 [SDK](/zh/sdk/) 与 [Runtime](/zh/runtime/) 开始。SDK 是给应用的公开接入面；Runtime 与 Realm 的私有边界**不应**被应用直接跨越，SDK 的存在就是为了让应用不需要这么做。

原生外壳行为读 [桌面端](/zh/desktop/)；网页端行为读 [网页端模式](/zh/desktop/web-mode)。网页端是受限版，不会因为概念相同就默默继承桌面端原生能力。

## 阅读场景：一个应用作者走读文档

设想你是刚听说 Nimi 的应用作者。一个有用的首次走读看起来是这样的：

1. 读 [平台](/zh/platform/) — 发现「世界」（不是「聊天会话」）才是中心对象。
2. 读 [Runtime](/zh/runtime/) — 发现 Provider、工作流、流式、多模态产物由 Runtime 合同治理，不是由应用代码治理。
3. 读 [SDK](/zh/sdk/) — 发现应用应通过 `sdk/runtime`、`sdk/world`、`sdk/realm`、`sdk/ai-provider`、`sdk/scope`、`sdk/mod` 消费这些合同，而不是 import 私有内部。
4. 读 [桌面端](/zh/desktop/) 与 [网页端模式](/zh/desktop/web-mode)— 理解桌面端与网页端能力范围不一样，以及这对你的应用分发计划意味着什么。
5. 当你开始贡献时再读 [Nimi Coding](/zh/nimicoding/) — 那是其他贡献者在高风险或跨面板改动上希望你遵守的工作流。

走完之后，[Spec Map](/zh/reference/spec-map)会告诉你在公开叙述不够精确时去哪里读底层合同。

## 如果你在找安装说明

安装、分发和可用性集中在 [安装与可用性](/zh/start/install)。那一页给出当前可依赖的入口；本页只帮你选阅读路径。

## 来源

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
