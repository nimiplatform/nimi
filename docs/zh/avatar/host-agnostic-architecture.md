# 后端无关架构

Runtime 管理 Agent 与 Conversation 的语义。Avatar 读取获准消费的语义更新和最终语音产物，负责本地映射、渲染、播放与窗口行为。

`Runtime / SDK 输入 → Avatar 内置转换 → 所选 Live2D 或 VRM 分支`

## 各层职责

| 层级 | 职责 |
| --- | --- |
| Runtime 与 SDK | 当前会话的 Agent/Conversation 引用、活动、情绪、语义姿态和有界语音时序 |
| Avatar 转换 | 校验后的输入映射、本地表情与播放、碰撞区域及窗口意向 |
| 后端分支 | 模型加载、绘制循环、分支专用参数与图形资源 |

后端类型仅有 `live2d` 和 `vrm`，分别使用 Cubism 与 three-vrm。Avatar 自有转换在确认后端类型后可使用 Live2D 参数扩展；模型包不能注入创作者处理器或私有后端。

## 活动与情绪

内置 adapter 消费 `runtime.agent.presentation.activity_requested` 和 `runtime.agent.state.emotion_changed`，将受支持的输入映射到所选模型的路由或表情。`avatar.expression.change` 表示本地观察，不新增 Runtime 情绪，也不是跨 App 同步命令。

## 窗口尺寸

后端标称尺寸与已准入的本地缩放决定安静状态下的角色窗口范围。Companion 控件和临时覆盖层不计入常驻停靠区域；它们按明确交互或语音状态、产品就绪条件与当前安静状态显示。

## 语音

Avatar 通过自己的会话读取最终语音产物，再执行本地播放和口型分析。Runtime 通用呈现数据不提供音素帧或口型权重，各个界面独立读取获准消费的数据，不复制其他窗口的缓存。

## 相关文档

- [活动映射](/zh/avatar/activity-mapping)
- [模型能力配置](/zh/avatar/model-capabilities)
- [实例生命周期](/zh/avatar/instance-lifecycle)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
