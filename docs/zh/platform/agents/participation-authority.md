# LocalAgent 访问与 App 授权

正式 App 通过受保护、绑定宿主的 SDK 客户端列出获准访问的 Agent 引用，再把返回的会话级不透明 `agentHandle` 用于已准入操作。原始 LocalAgent ID、稳定绑定或缓存引用都不是操作权限。

Runtime 推导并重新验证账号、App 主体、当前注册和声明、操作覆盖、目标访问及会话代次。重连或会话轮换后需要重新取得已授权引用；不能通过重放上一次业务动作来恢复访问。

## 操作类别分别授权

普通 `agent.local` 访问提供有限的 Conversation 与 Agent Realtime 操作、来源简介和强类型输出，不暴露私有 Memory、Knowledge、提示词、Provider 配置、呈现内部状态或账号全部 Agent 清单。

共享 LocalAgent 配置需要 `agent.configure`。Agent Memory 管理、独立 App 业务执行各自需要对应操作及声明覆盖；对话访问不会自动授予它们。Knowledge V1 没有公共操作路径。

App 编写的业务指令与技能走专门的业务/技能契约，不能作为普通聊天提交，也不能变成 Agent 身份。项目工作流和结果保存由 App 负责。

Nimi Home 与 Desktop 承载 App，但不替代 Runtime 授权或 Cognition 记忆 ownership。不可用或未授权的操作返回真实强类型失败，不通过私有接口回退。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
