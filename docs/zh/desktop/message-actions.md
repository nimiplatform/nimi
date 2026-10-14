# Agent 对话操作

Agent Chat 用于打开所选 Agent 在 Runtime 中托管的权威对话（Conversation）。已提交的对话轮次可在任何已授权界面中同步读取；尚未提交的输入草稿与待发送内容则仅保留在当前窗口本地。

## 发送文字或图片

输入文字并发送即可开启一轮对话。当前输入框每轮最多支持附加一张图片（实际能否处理取决于该 Agent 配置的能力），文件选择器与剪贴板粘贴仅接受图片 MIME 类型。

如需讨论文档或代码，请将相关文本直接粘贴到消息框中。当前输入框不支持将 PDF、Markdown 或源代码文件作为附件上传。

## 停止与恢复

Agent 生成回复期间，界面会实时流式更新文本。点击「停止」可向 Runtime 请求中断生成。此前已提交的消息会完整保留在对话中，但中断生成不会撤销已执行完毕的外部操作。

断线重连后，界面会重新加载 Runtime 中已提交的对话快照。未完成的生成片段或前端本地缓存并不代表该轮对话已成功提交；如需修正或补充先前的回答，请直接发送新消息继续对话，而不要尝试覆盖历史记录。

## 区分对话模式

用户之间的消息通信基于 Realm 线程管理；普通 AI / Nimi Chat 则使用独立的请求与存储链路，其交互控件不包含 Agent 对话的流式生成与「停止（Stop）」中断控制。详见[对话模式](/zh/desktop/chat)。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
