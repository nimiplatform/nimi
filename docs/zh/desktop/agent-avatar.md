# Agent 状态与 Avatar 呈现

Desktop 用当前对话结果及本地录音、输入和播放状态提供轻量反馈。Avatar 是独立的具身呈现 App，负责 Live2D 或 VRM 模型、动作、音频播放与口型分析。

## 两个界面的数据来源

| 界面 | 输入与职责 |
| --- | --- |
| Desktop 对话 | 读取已授权的 Conversation 结果，并结合本地输入和播放状态显示提示 |
| Avatar | 通过自身受保护 App 会话读取 activity、emotion、posture、voice-timing 及最终语音产物 |

两个界面各自获取当前会话获准读取的数据，不把窗口缓存当成另一端的状态来源。App 之间不能复用会话级 Agent handle 作为操作选择器。

## 语音与口型

录音输入、Realtime 和单条消息播放使用不同路径，详见[语音交互](/zh/desktop/voice-session)。Avatar 的普通 Conversation 播放读取最终语音产物，再在本地分析音频并生成口型权重。

Runtime 通用呈现事件不携带 viseme/phoneme 序列或渲染器口型参数。看到录音或播放状态，也不能推断另一个窗口已经开启 Realtime，或正在显示逐词高亮字幕。

## 就绪与故障

Avatar 的模型视图能否显示、产品交互能否开放是不同条件。开发预览可以显示模型，但不表示真实会话已就绪；当前会话或呈现条件不满足时，按该界面返回的诊断原因处理。详见[Avatar 实例生命周期](/zh/avatar/instance-lifecycle)。

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
