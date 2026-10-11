# Agent 呈现输入与语音关联

正式 App 通过 SDK 的 embodiment 客户端读取和订阅有界的 Agent 呈现数据。Runtime 提供语义与时序，Avatar 负责将这些输入转换为模型动作、表情和本地播放。

## 通用呈现事件

当前事件类型为 activity、emotion、posture 和 voice-timing。语音时序包含时长、截止时间及轮次关联等信息，不携带渲染器口型权重、viseme/phoneme 帧、骨骼曲线或播放指令。

调用需使用当前 App 会话的 `agentHandle` 与确切的 `conversationAnchorId`。Runtime 按当前会话、访问声明与操作校验结果，返回可读取的快照和更新。

## Avatar 的最终语音播放

1. Conversation 提交最终语音 sidecar，其中包含语音产物引用。
2. Avatar 使用自己会话的 Agent handle 和对话锚点，通过 `conversation.readArtifact` 读取该产物。
3. Avatar 在本地播放音频并分析口型，再由选中的 Live2D 或 VRM 后端呈现。

Avatar 本地发出的 audio_chunk 事件可以携带已读取的完整产物字节；这个名称不表示 Runtime 给 Avatar 提供原生语音流。独立 Realtime 媒体与一般语音生成有各自的 API 和准入条件。

## 消费端职责

Desktop 将会话结果及本地输入、播放状态用于轻量提示。Avatar 独立消费自己获准读取的数据，不依赖 Desktop 把缓存或口型帧转发给它。渲染器状态和播放进度不会反向改写 Runtime 的对话或 Agent 语义。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`proto/runtime/v1/agent_presentation.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/agent_presentation.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
