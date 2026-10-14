# 平台架构治理与系统边界

Nimi 将持久化身份、世界状态、AI 运行时执行、视觉呈现与应用组合划归不同的系统模块管理。上层产品界面可以灵活组合这些能力，但不会接管底层系统的权威状态所有权。

## 子系统权威归属对照

| 系统关注点 | 权威所有者 | 职责与边界 |
| --- | --- | --- |
| 世界定义、规划中的共享状态/历史契约与持久化 `Character` 资产 | Realm | 维护规范角色身份与跨世界社交图谱 |
| `LocalAgent` 执行、会话状态与记忆路由 | Runtime | 在本地设备上将角色定义实例化为活跃的 `LocalAgent` |
| 长期记忆存储 | Cognition | 按 Agent 独立隔离管理长期记忆；Knowledge V1 当前未启用 |
| 类型安全的公共应用接口 | SDK | 提供强类型契约，执行权限校验与输入验证 |
| 官方产品入口与桌面宿主 | Nimi Home / Desktop | Home 是官方产品入口，当前由 Desktop 承载；负责界面与流程编排，不持有底层权威数据 |
| 角色具身呈现与渲染 | Avatar | 负责 2D/3D 形象、动画与视线追踪，不管理 AI 逻辑 |
| 共享 UI 原语 | Kit | 提供可复用 UI 组件，保证视觉与交互一致性 |

`Character` 与 `LocalAgent` 的分工清晰体现了这一边界：
- **Realm** 持有静态、持久化的 `Character` 定义；
- **Runtime** 在用户本地设备上将该定义实例化为可运行的 `LocalAgent`。

Desktop 本地缓存、Avatar 具身实例或应用层绑定都可以引用这两类实体，但不会成为第三套独立的身份权威。

## 应用隔离与权限边界

应用通过受保护的宿主会话和明确接纳的 SDK 操作使用 Runtime 能力。应用不会获取 Realm 主令牌，也不自行维护 Runtime 私有凭据。对 Realm 实体的访问统一经由通过校验的 SDK 接口完成，而会话状态与记忆路由始终由 Runtime 管控。

Nimi Home 是官方一等产品入口（当前由 Desktop 承载），负责将各子系统能力组装为完整的用户体验。更换或重构宿主外壳不会影响底层权威数据。

## 渐进演进与非阻塞范围

通用工作流编排（Workflow）、外部 MCP 桥接、自主世界演化（World Evolution）、公共应用市场（Marketplace）以及商业结算，都不是当前本地个人 AI 核心闭环的前置依赖。这些能力在明确所有权与启用边界之前保持独立隔离。

> [!NOTE]
> 长期记忆由 Cognition 按 Agent 独立管理，由 Runtime 负责授权召回与更新。Knowledge V1 当前没有开放公共客户端接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
