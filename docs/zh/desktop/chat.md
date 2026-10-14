# 对话模式与消息机制

和朋友聊聊近况，向助手问一个问题，或回到与某位 Agent 的长谈。Nimi Home 将这些体验汇集在同一个入口中，同时各自保留独立的历史记录与交互控制。

## 选择一种对话

| 模式 | 历史存放位置 | 使用方式 |
| --- | --- | --- |
| **好友私信** | Realm 消息线程 | 人与人交流，成员权限、消息投递与已读状态由 Realm 管理。 |
| **基础助手（Nimi Chat）** | 该模式的本地消息存储 | 等待完整回答生成后，再保存本次问答。 |
| **Agent 对话** | Runtime 中该 LocalAgent 的 Conversation | 实时查看流式生成的文字，可随时点击「停止」请求中断。 |

## 接续与 Agent 的对话

选定伙伴后，即可发送文字或受支持的图片。当前输入框每轮最多支持附加一张图片，且所选能力需支持图片输入。

生成过程中点击**「停止」**会请求中断，此前已提交的对话轮次将完整保留，已经完成的外部操作也不会被撤销。断线重连或重新加载后，Nimi Home 会从 Runtime 读取已提交的对话快照；未发送的草稿或未完成的回复片段不代表该轮对话已保存。

Runtime 通过签发会话锚点来维持对话连续性，使同一个 LocalAgent 能在不同已授权界面之间接续同一份持久 Conversation。锚点本身不是访问凭证，也不代表某个话题、地点或新会话。

## 问助手，或给朋友发消息

Nimi Chat 通过 `client.ai.text.generateCandidate` 完成文本润色、代码解释等快捷任务。它会等待完整回答返回，不提供 Agent 对话的流式输出与「停止」按钮；重新打开窗口也不会将待完成的请求变成已提交的 Agent 轮次。

好友消息使用 Realm 线程，不会创建 Agent 会话锚点，也不沿用 AI 生成的控制方式。

## 对话与记忆如何保存

LocalAgent 的 Conversation 由 Runtime 管理，启用后的长期记忆由 Cognition 管理，且不同 LocalAgent 的记忆彼此独立。需要注意，本地存储并不意味着推理内容永远不会离开设备——当配置了云端推理时，相关的对话与召回的记忆上下文仍可能发送给所选的云端服务商。

## 延伸阅读

- [智能体对话操作](/zh/desktop/message-actions)
- [录音输入与实时会话](/zh/desktop/voice-session)
- [虚拟形象呈现](/zh/desktop/agent-avatar)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
