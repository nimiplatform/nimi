# Agent 对话操作

Desktop Agent Chat 展示 Runtime 的规范 Conversation。每个 LocalAgent 只有一条 Conversation，由获准访问它的消费者共同延续；打开另一个 App 或窗口仍使用同一历史。

## 当前操作

- 打开已授权 Conversation，读取已提交快照。
- 通过规范 Conversation 操作发送新的用户消息。
- 请求中断当前轮次，并展示实际结果。
- 在界面和当前权限支持时，使用已准入附件、artifact 和语音操作。

当前 Agent Conversation 契约没有重新生成、编辑旧消息或分支操作。通用聊天组件出现这些控件，不会给 Agent Chat 增加操作权限。发送新消息是新一轮，不是修改或重放旧轮次。

## 停止与恢复

流式文本增量只用于临时呈现。Runtime 记录中断后，Desktop 清除该轮未提交的流式文本。已经提交的消息仍保留在规范历史中；例如文本先提交、随后关联动作被中断，Stop 不会删除那条已提交文本。

断线或重新打开后，从 Runtime 已提交快照恢复。不能把缓存的部分回复当成已提交消息，也不能为保留它建立第二份 transcript。Runtime 返回的 anchor 是由具体操作重新核验的连续性条件。

## 区分产品流程

人类聊天历史归 Realm，独立 App 业务工作使用各自准入的 Agent work 操作和项目状态。这些路径都不会给 LocalAgent Conversation 提供隐藏的分支或旧消息改写接口。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
