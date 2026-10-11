# 平台架构治理与系统边界

Nimi 将持久化身份、数字世界权威状态、AI 运行时执行、图形渲染与应用组合交由不同的系统模块归口管理。产品交互界面可以灵活组合这些能力，但不得跨界接管底层状态的权威所有权（Ownership）。

## 系统权威所有者对照表

| 系统关注点 | 归口负责模块 | 架构与职责边界 |
| --- | --- | --- |
| 数字世界身份、历史与持久化 Character 角色资产 | Realm | Realm 维护全局唯一的持久化角色身份与跨世界社交图谱 |
| LocalAgent 运行态执行、会话流与记忆调度 | Runtime | Runtime 负责在本地设备上实例化并运行智能体，调度模型推理 |
| 长期记忆与认知归档 | Cognition | 长期记忆由 Cognition 按智能体独立管理；Knowledge V1 暂未开放 |
| 跨端类型安全的受控调用接口 | SDK | 面向应用暴露结构化 API，执行调用权限校验与输入过滤 |
| 官方桌面端产品界面与应用中枢 | Nimi Home / Desktop | 负责沉浸式产品交互呈现与组件编排，不持有底层权威数据 |
| 角色具身形体与视觉渲染 | Avatar | 负责 2D/3D 模型渲染、面部表情与动作管线，不管理 AI 逻辑 |
| 跨端共享的可复用 UI 原语 | Kit | 提供设计一致的高保真组件，不承载独立的业务状态 |

Character 与 LocalAgent 最能清晰体现这一治理原则：
- **Realm** 拥有静态、持久的 Character 角色定义；
- **Runtime** 负责在用户本地设备上将其初始化为具备独立运行态的 LocalAgent。

桌面端的本地存储（Desktop Store）、Avatar 具身实例或应用内部的绑定映射均可引用上述实体，但绝不会成为第三种独立的身份所有者。

## 应用程序权限边界

应用通过 SDK 基于当前活跃的安全会话和自身应用身份获得受控的 Runtime 能力。第三方应用无需且无法获取 Realm 核心 Token，也无需维护 Runtime 内部密钥。应用对数字世界的访问均经由经过验证的 SDK 接口或宿主代理，而会话调度与记忆路由始终由 Runtime 统一提供。

Nimi Home 作为官方桌面宿主，负责将各个模块的能力有机组装为完整的用户产品体验。替换或重构宿主界面，不会影响底层各模块的数据权威与持久化状态。

## 渐进式演进与非阻塞边界

通用的工作流编排（Workflow）、外部协议扩展（MCP）、自主世界演化（World Evolution）、公共应用市场（Marketplace）与商业结算等扩展能力，均不是当前本地个人 AI 核心闭环的前置依赖。相关未来设计在架构所有者与启用边界明确前保持独立隔离。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
