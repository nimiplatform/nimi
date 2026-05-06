# Nimi 中文文档

Nimi 是一个 AI 开放世界平台。它面向**长期存在的世界**：在这些世界里，人、AI Agent、应用、Runtime 服务共享同一个社会与语义环境，而不是只在某个孤立的聊天框或孤立的 App 里碰面。

在普通的 AI 产品里，Agent 是无状态的请求-响应端点：发问、回答、结束。Nimi 里的 Agent 是**参与者**：它可以跨世界保留身份、记忆、关系、表现和能力边界。世界也不只是聊天室，而是一个有自己规则、历史、在场状态和经济的长期社会与语义环境。

## 文档怎么组织

Nimi 是一个开放世界平台。平台里面包含若干产品：Platform 定义世界模型本身、Runtime 跑 AI 工作、SDK 给应用接入、Desktop 和 Web 是用户外壳、Realm 装世界真相、Avatar 管 Agent 的呈现、Cognition 拥有记忆和知识、Nimi Coding 是平台一起发的 AI 开发方法论。

每个产品在文档里都有自己的章节。

仓库里 `apps/` 目录下有一批扩展 app（parentOS、Forge、shiji、overtone 等）。它们用来**演示平台能做什么**，不是平台本身的一部分。这些扩展 app 不在这套文档里，本文档说的是**平台**。

## 三个层次

平台分成三层 — 在脑子里把它们分开比混在一起讲容易。

```
+----------------------------------------------------------+
|  平台模型                                                  |
|    World、Agent、六个基础协议                               |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  执行底盘                                                  |
|    Runtime    : Provider、工作流、流式、多模态、委派         |
|    Cognition  : 记忆、知识、Prompt 服务、补全              |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  对外面板                                                  |
|    SDK 应用接入边界           桌面端原生外壳                |
|    网页端受限版                Realm 公开读路径              |
|    Avatar 表现层权威                                       |
+----------------------------------------------------------+
```

1. **平台模型**定义世界、Agent、六个固定基础协议，以及谁有资格重新定义什么。
2. **执行底盘**说明 AI 工作究竟如何发生：Runtime 拥有 Provider、工作流、流式、多模态产物、本地路由；Cognition 拥有记忆、知识、Prompt 服务、引用与补全。
3. **对外面板**把平台呈现为桌面端、网页端、SDK、Realm、Avatar 五种用户可触达的体验。每个对外面板都有自己的权威边界和独立的中文章节。

## 推荐的阅读路径

| 你想了解…… | 从这里开始 |
| --- | --- |
| 产品和世界模型本身 | [平台](/zh/platform/) |
| 当前的可用性与启动姿态 | [Start](/zh/start/) |
| AI 执行如何被治理 | [Runtime](/zh/runtime/) |
| 应用如何接入而不跨私有边界 | [SDK](/zh/sdk/) |
| 桌面端为何不等于网页端 | [桌面端](/zh/desktop/) |
| 世界真相与世界历史在哪里 | [Realm](/zh/realm/) |
| 具身 AI 的呈现层 | [Avatar](/zh/avatar/) |
| 记忆与知识的权威归属 | [Cognition](/zh/cognition/) |
| AI 开发新范式与宿主无关包 | [Nimi Coding](/zh/nimicoding/) |
| 跨域术语对照 | [术语表](/zh/glossary) |

## 来源

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
