# 用户画像

本章根据不同读者的技术背景与角色需求，提供相应的阅读路径。各路径之间相互引用，便于横向查阅。

## 初次接触者

如果您初步了解 Nimi，并希望快速评估平台的技术定位与适用场景：

1. [平台 → 愿景](/zh/platform/vision)：了解项目的核心目标与架构定位。
2. [平台 → 六条基础协议](/zh/platform/protocol)：了解跨越不同“世界”的核心技术契约，这是 Nimi 作为平台的基础。
3. [平台 → 架构](/zh/platform/architecture/)：查看跨越核心层的架构全景图，明确组件的权责归属。
4. [Nimi Coding → 概览](/zh/nimicoding/)：了解 Nimi Coding 这一套 AI 驱动的开发方法论。
5. [参考 → 术语表](/zh/reference/glossary)：阅读过程中的术语对照表。

通过此路径，您将能够清晰概述 Nimi 平台的核心功能与架构理念。

## 世界创作者

如果您的目标是架构并发布一个数字世界（包括规则、设定、Agent 及场景）：

1. [平台 → 愿景](/zh/platform/vision)：了解 Nimi 架构中“世界”的定义。
2. [Realm](/zh/realm/)：掌握数字世界底座的三大核心要素：语义真相、世界状态及历史轨迹。
3. [参考 → 世界字段](/zh/reference/world-fields)：在数据字段层面查看规范对“世界”的具体定义。
4. [参考 → 六条基础协议](/zh/reference/six-primitives)：理解您的世界在跨域交互时必须遵守的基础契约。
5. [Realm → 创作者经济](/zh/realm/creator-economy)：了解跨世界的创作者经济模型与价值流转规则。

## 应用开发者

如果您计划使用 Nimi SDK 构建应用：

1. [Start → 创建 Nimi App](/zh/start/create-an-app)：用 app-tools scaffold 一个开发者 App，或把同样的所有权规则映射到已有 App。
2. [SDK → 第一次 AI 调用](/zh/sdk/first-ai-call)：通过 AIConfig target resolution 发起 Runtime-backed 文本生成。
3. [SDK → 概览](/zh/sdk/) 与 [SDK → 边界](/zh/sdk/boundaries)：在导入 SDK module 前理解公开 App 边界。
4. [平台 → 在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)：复用共享 UI、shell、auth、telemetry、model configuration 与 feature surfaces。
5. [Start → 把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference)：研究具体 reference app 与 app-tools source template。
6. [Start → 故障排查](/zh/start/troubleshooting)：理解 Runtime、SDK、Tester 与 scaffold 失败。

## AI Agent 接入方

如果您计划将外部或本地的 AI 宿主接入为 Nimi 世界中的独立参与者：

1. [平台 → 愿景](/zh/platform/vision)：了解将 AI Agent 视作平台“参与者”的设计理念。
2. [平台 → 外部 Agent](/zh/platform/agents/external-agents) 与 [平台 → 参与权限](/zh/platform/agents/participation-authority)：查阅外部第三方 Agent 接入的安全与参与模型。
3. [Runtime → 委派能力](/zh/runtime/delegated-capability)：了解接入网关架构及相关输出防火墙机制。
4. [参考 → Agent 字段](/zh/reference/agent-fields)：查看 Agent 的内部数据结构及涉外的核心属性。
5. [参考 → 状态机](/zh/reference/state-machines)：掌握委派 Provider 机制及委派会话状态机模型。

## Nimi Coding 采用者

如果您希望将 Nimi Coding 方法论引入自有开发流程中：

1. [Nimi Coding → 概览](/zh/nimicoding/)：宏观了解该方法论及其对应的 npm 软件包。
2. [Nimi Coding → 白皮书](/zh/nimicoding/whitepaper)：查阅支撑该方法论的工程治理理论基础。
3. [Nimi Coding → 议题工作流](/zh/nimicoding/topic-workflow)：了解从 Topic 创建、Wave 发起，历经 Packet 编排、Preflight 预检，至最终 Closeout 的完整闭环流程。
4. [参考 → 禁止主张](/zh/reference/forbidden-claims)：了解开发规范中对“反模式”与“走捷径”做法的严格限制。
5. [参考 → 状态机](/zh/reference/state-machines)：了解保障协作流程有序推进的 Topic 及 Wave 状态机机制。

## 审计与评审人员

如果您负责依据权威基准对平台代码或主张进行评审和溯源：

1. [参考 → 规范地图](/zh/reference/spec-map)：查看公开文档与底层技术契约之间的映射关系。
2. [参考 → 权威域](/zh/reference/authority-domains)：核查系统中各项数据与权力的最终归属。
3. [参考 → 术语表](/zh/reference/glossary)：利用统一的术语体系对齐技术语义。
4. [Nimi Coding → 议题工作流](/zh/nimicoding/topic-workflow)：审查工作产物（如 `topic.yaml`、Packet 存档、预检及审计报告）的组织标准与约束条件。

## 来源依据

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
