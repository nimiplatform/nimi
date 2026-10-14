# 后端无关架构

Runtime 负责管理 Agent 与 Conversation 的语义；Avatar 读取准入的语义更新和最终语音产物，负责本地映射、图形渲染、音频播放与窗口行为。

`Runtime / SDK 输入 → Avatar 内置转换 → 所选 Live2D 或 VRM 分支`

## 各层职责

| 层级 | 职责 |
| --- | --- |
| Runtime 与 SDK | 提供当前会话的 Agent/Conversation 引用、活动、情绪、语义姿态及有界语音时序 |
| Avatar 转换层 | 校验并映射输入、驱动本地表情与播放、计算碰撞区域及窗口布局意图 |
| 后端分支 | 负责模型加载、绘制循环、分支专用参数与图形资源管理 |

渲染后端仅包含 `live2d` 和 `vrm` 两个分支，分别基于 Cubism 与 three-vrm 实现。Avatar 内置转换层在收窄后端类型后可调用 Live2D 参数扩展；模型包不能注入创作者自定义处理器或私有渲染后端。

## 活动与情绪

内置 adapter 消费 `runtime.agent.presentation.activity_requested` 和 `runtime.agent.state.emotion_changed`，将受支持的输入映射到当前模型的动作路由或表情。`avatar.expression.change` 仅代表本地状态观察，不会新增 Runtime 情绪，也不是跨 App 的同步命令。

## 窗口尺寸

后端标称尺寸与准入的本地缩放比例共同决定静默状态下的角色窗口范围。Companion 控件及其他临时浮层不会作为常驻停靠区域计入窗口尺寸，而是根据明确的交互或语音状态、产品就绪条件以及当前静默状态按需显示。

## 语音

Avatar 通过自身会话读取最终语音产物，并在本地完成播放与口型分析。Runtime 通用呈现数据不包含音素帧或口型权重；各个界面独立读取各自准入的数据，不共享或复制其他窗口的缓存。

## 相关文档

- [活动映射](/zh/avatar/activity-mapping)
- [模型能力配置](/zh/avatar/model-capabilities)
- [实例生命周期](/zh/avatar/instance-lifecycle)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
