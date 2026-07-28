# Nimi 文档

Nimi 是一个 AI 开放世界平台。它把 Character 视作长期世界中的持久参与者，而不是只响应单次请求的无状态工具；Runtime 把 Character 物化为可执行的 LocalAgent。

这套文档旨在阐述 Nimi 的产品模型、权责边界，以及跨领域确立的底层契约。

## 文档结构

Nimi 作为一个开放世界平台，内含多个核心组件，共同支撑 Character 在长期世界中生存：平台（世界模型本身）、Runtime（LocalAgent 执行以及 Conversation、Memory、Knowledge）、SDK（App 接入层）、桌面端与网页端（用户界面）、Realm（世界真相层）、Avatar（形体呈现）以及 Nimi Coding（仓库使用的 canonical-authority 工具）。

上述每个组件在文档中均有独立章节。

代码仓库当前 active 的 `apps/` 目录包含第一方产品表面和 reference apps。这些 App 消费 Runtime、Realm、SDK、Kit 与 app-tools，但不定义平台权威。平台权威位于 `.nimi/spec/**`，App 作者入口以公开包和公开命令为准。

## 本文档包含的内容

- 阐述 Nimi 为何选择围绕“世界”而非“聊天”来构建产品模型。
- 明确划分并定义各权威域对不同类型真相的归属权。
- 提供从平台模型逐步深入至 Runtime、SDK、桌面端、Realm、Avatar 以及 Nimi Coding 的系统性阅读路径。
- 提供创建 Nimi App、第一次 Runtime-backed AI 调用、使用 Kit、参考 Tester，以及理解常见 fail-closed 状态的开发者路径。
- 汇总跨领域通用的术语表。

## 三层视角

Nimi 平台在架构上可划分为三个层次。分层视角有助于清晰理解其内部构造：

```
+----------------------------------------------------------+
|  平台模型                                                 |
|    World、Character、六项固定基础协议                     |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  执行底座                                                 |
|    Runtime    : provider、LocalAgent、Conversation、      |
|                 Memory、Knowledge、流式与多模态            |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  公开层                                                   |
|    SDK App 边界           桌面端原生外壳                   |
|    网页端受限改写         Realm 公开读路径                 |
|    Avatar 形体呈现                                        |
+----------------------------------------------------------+
```

1. **平台模型**：定义了 World、Character、六项固定基础协议，以及相关 owner 边界。
2. **执行底座**：AI 任务实际执行的层级。Runtime 持有 Provider 路由、LocalAgent 物化、Conversation、运行态 Memory 与 Knowledge、流式传输及多模态输出。
3. **公开层**：将平台能力呈现为桌面端、网页端、SDK、Realm 及 Avatar 的交互体验。每一层公开层均具备明确的权威边界，并在文档中独立成节。

## 阅读路径

| 想了解…… | 从这里开始 |
| --- | --- |
| 产品、世界模型、它存在的理由 | [平台](/zh/platform/) |
| 当前可用性状态 | [Start](/zh/start/) |
| 如何创建 Nimi App scaffold | [创建 Nimi App](/zh/start/create-an-app) |
| TypeScript App 如何发起第一次 Runtime AI 调用 | [第一次 AI 调用](/zh/sdk/first-ai-call) |
| App 如何复用 Kit surface | [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app) |
| 如何研究 reference app | [把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference) |
| 如何理解 Runtime、SDK、Tester 和 scaffold 失败 | [故障排查](/zh/start/troubleshooting) |
| AI 执行如何治理 | [Runtime](/zh/runtime/) |
| App 如何在不跨私有边界的前提下接入 | [SDK](/zh/sdk/) |
| 为什么桌面端与网页端不等价 | [桌面端](/zh/desktop/) |
| 世界真相与历史在哪 | [Realm](/zh/realm/) |
| 形体化 AI 呈现的边界 | [Avatar](/zh/avatar/) |
| LocalAgent Memory 与 Knowledge 在哪 | [Runtime Memory 与 Knowledge](/zh/runtime/memory-and-knowledge) |
| Canonical-authority 工具与宿主无关包 | [Nimi Coding](/zh/nimicoding/) |
| 跨域术语 | [术语表](/zh/reference/glossary) |

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
