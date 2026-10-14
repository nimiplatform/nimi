# Agent 呈现输入与语音关联

正式应用（App）通过 SDK 的 embodiment 客户端读取和订阅有界的 Agent 呈现数据。Runtime 提供语义与时序；Avatar 负责将这些输入映射为模型动作、表情和本地播放。

## 通用呈现事件

当前的事件类型包括 `activity`、`emotion`、`posture` 与 `voice-timing`。语音时序（voice-timing）包含时长、截止时间及对话轮次关联信息，不包含渲染器口型权重、viseme/phoneme 帧、骨骼曲线或播放指令。

调用需传入当前应用会话的 `agentHandle` 与确切的 `conversationAnchorId`。Runtime 在完成会话状态、声明权限与操作类型的校验后，返回已准入的快照或更新。

## Avatar 最终语音播放流程

1. Conversation 提交包含产物引用的最终语音 sidecar。
2. Avatar 使用自身会话的 Agent handle 和对话锚点，通过 `conversation.readArtifact` 读取该产物。
3. Avatar 在本地播放并分析音频，再通过选定的 Live2D 或 VRM 后端进行动作呈现。

Avatar 本地发出的 `audio_chunk` 事件可以携带已读取的完整产物字节；该名称并不代表 Runtime 提供原生音频流。独立准入的 Realtime 媒体与通用语音生成拥有独立的 API 和准入前置条件。

## 消费端职责划分

Desktop 将 Conversation 结果与本地输入或播放状态用于轻量级交互反馈。Avatar 独立消费自身会话已获准读取的数据，Desktop 不会为其转发缓存的会话状态或口型帧。渲染器内部状态和播放进度不会反向改写 Runtime 的对话或 Agent 语义。

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`proto/runtime/v1/agent_presentation.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/agent_presentation.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
