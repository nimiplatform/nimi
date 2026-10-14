# 用户画像与阅读路径

本指南根据不同读者的技术背景与核心目标，提供针对性的文档阅读路径。各路径之间相互交叉引用，便于横向拓展查阅。

## 平台初探者

如果您希望快速了解 Nimi 的技术定位、解决的核心问题与适用场景：

1. [平台 → 愿景](/zh/platform/vision)：了解项目的核心设计理念与架构目标。
2. [平台 → 核心协议](/zh/platform/protocol)：了解跨越不同“世界”的核心技术契约，这是 Nimi 平台互联的基础。
3. [平台 → 架构体系](/zh/platform/architecture/)：查看核心架构全景图，了解各层组件权责划分。
4. [Nimi Coding → 概览](/zh/nimicoding/)：了解仓库中使用的规范治理与规范驱动开发工具。
5. [参考 → 术语表](/zh/reference/glossary)：查阅核心概念与统一术语对照。

完成此路径后，您将建立起对 Nimi 架构体系与核心能力的整体认知。

## 数字世界创作者

如果您的目标是设计并发布一个数字世界（包括世界观规则、设定、角色与交互场景）：

1. [平台 → 愿景](/zh/platform/vision)：了解 Nimi 体系中“数字世界”的定义。
2. [Realm 核心](/zh/realm/)：掌握数字世界底座的三大要素：权威状态、实体关系及历史轨迹。
3. [参考 → 世界字段规范](/zh/reference/world-fields)：在数据结构层面查阅对“世界”的具体定义与字段要求。
4. [参考 → 六条基础协议](/zh/reference/six-primitives)：理解您的世界在跨域交互时遵循的基础通信与数据契约。
5. [Realm → 创作者经济](/zh/realm/creator-economy)：了解跨世界的创作者权益、数字资产与价值流转模式。

## 应用开发者

如果您计划使用 Nimi SDK 开发桌面端或 Web 应用：

1. [快速入门 → 创建 Nimi App](/zh/start/create-an-app)：使用 App Tools 脚手架快速搭建现代应用工程。
2. [SDK → 第一次 AI 调用](/zh/sdk/first-ai-call)：通过能力意图发起文本生成调用，交由 Runtime 统一调度本地与云端模型。
3. [SDK → 概览](/zh/sdk/) 与 [SDK → 架构边界](/zh/sdk/boundaries)：理解公开应用边界与各模块职责划分。
4. [平台 → 在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)：复用平台提供的 UI 组件、认证会话、AI 配置面板与监控能力。
5. [快速入门 → 使用 Nimi Lab](/zh/start/use-nimi-lab)：参考官方实验台中的能力集成范式与最佳实践。
6. [快速入门 → 故障排查](/zh/start/troubleshooting)：定位并解决开发调试过程中的常见问题。

## AI Agent 与服务接入方

如果您计划将外部或本地的大模型、智能体作为独立参与者接入 Nimi 世界：

1. [平台 → 愿景](/zh/platform/vision)：了解将 AI Agent 视作平等参与者的设计理念。
2. [平台 → 外部 Agent](/zh/platform/agents/external-agents) 与 [平台 → 参与权限](/zh/platform/agents/participation-authority)：查阅第三方智能体接入的安全规范与授权模型。
3. [Runtime → 委派能力](/zh/runtime/delegated-capability)：了解接入网关架构与安全隔离沙箱机制。
4. [参考 → Agent 字段规范](/zh/reference/agent-fields)：查看智能体的数据结构、能力声明及交互属性。
5. [参考 → 状态机模型](/zh/reference/state-machines)：掌握会话生命周期与委派执行的状态流转过程。

## 规范工程与工具链实践者

如果您希望将规范驱动开发与权威约束（Nimi Coding）引入自有团队或项目中：

1. [Nimi Coding → 概览](/zh/nimicoding/)：了解规范治理工具的设计理念与适用边界。
2. [Nimi Coding → 宿主环境集成](/zh/nimicoding/installation)：了解项目中受管文件的组织方式与同步工作流。
3. [Nimi Coding → CLI 参考手册](/zh/nimicoding/cli-reference)：查阅受支持的校验、格式化与分析命令。
4. [参考 → 架构约束与反模式](/zh/reference/forbidden-claims)：了解开发规范中明确禁止的反模式与设计红线。

## 架构审计与安全评审人员

如果您负责对系统的安全性、权威状态归属及契约遵从性进行审查：

1. [参考 → 权威域划分](/zh/reference/authority-domains)：核查系统中各项数据与状态判定的最终归属权。
2. [参考 → 统一术语表](/zh/reference/glossary)：对齐系统架构与安全模型中的专业术语。
3. [Nimi Coding → CLI 参考手册](/zh/nimicoding/cli-reference)：运行权威诊断与合规性检查命令。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
