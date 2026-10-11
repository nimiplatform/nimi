# 对话模式与消息历史

Nimi Home 的聊天界面提供人与人消息、普通 AI/Nimi Chat 和 Agent 对话。三种模式的请求、中断和历史保存方式不同。

| 模式 | 执行与保存方式 | 当前回复行为 |
| --- | --- | --- |
| 人与人消息 | Realm 消息线程 | 消息与已读状态通过 Realm 同步 |
| 普通 AI/Nimi Chat | App 的 AI candidate 请求及该模式的本地消息存储 | 等待完整回答返回，再保存消息 |
| Agent 对话 | Runtime 管理的正式 Conversation | 显示文字更新，并支持请求中断当前轮次 |

## 普通 AI/Nimi Chat

发送问题后，等待完整结果。当前路径使用 `generateCandidate`，没有 Agent 模式的逐 token 显示和停止处理。待完成的请求不是已提交的 Agent 对话轮次，不能假定关闭或重开窗口后会按正式 Conversation 状态接续这次执行。

## Agent 对话

选择 Agent 并打开由 Runtime 管理的对话，发送文字或受支持的图片开始一轮交互。生成过程中，界面显示更新；点击停止会请求中断，不删除此前已提交的消息。

连接恢复或刷新界面后，客户端重新读取 Runtime 中已提交的快照。草稿、待提交片段和界面状态与这份历史分别处理。

## 人与人消息

人与人消息使用 Realm 线程及其成员和投递规则，不创建 Agent 会话锚点，也不使用 AI 生成控件。

## 相关文档

- [Agent 对话操作](/zh/desktop/message-actions)
- [语音交互](/zh/desktop/voice-session)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx)
