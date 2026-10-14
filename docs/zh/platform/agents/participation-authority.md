# LocalAgent 访问控制与应用授权

接入应用的客户端通过与宿主安全绑定的 SDK 客户端，查询已获授权访问的智能体引用列表；在发起调用时，提交会话级的不透明句柄 `agentHandle`。原始的 LocalAgent ID、内部绑定对象或本地缓存的句柄，均不能直接作为调用的合法授权凭据。

Runtime 在执行操作前，会基于当前安全会话动态解析并重新核验多维安全边界：用户账号有效性、调用方 App 身份合规性、应用注册声明范围、操作覆盖策略以及会话生命周期代次。一旦连接重置或安全会话轮换，应用必须重新获取合法句柄，严禁通过重放历史业务请求来尝试越权恢复操作。

## 细粒度的操作分级授权体系

系统对智能体的各类操作实施严格的分层隔离：
- **基础交互权限（`agent.local`）**：允许调用基础的会话管理、Agent Realtime 实时交互流、获取角色简介以及接收结构化输出；该权限绝不泄漏智能体私有长期记忆、知识库数据、底层系统提示词（System Prompt）、服务商配置、Avatar 内部状态或账号下的智能体全量列表。
- **共享推理配置权限（`agent.configure`）**：用于更新共享的 LocalAgent 能力意图配置（AIConfig）；属于特权接口，须单独声明并获得显式授权。本机模型配置（Machine Loadout）与机器级模型选择仍由 Nimi Home 与 Runtime 管理界面单独管控。
- **记忆与业务扩展权限**：智能体长期记忆管理与独立应用业务执行，需具备对应独立声明的权限范围，基础的对话交互权限不会隐式附带这些能力。Knowledge V1 目前未开放公共调用接口。

应用层定制的业务指令、专有技能与业务规则，应当使用专用的业务与技能契约进行传递；严禁将其混入日常用户聊天流，更不能借此篡改智能体的核心身份定义。应用对其内部的项目生命周期与执行结果负责。

Nimi Home 与桌面端客户端仅作为应用的宿主容器，不替代 Runtime 核心的鉴权逻辑，亦不接管 Cognition 的记忆所有权。对于不可用或未获授权的操作，系统将直接返回结构化的标准错误，绝不提供绕过安全检查的私有后门通道。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
