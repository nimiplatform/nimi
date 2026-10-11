# Agent 对话中的操作控件

当前对话的控件可用于附加图片、录制语音输入、开启可用的 Realtime 会话，或播放某一条回复。这些动作需要有效的 App 会话和对应的 Runtime 能力；按钮在本地显示，并不代表执行条件已经满足。

## 当前支持的操作

| 操作 | 结果 |
| --- | --- |
| 附加图片 | 为本轮添加一张待发送图片；不接受文档或代码文件附件 |
| 录制语音输入 | 持续录音直到你停止，随后转写并提交识别出的文字 |
| 使用可用的 Realtime 入口 | 开启独立的实时媒体会话，使用该入口自己的控件与能力条件 |
| 播放回复 | 为选中的消息生成语音，读取完成的产物后在本地播放 |

需要讨论代码或文档时，可把相关片段粘贴为文字。临时输入和播放控件不会修改 Agent 共享的 AIConfig。

## 播放一条回复

1. 找到提供播放操作的回复。
2. 点击播放，Runtime 检查该消息所需的语音配置和执行条件。
3. 语音产物准备并读取完成后，客户端开始播放。不可用时，按界面显示的具体原因处理。

这次操作只针对选中的回复，不会让之后所有文字回复自动带上流式音频或高亮字幕。录音输入与 Realtime 的区别见[语音交互](/zh/desktop/voice-session)。

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
