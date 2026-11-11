# 平台架构概览

Nimi 构建面向移动端、Web、PC、嵌入式与智能家居的用户可控 AI 底座。当前通过可安装的个人 AI 产品和 App 生态交付：PC Runtime 执行本地与云端 AI，Desktop、Web 和 Android 通过各自正式载体消费能力。应用工具、创作、角色陪伴与世界体验都在这一基础上展开。

Nimi Home 是用户的统一交互入口，当前由桌面客户端承载。它负责呈现完整的沉浸式体验，并作为连接底层各系统的产品中枢。系统由以下核心模块协同构成：

- **Realm**：维护整个生态的持久化身份网络，包括角色资产、好友社交关系、数字世界设定以及世界内的权威状态数据。
- **Runtime**：本地与跨端 AI 执行引擎。它将 Realm 中的角色定义在本地设备上实例化为 LocalAgent，并统一调度本地模型（如 Ollama、llama.cpp）与各云端模型服务。
- **SDK**：为上层应用（Apps）调用 Runtime 与 Realm 核心能力提供统一、类型安全且带受控权限的客户端接口。
- **Avatar**：负责角色在屏幕上的形体具身呈现（包括 Live2D 与 3D VRM 形象、视线追踪与情绪动作），专注于视觉交互表现，不越界管理底层 AI 决策。
- **Kit**：提供跨端共享的高保真 UI 组件库，在应用界面需要保持设计一致性时引入。

这些模块在架构设计上被严格解耦：负责角色持久身份认同的系统，无需绑定具体的 AI 运行环境或图形渲染管线。正因如此，同一个角色可以在不同的客户端界面与数字世界中始终保持身份的一致性与连贯性。

## Character（角色）与 LocalAgent（运行态智能体）

用户在 Realm 中创建或选择一个角色实体（Character）。Realm 负责签发一份结构化的角色源描述（Character Source）；Runtime 则根据这份定义，在用户本地设备上将其初始化并运行为专属于当前用户的本地智能体（LocalAgent）。LocalAgent 在交互过程中可以读取 Realm 共享的世界上下文，但绝不会反向篡改或接管角色的核心身份定义与世界的客观状态——这些事实始终受 Realm 权威保护。

App 通过 SDK，经已验证的本机 Host 会话或已准入的远程连接访问能力，每次调用仍由 Runtime 核对当前身份与操作权限。远程来源首次使用还需用户在 Home 确认；这不授予通用账号凭据、模型服务密钥或对其他 App 私有数据的访问权，应用也不能越权遍历账号下的智能体清单。

详见 [Character 与 LocalAgent](/zh/platform/agents/) 以及 [Realm 与 Runtime 同侪架构](/zh/platform/architecture/realm-runtime-siblings)。

## 六大核心协议原语

平台定义了六大核心协议原语（Protocol Primitives），用于规范跨系统、跨世界之间传递的操作语义，确保任何一方都不会越权篡改另一方的权威数据：

- **Timeflow（时序流转）**：跨世界的进程推进与时间节奏定义。
- **Social（社交网络）**：跨场景的社交关系与交互语义。
- **Economy（价值经济）**：道具价值、凭证交换与经济状态。
- **Transit（状态迁移）**：角色与玩家跨世界或跨上下文的穿梭迁移。
- **Context（情境共享）**：交互环境与场域上下文定义。
- **Presence（在场状态）**：主体在特定场景中的在场判定与交互准入。

详见 [平台协议](/zh/platform/protocol) 与 [受控操作执行机制](/zh/platform/execution-protocol)。

## 当前产品与开发边界

当前 Nimi 的核心产品闭环涵盖 Realm、Runtime、SDK、Nimi Home 以及各独立 App。通用的复杂工作流编排（Workflow）、外部协议扩展（MCP）、自主世界演化（World Evolution）、公共应用市场（Marketplace）与商业结算等扩展能力，均不是运行当前核心闭环的前置依赖。未来生态扩展将在保持现有架构边界安全的前提下按需引入。

应用开发与验收使用 Desktop 监管的 Electron 宿主，具体步骤见 [创建 Nimi App](/zh/start/create-an-app)。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
