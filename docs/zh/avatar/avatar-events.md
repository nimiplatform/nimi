# Avatar 本地观察事件

本节描述当前 Avatar 内部驱动的观察事件。Runtime 的活动、情绪和 Conversation 语义仍由 Runtime 管理；Avatar 事件表示本地映射、输入或播放行为，不是跨 App 命令接口。

## 当前 Producer 的事件名

| 精确名称 | 含义 |
| --- | --- |
| `avatar.before.activity.start` | 内置映射执行前的本地观察，可由当前取消策略阻断 |
| `avatar.activity.start` | 当前活动映射已应用时发出的观察 |
| `avatar.activity.end` | 同一映射结算路径发出的结束观察 |
| `avatar.activity.cancel` | 活动在执行前被本地取消策略阻断 |
| `avatar.expression.change` | 本地表情映射变化 |
| `avatar.user.click` | 模型碰撞区域上的本地点击输入 |
| `avatar.speak.interrupt` | 当前语音口型路径的中断观察 |

当前活动映射结算后可以连续发出 start 与 end，不能把 end 当作动画片段已播放完毕的证明。语音播放生命周期通过本地状态总线处理，当前路径不发出 `avatar.speak.start` 或 `avatar.speak.end`。

## Runtime 输入

SDK 驱动消费已获授权的 embodiment 更新，转换为 `runtime.agent.presentation.activity_requested` 和 `runtime.agent.state.emotion_changed` 等当前内部输入。模型包不通过 JavaScript 目录注册 NAS 处理器，点击也不会调用创作者的 onClickHead.js。

## 点击处理

模型表面先判断有效碰撞区域，再将点击交给内置交互物理处理。结果属于 Avatar 本地输入与呈现，不创建 Runtime 对话状态或权限。

## 最终语音播放

Avatar 根据 canonical Conversation 的最终 voice artifactId，通过自己的会话读取完整产物，再交给本地播放器与口型分析器。`avatar.conversation.voice.audio_chunk` 是 Avatar 本地事件，当前读取路径可用它携带整份产物字节；它不表示 Runtime 原生语音流或播放指令。

高频口型权重与后端绘制细节留在本地渲染路径，不进入通用 Runtime 呈现契约。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts)
