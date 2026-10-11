# Nimi Avatar 桌面伙伴形象

Nimi Avatar 是由 Desktop 监督启动的 Electron App。它把当前已授权 Agent 的 Live2D 或 VRM 形象显示在独立的透明窗口中，负责本地动作、表情、播放与窗口交互。

## 角色窗口与 Companion

角色视图占据主要窗口范围。Companion 提供对话相关控件，按明确交互或语音状态需要时出现；它不是默认常驻的停靠面板，也不计入安静状态下的固定窗口范围。

模型的后端标称尺寸、有效几何信息与本地缩放决定窗口布局。碰撞区域和可选透明度查询由所选后端提供，遮罩更新速度不等同于画面帧率，也没有跨后端统一的 60Hz 保证。

## 何时可以交互

App 会话、模型、驱动和后端呈现均满足要求后，产品交互才开放。准备未完成时显示加载状态；无效会话、启动上下文或模型条件则显示诊断原因。

开发预览可以显示模型，但不表示真实 Runtime 会话或产品已经就绪，也不开放正式产品交互。具体条件见[实例生命周期](/zh/avatar/instance-lifecycle)。

## 启动与会话绑定

调用方通过正式 Avatar 宿主接口提交当前会话的 Agent handle。Desktop 与 Runtime 重新校验目标后，Desktop 启动或聚焦对应实例；已有另一位 Agent 时，需要用户确认切换。

Avatar 确认自己的受保护 App 会话有效，再通过传入的确切对话锚点解析该会话的 Agent handle。它不会把调用方的 handle 直接当作自己会话的操作选择器。渲染器启动上下文不包含账号凭据或调用方自行指定的模型路径；资产准备由宿主授权。

## 动作、表情与语音

活动与情绪由内置 adapter 映射到已验证的后端能力。点击进入本地交互物理处理，不调用模型目录中的 NAS JavaScript。模型能力与名称映射见[模型能力配置](/zh/avatar/model-capabilities)。

普通 Conversation 语音播放读取最终语音产物；Avatar 负责本地音频分析与口型。Realtime 是独立受准入的媒体路径，不等同于这份产物的播放。

## 不可用与恢复

Runtime 绑定、驱动或呈现条件不可用时，产品交互停止，窗口显示相应原因。条件不允许渲染时，模型视图与 Companion 不挂载。使用界面提供的恢复操作后，只有重新满足会话和呈现条件才会恢复交互。

隐藏窗口会结束本地捕获与播放等可见交互；停止 Avatar 实例只结束当前本地实例和资源，不删除 Agent 或 Conversation。Runtime 后台工作有自己的权限与生命周期。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/voice-companion-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-companion-state.ts)
- [`apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
