# Agent 对话操作

Agent Chat 打开所选 Agent 由 Runtime 管理的对话。已提交的消息可以从其他已授权界面读取；草稿和待发送内容属于当前窗口。

## 发送文字或图片

输入文字并发送，即可开始一轮对话。当前输入框每轮最多附加一张图片，具体能否执行还取决于 Agent 已配置的能力。文件选择器和粘贴处理只接受图片类型。

需要分析文档或代码时，可将相关文字粘贴到消息中。这个输入框不支持把 PDF、Markdown 或代码文件作为文档附件上传。

## 停止与恢复

Agent 生成过程中，界面显示文字更新。点击停止会请求中断；已提交的消息仍然保留，也不会撤回此前已经完成的外部操作。

连接恢复后，重新读取 Runtime 中已提交的对话快照。待提交片段或本地缓存不能证明这一轮已经保存。需要修正之前的回答时，可以发送新的补充说明。

## 区分对话模式

人与人之间的消息由 Realm 管理。普通 AI/Nimi Chat 使用另一套请求和消息保存流程，不具备相同的流式停止行为，详见[对话模式](/zh/desktop/chat)。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
