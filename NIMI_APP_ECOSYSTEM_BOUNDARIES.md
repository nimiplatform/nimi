# Nimi 生态架构与系统职责边界 (Ecosystem Architecture & Boundaries)

本文档系统性地梳理 Nimi 各核心子系统的职责划分与所有权边界，帮助开发者与架构参与者清晰理解数据流向、权限控制及模块定位。

---

## 核心职责流向

在 Nimi 的体系设计中，一个典型的生态交互遵循清晰的分层调用链条：

$$\text{Realm / Runtime 核心引擎} \longrightarrow \text{SDK 强类型接口} \longrightarrow \text{Kit 共享 UI 组件} \longrightarrow \text{生态应用组装 (App)}$$

| 关注领域 | 权威所有者 (Owner) | 核心职责 |
|---|---|---|
| **角色世界资产与社会关系** | **Realm** | 持久化角色设定 (Character)、虚拟世界规则、长期故事演变、生态身份认证与跨应用社交网络关系 |
| **本地 AI 调度与受保护访问** | **Runtime** | LocalAgent 实例生命周期、本地/云端模型调度中继、会话事件提交、凭据安全托管与受保护 App 访问控制 |
| **长期记忆与知识沉淀** | **Cognition** | 规范的 Agent 长期记忆、上下文溯源、相关性排序与遗忘管理（杜绝 App 私建混乱的长期记忆库） |
| **开发者抽象与通信协议** | **SDK** (`@nimiplatform/sdk`) | 跨进程调用强类型 Client 封装、通信传输中继与面向开发者的工程抽象 |
| **设计系统与基础组件** | **Kit** (`@nimiplatform/kit`) | 跨 App 统一的可复用 UI 控件、设计 Token、无障碍支持、基础认证与 Shell 桥接 |
| **业务场景与用户交互** | **App** (生态应用) | 专注具体用户任务的界面视图、本地轻量业务状态与场景工作流编排 |
| **桌面超级工作台与应用监管** | **Nimi Home（入口）/ Desktop（当前宿主）** | 用户日常使用的统一桌面宿主、应用生命周期监管与本地窗口调度 |
| **角色具身化视觉表现** | **Avatar** | 桌面端 2D/3D 角色立绘与模型渲染表现层（消费状态，不更改 Agent 决策逻辑） |

---

## 角色 (Character) 与 LocalAgent 的关键区分

- **Realm 中的 Character（角色）**：持久化的社会化身份资产，承载世界观设定、性格底色、人设故事与初始属性。
- **Runtime 中的 LocalAgent（运行态智能体）**：由 Runtime 基于有效 Character Source 创建的本地智能体，拥有独立的运行状态与对话（Conversation），可跨应用会话持续存在。其长期记忆由 Cognition 统一管理，由 Runtime 协调受控访问。
- **表现与渲染（App / Avatar）**：前端视图（App）与桌面浮动载体（Avatar）仅作为视觉与交互表现层消费这些状态，严禁在客户端篡改或伪造角色身份真值。

---

## 应用访问权限 (App Access)

Nimi 坚守本地优先与用户数据主权原则：

1. **会话级动态授权**：App 对本地 Runtime 的访问能力由当前受保护会话、App 声明和 Runtime 访问规则共同决定，禁止越权刺探底层系统。
2. **受保护调用与凭据隔离**：标准 App 的渲染层通过宿主会话调用 SDK，不接管 Provider API Key、Realm JWT 或底层特权连接，相关凭据托管与执行均由 Runtime 负责（注：该机制旨在隔离平台凭据与受控能力，并非对 App 一切系统行为的全面沙箱保证）。
3. **受控通道闭合**：应用须通过规范的 SDK 客户端请求受保护操作，严禁绕过受控通道直连底层内部接口。
4. **单向依赖规则**：
   - Desktop / Web 严禁直接依赖 `runtime/internal/*`。
   - SDK 严禁违背设计原则向应用暴露未授权的私有内部数据。

---

## 规范与权威源头 (Source Basis)

当需要查阅或修改具体领域的形式化契约与状态机时，请以 `.nimi/spec/**` 下的权威规范为准：

- [平台生态规范](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [Runtime 应用接入规范](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [Agent 服务模型规范](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [认知与记忆规范](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [SDK 核心抽象规范](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
