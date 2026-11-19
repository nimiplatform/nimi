# 语音输入、Realtime 与回复播放

在 Home 中与伙伴对话时，你可以通过录音填写草稿，也可以播放单条回复。使用前，请先确认当前的语音配置及界面提示的可用状态。

## 录音输入

1. 点击麦克风控件，并在系统提示时授权麦克风权限。
2. 录音开启后开始说话。
3. 再次点击控件停止录音。如果草稿在转写期间没有改动，转写结果会追加到草稿中。检查文字后点击「发送」。

当前录音路径需手动停止：说话过程中的停顿不会自动提交对话，录音期间输入框也不会实时显示逐字转写预览。

## Realtime 实时媒体

提供 Realtime 入口的 App 可以开启独立的实时媒体会话。Lab 的 Agent Realtime 使用服务端语音活动检测来识别发言轮次。

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
- [`apps/desktop/src/shell/renderer/features/chat/home-partner-conversation.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/home-partner-conversation.tsx)
- [`apps/lab/src/product-modules/agent-realtime/index.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/product-modules/agent-realtime/index.tsx)
- [`kit/features/chat/src/components/canonical-message-actions.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/chat/src/components/canonical-message-actions.tsx)
