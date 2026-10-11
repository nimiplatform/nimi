# 语音输入、Realtime 与回复播放

Agent Chat 的录音输入、Realtime 实时媒体和回复播放是三条不同的路径。使用前，先确认语音配置以及界面显示的当前可用状态。

## 录音输入

1. 点击麦克风控件，需要时允许使用麦克风。
2. 录音开始后说话。
3. 再次点击停止。Runtime 转写这段已录完的音频；识别到文字后，客户端将其提交为一轮对话。

当前录音路径需要手动停止。暂停说话不会自动发送，录音过程中也不会在输入框逐字显示转写结果。

## Realtime 实时媒体

当前会话和已配置能力支持时，可使用独立的 Realtime 入口开启媒体会话，并使用该入口的开始与结束控件。当前请求采用手动回合检测；它不是录音输入流程，也不能据此认为停顿会自动提交一轮对话。

## 播放某条回复

使用回复上的播放操作。客户端为这条消息请求语音生成，等待产物完成并读取后，再在本地播放。这不会让后续所有回复自动播报，也不提供实时逐词高亮字幕。

语音处理失败时，按返回原因检查会话、配置、模型或连接。已提交的文字消息与播放结果分别处理。

## Avatar 播放

Avatar 读取当前 Conversation 的最终语音产物及有界的时序信息，负责本地播放与口型分析。Runtime 的通用呈现事件不携带渲染器口型权重或 viseme 帧；独立 Realtime 媒体有自己的准入条件，不能从 Avatar 的本地音频事件推断它已开启。

## 相关文档

- [对话控件](/zh/desktop/conversation-capability)
- [语音资产生命周期](/zh/runtime/voice-asset-lifecycle)

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
