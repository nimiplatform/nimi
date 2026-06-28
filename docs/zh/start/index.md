# 起步

请选择适合您当前角色的阅读路径。每条路径均从平台模型出发，逐步深入至相应的技术实现。

如需查看针对特定受众的详细路径，请参阅 [用户画像](/zh/start/personas)。了解已开放安装的组件及其获取方式，请参阅 [安装与可用性](/zh/start/install)。如果你要创建 App，从 [创建 Nimi App](/zh/start/create-an-app) 开始。如果 SDK 调用、Tester lane 或生成的 App scaffold 失败，用 [故障排查](/zh/start/troubleshooting) 将可见错误映射到负责它的公开表面。

## 首次接触 Nimi

建议按照以下顺序阅读：

1. [平台](/zh/platform/)：了解产品模型、以“世界”为核心的基础概念，以及跨域的六项基础协议。
2. [Runtime](/zh/runtime/)：了解 AI 任务的实际调度与执行机制。
3. [SDK](/zh/sdk/)：掌握应用接入 Nimi 平台的标准化边界与集成规范。
4. [桌面端](/zh/desktop/)：了解第一方原生外壳（Shell）；网页端的差异请参阅 [Web 模式](/zh/desktop/web-mode)。
5. [Realm](/zh/realm/)：理解语义真相、世界状态以及不可篡改的世界历史。

该路径旨在帮助构建全局的心智模型，随后深入实现细节，厘清平台架构、AI 执行流程及应用交互方式。若遇生僻术语，可查阅跨章节通用的[术语表](/zh/reference/glossary)。

## 评估项目架构

如果您正在评估本项目架构与核心价值，建议按照以下顺序阅读：

1. [平台愿景](/zh/platform/vision)：项目核心目标与产品定位。
2. [平台架构](/zh/platform/architecture/)：明确各组件权责边界的跨层架构图。
3. [Runtime 概览](/zh/runtime/) 与 [Runtime 工作流](/zh/runtime/workflows)：底层 AI 执行引擎的核心职责。
4. [SDK 概览](/zh/sdk/) 与 [SDK 边界](/zh/sdk/boundaries)：外部应用接入平台时需遵守的规范与边界。
5. [Nimi Coding 白皮书](/zh/nimicoding/whitepaper)：本项目中 AI 辅助工程的治理范式。

上述内容的阅读量大致相当于一篇技术文章，能清晰呈现 Nimi 当前架构的全貌。

## 基于平台进行构建

如果需要新的开发者仓库，从 [创建 Nimi App](/zh/start/create-an-app) 开始。如果是从已有 App 接入，先读 [SDK](/zh/sdk/) 与 [Runtime](/zh/runtime/)。SDK 是应用与平台交互的官方途径。应用代码不应跨越 Runtime 与 Realm 的私有边界。

如果眼前任务只是从 TypeScript App 发起一次 Runtime-backed 文本生成，在 Runtime 已运行后读 [第一次 AI 调用](/zh/sdk/first-ai-call)。

如果需要一个具体 reference app，读 [把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference)。共享 UI、auth、shell、telemetry 与 model configuration 先读 [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

如果本地运行、SDK 调用或 app-tools scaffold check 失败，先读 [故障排查](/zh/start/troubleshooting)，再决定是否修改 App 代码。

了解原生外壳的具体行为，请查阅 [桌面端](/zh/desktop/)。关于网页端的受限呈现模式，请研读 [Web 模式](/zh/desktop/web-mode)。网页端不会自动继承桌面端的原生扩展能力。

## 采用 Nimi Coding 方法论

Nimi Coding 作为独立于宿主环境的方法论，已作为标准 npm 软件包发布。建议按照以下顺序了解：

1. [Nimi Coding 概览](/zh/nimicoding/)：核心范式及软件包的整体构成。
2. [议题工作流](/zh/nimicoding/topic-workflow)：涵盖 Topic、Wave、Packet、Preflight、Audit 至 Closeout 的生命周期。
3. [安装指南](/zh/nimicoding/installation)：软件包的安装步骤与采纳路径。

## 场景：应用开发者的阅读路径

假设您是一名新接触 Nimi 的应用开发者，推荐的首次阅读路径如下：

1. 阅读 [平台](/zh/platform/)，确立“世界”而非“会话”是平台核心运转对象的基础认知。
2. 阅读 [Runtime](/zh/runtime/)，理解 Provider 调度、工作流、流式传输及多模态产物等逻辑均由 Runtime 契约统筹，而非应用代码。
3. 阅读 [SDK](/zh/sdk/)，掌握如何通过 root `@nimiplatform/sdk` client、`@nimiplatform/sdk/runtime`、`@nimiplatform/sdk/realm`、feature module 与独立 adapter package 合规消费底层能力，避免直接导入私有模块。
4. 写 app-local shell、model config 或共享 UI 前，阅读 [创建 Nimi App](/zh/start/create-an-app)、[把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference) 和 [在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。
5. Runtime、SDK、AIConfig 或 scaffold check 失败时，保持 [故障排查](/zh/start/troubleshooting) 打开。
6. 阅读 [桌面端](/zh/desktop/) 与 [Web 模式](/zh/desktop/web-mode)，明晰两种呈现形态的能力边界差异，以评估其对应用分发计划的影响。
7. 准备进行代码贡献时，阅读 [Nimi Coding](/zh/nimicoding/)。处理高风险变更或跨模块重构时，需遵循此标准工作流。

全景阅读完成后，如需查阅具体的技术细节，可借助 [规范地图](/zh/reference/spec-map) 定位到底层技术契约。

## 来源依据

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdks/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
