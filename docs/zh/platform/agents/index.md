# 角色（Character）与运行态智能体（LocalAgent）

角色（Character）是 Nimi 虚拟生态中具备持久身份认同的参与实体。一个角色拥有全局唯一的身份标识：无论置身于哪一个数字世界、参与哪一段互动对话，其核心设定与人格特质始终保持一致，并由 Realm 统一权威持久化。

LocalAgent 则是 Runtime 将静态角色定义在本地设备上实例化为可交互运行态的标准机制。当用户开启一段体验时，Runtime 读取 Realm 签发的结构化角色源描述（Character Source），在本地设备上启动并调度该智能体。LocalAgent 负责维护本次运行期间的实时会话上下文与执行状态，而角色的核心身份定义始终安全地保存在 Realm 中。

核心概念清晰划分：
- **Character（角色）**：由 Realm 维护的持久化实体，拥有关系图谱、世界归属与核心设定。`PersonaCharacter` 与 `WorldCharacter` 是角色的具体业务形态，而非不同的底层智能体类型。
- **Character Source（角色源描述）**：由 Realm 签发的标准化数据契约，定义了 Runtime 实例化角色所需的人格与基础属性。
- **LocalAgent（本地运行态智能体）**：Runtime 在本地为当前用户启动的执行实例。Runtime 负责管理其完整的生命周期、会话上下文、记忆检索通道、模型路由、就绪检测、Token 预算及运行状态。

在 Character 与 LocalAgent 之间，不存在额外的平台级抽象层（如冗余的 `Agent`、`AgentFamily` 或 `AgentPersona`）。

## 系统权威与职责边界

Realm 是角色持久身份的单一可信源：角色的本质定义、跨场景好友关系、所在数字世界列表以及各项源描述，均归口 Realm 治理。Runtime 仅基于 Realm 签发的 Character Source 实例化 LocalAgent，绝不篡改或接管 Realm 的权威数据。

第三方应用、Nimi Home 桌面宿主以及 Avatar 渲染系统仅能访问当前安全会话明确授权的数据范围。上层界面无法伪造 LocalAgent 身份，不能依据前端本地历史臆造运行时状态，也无法获取 Realm 核心凭证、大模型服务商 API Key 或账号下的未授权智能体全量列表。

Avatar 负责接收并渲染 Runtime 投递的结构化视觉动作指令，独立维护视线追踪与模型网格等局部渲染状态。Avatar 不参与 LocalAgent 的决策循环，亦不直接调度底层推理模型。

## 专题索引

- [会话锚点（Conversation Anchor）](./conversation-anchor)
- [跨界面连续性（Cross-Surface Continuity）](./cross-surface-continuity)
- [LocalAgent 访问控制与应用授权](./participation-authority)
- [跨世界身份连续性（Cross-World Identity）](./cross-world-identity)
- [外部智能体与生态接入（External Participation）](./external-agents)

> [!NOTE]
> 长期记忆由 Cognition 系统按智能体独立管理；Runtime 仅作为授权数据调度的中介通道。当前版本的知识库系统（Knowledge V1）未开放公共调用接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
