# Avatar 本地观察事件

本文说明当前 Avatar 内部驱动发出的本地观察事件。活动、情绪与 Conversation 语义仍由 Runtime 管理；Avatar 事件仅反映本地映射、输入或播放状态，不是跨 App 的命令接口。

## 当前触发的事件名称

| 事件名称 | 含义 |
| --- | --- |
| `avatar.before.activity.start` | 执行内置映射前触发的本地观察，可被当前取消策略拦截 |
| `avatar.activity.start` | 当前活动映射生效时触发 |
| `avatar.activity.end` | 同一映射处理流程结束时触发 |
| `avatar.activity.cancel` | 活动在执行前被本地取消策略拦截 |
| `avatar.expression.change` | 本地表情映射发生变化 |
| `avatar.user.click` | 模型碰撞区域收到本地点击输入 |
| `avatar.speak.interrupt` | 当前语音与口型同步流程中断 |

一次活动映射处理完成后，可能会连续发出 `avatar.activity.start` 与 `avatar.activity.end`，因此不能把 `avatar.activity.end` 当作动画片段已播放完毕的依据。语音播放生命周期由本地状态总线管理，当前路径不会发出 `avatar.speak.start` 或 `avatar.speak.end`。

## Runtime 输入

SDK 驱动消费准入的具身（embodiment）更新，并将其转换为 `runtime.agent.presentation.activity_requested` 和 `runtime.agent.state.emotion_changed` 等内部输入。模型目录不会加载 JavaScript 来注册 NAS 处理器，点击模型也不会调用创作者的 onClickHead.js。

## 点击处理

模型表面先判定有效碰撞区域，再将点击交给内置交互物理模块处理。处理结果仅作用于 Avatar 本地输入与画面呈现，不会创建 Runtime 对话状态或权限。

## 最终语音播放

Avatar 根据主对话（canonical Conversation）的最终语音 `artifactId`，通过自身会话读取完整音频产物，再交给本地播放器与口型分析器处理。`avatar.conversation.voice.audio_chunk` 是 Avatar 本地事件，当前读取路径可用它传递完整音频字节，不代表 Runtime 原生语音流或播放指令。

高频口型权重与后端绘制细节均留在本地渲染路径内，不进入通用 Runtime 呈现契约。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts)
