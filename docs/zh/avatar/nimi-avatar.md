# Nimi Avatar 桌面伙伴形象

Nimi Avatar 是由 Desktop 监督启动的 Electron App。它把当前已授权 Agent 的 Live2D 或 VRM 形象显示在独立的透明窗口中，负责本地动作、表情、播放与窗口交互。

## 角色窗口与 Companion

角色身体决定了主窗口的基础范围。Companion 提供对话相关控件，仅在明确交互或特定语音状态需要时显现；它不是默认常驻的停靠面板，也不会在角色安静（quiet）状态下撑大默认窗口范围。

后端的标称尺寸、有效几何信息与本地缩放共同决定窗口布局。命中检测区域（hit regions）与可选透明度查询由所选后端直接提供；遮罩更新频率独立于画面帧率，系统不保证跨后端统一的 60Hz 遮罩更新。

## 何时可以交互

只有在 App 会话、模型、驱动和后端呈现均满足要求后，产品级交互才会开放。准备未完成时界面显示加载状态；若会话、启动上下文或模型先决条件未满足，则会显示具体的诊断原因。

开发预览模式可以仅展示模型外观，无需建立真实的 Runtime 会话或达到产品就绪标准，但也无法开放正式的产品交互。具体前置条件见[实例生命周期](/zh/avatar/instance-lifecycle)。

## 启动与会话绑定

调用方通过 Avatar 宿主正式接口提交当前会话的 Agent handle。Desktop 与 Runtime 会在 Desktop 启动或聚焦对应实例前重新校验目标；若当前已有活跃的其他 Agent，切换前必须获得用户确认。

Avatar 会核验自身的受保护 App 会话有效，再通过明确交接的 Conversation 锚点解析该会话对应的 Agent handle，绝不把调用方的 handle 直接当作自己会话的操作选择器。渲染器启动上下文中不包含任何账号凭据或调用方自定义的模型路径；资产准备完全由宿主授权。

## 动作、表情与语音

活动与情绪由内置 adapter 映射到已验证的后端能力。点击事件直接接入本地交互物理逻辑，绝不执行模型目录中的 NAS JavaScript。模型能力与名称映射见[模型能力配置](/zh/avatar/model-capabilities)。

普通 Conversation 语音播放读取最终语音产物，由 Avatar 负责本地音频分析与口型同步（lipsync）。独立受准入的 Realtime 媒体走完全不同的链路，不等同于该语音产物的播放。

## 不可用与恢复

若 Runtime 绑定、驱动或呈现先决条件失败，产品交互将立即停止并显示相应原因。当画面处于不可渲染状态时，模型视图与 Companion 均不挂载。在界面发起恢复操作后，只有当会话和呈现条件重新校验通过时才会恢复交互。

隐藏窗口会结束本地捕获、播放等可见交互；停止 Avatar 实例仅释放当前本地实例及其占用资源，不会删除对应的 Agent 或 Conversation。Runtime 后台工作保有独立的权限与生命周期。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/voice-companion-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-companion-state.ts)
- [`apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
