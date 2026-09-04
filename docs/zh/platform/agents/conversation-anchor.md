# Conversation Anchor

Conversation anchor 是你和某个 LocalAgent 之间一段具体对话的名字。它由
Runtime 签发，是以后指认这段对话唯一可靠的方式。它不是 LocalAgent 的身
份，也无法从 UI 路由、Avatar 实例、本地对话缓存，或某个界面最近展示过
的 LocalAgent 推断出来。

对话的开启、提交、快照、恢复和中断都由 Runtime 负责，对外的视图也是
Runtime 提供的。一个 LocalAgent 可以有多段对话，所以使用方必须保存好标
准 SDK surface 返回的那个显式 anchor。

## 创建与恢复

调用方提交强类型 intent 和明确的 LocalAgent 目标。Runtime 会先根据当前
会话弄清账号、App 身份、授权，以及所有权或访问权限，然后才创建或恢复
对话。

恢复只依赖 Runtime 保存的 anchor 和快照。本地消息历史只是 UI 缓存：它
证明不了连续性，也重建不出对话、记忆或知识里真正的内容。

## 投影边界

已授权的使用方可以收到当前对话中已提交的轮次和有限状态。原始服务商输
出、解析器负载、凭证、内部 prompt 和 Runtime 内部凭据一律保持私有。

Avatar 可以把一个可见实例挂到已授权的对话上做呈现，但它的 launch ID 和
renderer 状态既不能创建这段对话，也不能证明它。

## 来源依据

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
