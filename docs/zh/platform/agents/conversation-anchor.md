# 会话锚点机制（Conversation Anchor）

会话锚点（Conversation Anchor）是用户与指定 LocalAgent 之间特定会话上下文的全局唯一标识。它由 Runtime 权威签发，是后续跨界面、跨进程定位并接续该段对话的唯一合法凭据。

会话锚点不是 LocalAgent 的身份 ID，绝不能通过 UI 路由参数、Avatar 具身实例 ID、前端本地消息缓存或最近活跃的智能体状态进行猜测或拼接。

会话的开启、轮次提交、状态快照、异常恢复与打断中断，均由 Runtime 统一管控并对外暴露标准化视图。每个 LocalAgent 对应唯一的活跃主会话上下文：首次打开时建立，后续所有获得授权的调用者均接入相同的已提交会话连续性。调用方应当妥善保存 SDK 返回的 Runtime 会话锚点，将其作为连续性验证凭据；会话锚点不用于隔离应用私有分支或窗口私有历史。

## 会话创建与状态恢复

调用方通过 SDK 提交结构化的操作意图并声明目标智能体引用。在创建或恢复会话前，Runtime 会依据当前活跃的安全会话严格核验用户账号、应用身份、授权策略以及对目标 LocalAgent 的访问权限。

会话的状态恢复完全依赖 Runtime 维护的锚点索引与内存快照。前端本地存储的消息记录仅充当 UI 渲染缓存：它无法作为状态证明，更无法反向重构会话流、长期记忆或知识库的真实上下文。

## 视图投影与安全边界

获得授权的调用方可以订阅当前会话中已提交的对话轮次与状态更新。而大模型服务商的原始 Token 序列、解析器底层数据、认证凭据、系统级引导词（System Prompt）以及 Runtime 内部鉴权上下文始终保持私有隔离。

Avatar 渲染模块可以将虚拟角色的 2D/3D 形象实例挂载到已授权的会话锚点上以进行动作呈现。Avatar 的启动实例 ID 与渲染器管线状态既无法创建会话，也不能作为会话存在的有效证明。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
