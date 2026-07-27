# Nimi Avatar

Nimi Avatar 是一个第一方 Tauri App（`@nimiplatform/avatar`），它把 Agent 的形象呈现为桌面上一个透明、置顶的悬浮窗。它**和桌面端是两个独立的 App**，不是子表面，是"你的 Agent 活在你桌面上"这件事的实际形态。

## Nimi Avatar 是什么

| 属性 | 值 |
| --- | --- |
| 包 | `@nimiplatform/avatar` |
| Shell | 独立 Tauri App，与桌面端分开 |
| 窗口形态 | 透明 + 无边框 + 置顶（默认；用户可切换） |
| 鼠标事件穿透 | 在 Agent 身体区域之外，事件穿透到下层 App |
| 位置 | 可拖拽，跨会话记住位置 |
| 点击反应 | 由 NimiAgentScript 处理器编程驱动 |
| Companion 区 | 始终可见：助手气泡 + 状态栏 + 输入框 |

它不是托盘图标，也不是侧边气泡，而是一个真实活在屏幕上的视觉存在。

## 具身化舞台与 Companion 表面

Avatar 有两个可见区域：

| 区域 | 作用 |
| --- | --- |
| 具身化舞台 | 主可视区域，Agent 的身体在此渲染（当前为 Live2D） |
| Companion 表面 | 始终可见的一栏：助手气泡 + 状态栏 + 输入框 |

Companion 表面**始终可见**，没有触发按钮，也没有弹窗。它紧贴 Agent 显示。状态栏包含麦克风开关、模式标签、扬声器指示、设置齿轮。输入框是文本输入加发送。

## 合成态状态机

| 状态 | 含义 |
| --- | --- |
| `loading` | 初始化阶段，尚无具身化 |
| `ready` | 舞台与 Companion 都已挂载，Agent 在线 |
| `degraded:*` | 强类型降级原因（资产缺失、Runtime 不可达等） |
| `error:*` | 强类型错误原因 |
| `relaunch-pending` | 等待桌面端发出的启动更新 |
| `fixture:active` | Fixture 模式（开发用） |

`ready` 与非 ready 表面互斥：要么二者都在 ready，要么由降级表面接管。

## NimiAgentScript（NAS）

NAS 是面向 Avatar 包作者的、基于约定的 JS 处理器系统。

| 处理器类别 | 路径 |
| --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` |
| Event | `<model>/runtime/nimi/event/<name>.js` |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` |
| Shared | `<model>/runtime/nimi/lib/` |

NAS 处理器使用宿主无关的具身化语义层 API 来驱动后端；类型收窄之后才能用 Live2D 专属扩展。

NAS 处理器自动注册：Runtime 扫描 `<model>/runtime/nimi/`，发现处理器即注册，由 Tauri notify watcher 负责热加载。

## 窗口行为细节

| 项 | 值 |
| --- | --- |
| 装饰条 | 无 |
| 透明 | 是 |
| 置顶 | 默认开启（用户可切换） |
| 动态尺寸 | 跟随模型边界与 Companion 占位 |
| 启动位置 | 屏幕右下角，留 24px 边距 |
| 后续位置 | 跨会话记住 |
| 命中区 | alpha 蒙版 + bbox 双层；像素级 alpha 采样 60Hz |
| 拖拽区 | 仅在具身化舞台内；Companion 与降级面吸收指针事件 |

合起来就是这件事：Agent 在屏幕上，你能在它所在的位置和它互动，可以拖动它，屏幕的其它部分照常使用。

## 设置弹层

只有 4 个开关，刻意保持最小：

| 开关 | 默认 |
| --- | --- |
| `always_on_top` | 开 |
| `bubble_auto_open` | 开 |
| `bubble_auto_collapse` | 开 |
| `show_voice_captions` | 由用户决定 |

不放转录长面板，不做工作站式配置。Avatar App 是一个 applet，不是工作站。

## 场景：从桌面端打开 Avatar

桌面端聊天里有一个 Agent，你想把它请到屏幕上。

1. **桌面端发起 Avatar**。只发 `agent_id` 和可选的 `avatar_instance_id`、`launch_source`。**不传 token，不传 anchor，不传包描述符。**
2. **Avatar 启动**：建窗口 → 渲染器挂载 → 发出 `avatar.app.start` → 注册第一方 App → 通过 Runtime 账户视图解析 `agent_id`。
3. **加载视觉包**：具身化包加上 NAS 处理器。
4. **计算命中区**：alpha 蒙版加 bbox。
5. **挂载舞台与 Companion**：状态从 `loading` 进入 `ready`。
6. **发出 `avatar.app.ready`**：Agent 上线。

桌面端是发起方，Avatar 是 Carrier，Runtime 是权威。

## 场景：通过 NAS 反应点击

用户点击 Agent 的头部，希望 Agent 有反应。

1. **点击命中具身化舞台**。alpha 蒙版判定点击位于 Agent 身体内。
2. **发出 `avatar.user.click`**，附带命中区域信息。
3. **NAS 事件处理器命中**：`<model>/runtime/nimi/event/onClickHead.js` 已被自动注册到这个区域。
4. **处理器执行**：触发害羞反应——播放一段动画，加一段轻量音效，发出一次情绪事件。
5. **具身化呈现**：Live2D 后端把这一段反应渲染出来。

Avatar 包作者只是把处理器放在约定路径下，没有任何注册仪式。

## 场景：Runtime 不可达

Avatar 运行期间 Runtime 守护进程停了。

1. **Avatar 探测到不可达**。
2. **状态迁移**：合成态从 `ready` 进入 `degraded:runtime_unavailable`。
3. **降级表面接管**：舞台与 Companion 同时被降级表面替换，强类型原因对用户可见。
4. **不静默兜底**。Avatar 不会假装自己还能跑，也不会偷偷切到 mock fixture。
5. **用户可选**：等 Runtime 恢复后点重载，或者关闭。

恢复是**手动**的：只提供一个明确的重载按钮，不会从降级态自动回到 ready，避免把平台问题悄悄遮住。

## Avatar 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 持久化转录 | 长会话历史归桌面端聊天 |
| 后台语音 / 唤醒词 | 语音必须由用户显式触发 |
| 跨锁屏的语音 | 锁屏中断语音通道 |
| 静默切换到 mock | Runtime 不可达时 fail-closed |
| 降级态自动恢复 | 仅手动重载 |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
