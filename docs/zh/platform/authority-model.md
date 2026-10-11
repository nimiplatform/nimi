# 权威所有权模型（Authority Model）

Nimi 将持久化身份、运行时执行、应用宿主与界面渲染清晰解耦，确保各类前端视图与派生状态不会越界成为单一可信源（Single Source of Truth）。

关于系统字段级别的所有权详细对照，请参阅 [参考手册 → 权威域划分](/zh/reference/authority-domains)。

## 核心系统职责与所有权划分

| 系统职责 | 权威所有者（Owner） | 职责与架构边界 |
| --- | --- | --- |
| 账号级 AI 角色身份 | Realm `Character` | Realm 拥有持久化身份定义、跨世界关系与形象资产 |
| 本地 AI 运行态实例化 | Runtime `LocalAgent` | Runtime 将 Character 定义在本地设备上实例化并调度执行 |
| 长期记忆与知识归档 | Cognition | 长期记忆由 Cognition 按智能体独立管理；Knowledge V1 暂未开放 |
| 会话流与记忆调度 | Runtime | 统一管理活跃会话与记忆路由；应用消费该服务而不接管其数据 |
| 数字世界状态与事件历史 | Realm | Realm 维护世界权威状态；Runtime 与应用使用受控的投影接口 |
| 应用调用鉴权 | Runtime 安全会话 | 基于活跃登录会话与应用身份自动推导权限，无需应用自建鉴权 |
| 产品界面与宿主编排 | Nimi Home 及各宿主 | 宿主仅负责界面编排与组件组合，不承载底层数据所有权 |
| 具身形象与图形渲染 | Avatar | Avatar 负责动作与形体渲染投影，不干涉角色与智能体的决策逻辑 |

`Character` 与 `LocalAgent` 关系紧密但不可混淆：
- **Character** 是 Realm 中全局持久的静态身份与角色设定；
- **LocalAgent** 是 Runtime 在用户本地设备上创建的可执行运行态实体。

应用可以通过官方标准接口持有两者的引用，但任何中间状态、UI 视图或绑定对象绝不能演变为第三种独立的身份所有权源头。

## 应用程序的访问受限机制

第三方应用通过 SDK 从当前安全会话与应用唯一标识（App Identity）中获取受控的 Runtime 能力。通过标准脚手架创建的应用不直接暴露 Realm JWT，也无需自行维护 Runtime 底层凭证。应用对 Realm 的数据交互经由经过验证的 SDK 接口进行，而底层模型推理、会话历史与记忆路由始终由 Runtime 统一管控。

直接使用 SDK 与使用脚手架构建独立应用是两种标准的工程接入方式，而非用户层面的产品配置。Kit 仅为实际应用场景提供可复用的高质量 UI 组件，不为了所谓“体系完整性”而过度预建未经验证的公共组件。

## 宿主与视图投影边界

Nimi Home 是当前官方提供的桌面级产品宿主。它可以组合 Runtime、Realm、SDK、Kit 与 Avatar 各系统的界面与能力，但绝不会替代或侵夺这些子系统的权威所有权。桌面客户端的外壳状态、Avatar 的图形投影以及自动生成的配置数据，均属于下层权威数据的消费方或只读投影。

面向未来的应用公共分发网络与世界绑定机制，在不发生冲突的前提下保持架构隔离，它们并非运行当前本地个人 AI 核心闭环的前置条件。

## 受控的外部扩展能力

外部委派操作属于可选的能力扩展边界。即便启用，也必须遵循最小权限原则与默认拒绝（Fail-Closed）安全策略；通用的工作流编排（Workflow）、外部协议扩展（MCP）、自主世界演化、公共应用目录与商业结算均非当前 Runtime 闭环的前置。

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
