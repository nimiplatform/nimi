# 安装与可用性

Nimi 不是单一安装包。平台主体目前还是以产品与架构文档为入口；它没有一条覆盖所有产品的终端安装命令。Nimi Coding 是已经单独分发的部分，可以通过 npm 包 `@nimiplatform/nimi-coding` 安装。

## 该读什么

如果你要理解平台，先从产品模型读起。架构与产品面页已经能回答最重要的问题：

- [平台](/zh/platform/) 解释世界模型与协议基础协议。
- [Runtime](/zh/runtime/) 解释 AI 执行基底与它拥有什么。
- [SDK](/zh/sdk/) 解释支持的 App 面边界。
- [桌面端](/zh/desktop/) 解释原生外壳与跟 Web 怎么不同。
- [Nimi Coding](/zh/nimicoding/) 解释把高风险改动经 review 的治理工作流。

如果你要在自己的项目里采纳 Nimi Coding，直接看 [Nimi Coding 安装](/zh/nimicoding/installation)。

如果你跟踪项目就绪度，[Spec Map](/zh/reference/spec-map) 会告诉你哪些权威面已经在公开规范里出现。

## 来源

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
