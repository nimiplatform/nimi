# 语音输入、Realtime 与回复播放

Agent Chat 提供三条相互独立的音频路径：录音输入、Realtime 实时媒体和单条回复播放。使用前，请先确认当前的语音配置及界面提示的可用状态。

## 录音输入

1. 点击麦克风控件，并在系统提示时授权麦克风权限。
2. 录音开启后开始说话。
3. 再次点击控件停止录音。Runtime 会将整段录音转写为文本，随后由客户端作为一轮对话（Conversation turn）正式提交。

当前录音路径需手动停止：说话过程中的停顿不会自动提交对话，录音期间输入框也不会实时显示逐字转写预览。

## Realtime 实时媒体

当当前会话与所配能力支持时，可通过独立的 Realtime 入口开启实时媒体会话，并使用该入口自带的开始与结束控件。Realtime 并非普通录音输入流程，但当前链路同样采用手动回合检测（manual turn detection），说话停顿不会自动触发回合提交。

## 播放单条回复

点击某条回复上的播放按钮，客户端会为该消息请求语音合成，待完整音频产物生成并读取后在本地播放。该操作仅播放当前消息，不会开启后续回复的自动连播，也不提供实时逐词高亮字幕。

如果语音处理失败，可根据返回的错误原因排查会话状态、配置参数、模型可用性或网络连接。已提交的文本消息独立保存，不受语音播放结果影响。

## Avatar 播放

Avatar 直接读取当前标准对话（Conversation）最终生成的语音产物及有限的时序元数据，在本地完成音频播放与口型同步（lipsync）分析。需要注意以下边界：
- Runtime 的通用呈现事件不携带渲染器口型权重（mouth weights）或视素（viseme）帧数据。
- 独立的 Realtime 媒体路径有专属的准入校验，不能根据 Avatar 的本地音频事件反向推断 Realtime 媒体已开启。

## 相关文档

- [对话控件](/zh/desktop/conversation-capability)
- [语音资产生命周期](/zh/runtime/voice-asset-lifecycle)

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
