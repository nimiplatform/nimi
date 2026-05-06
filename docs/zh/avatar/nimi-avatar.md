# Nimi Avatar

Nimi Avatar 是一等方 Tauri app（`@nimiplatform/avatar`），让 Agent 的角色以透明、置顶悬浮窗口出现在用户桌面上。它**是跟桌面端独立的 app** — 不是子面 — 也是「Agent 在你桌面上活着」的实现。

## Nimi Avatar 是什么

| 性质 | 值 |
| --- | --- |
| 包 | `@nimiplatform/avatar` |
| 外壳 | Tauri app，跟桌面端独立 |
| 窗口形状 | 透明 + 无 chrome + 置顶（默认；用户可切换） |
| 鼠标事件穿透 | Agent 身体区域之外，事件穿到底层 app |
| 位置 | 可拖；跨 session 记住 |
| 点击反应 | 可通过 NimiAgentScript 处理器编程 |
| Companion 栈 | 始终可见：助手消息气泡 + 状态行 + composer |

它**不是**托盘图标。**不是**边栏气泡。它是住在用户屏幕上的、在场的视觉存在。

## 形体化舞台与 Companion 面

Avatar 有两个可见区域：

| 区域 | 用途 |
| --- | --- |
| 形体化舞台 | Agent 身体渲染的主要可见区（今天 Live2D） |
| Companion 面 | 始终可见栈：助手气泡 + 状态行 + composer |

Companion 面**始终可见** — 没触发按钮、没弹出。它停靠在 Agent 旁边。状态行有 mic 切换、模式标签、扬声器指示、设置齿轮。Composer 是文本输入 + 发送。

## 组合状态机

| 状态 | 含义 |
| --- | --- |
| `loading` | 初始 bootstrap；还无形体化 |
| `ready` | 舞台和 companion 都挂载；Agent 在线 |
| `degraded:*` | 类型化降级原因（资产缺、runtime 不可达等） |
| `error:*` | 类型化错误原因 |
| `relaunch-pending` | 等桌面端启动更新 |
| `fixture:active` | Fixture 模式（开发） |

`ready` 与非 ready 面之间硬互斥。要么两者都 `ready`，要么降级面接管。

## NimiAgentScript（NAS）

NAS 是给形体化包创作者的、基于约定的 JS 处理器系统。

| 处理器种类 | 路径 |
| --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` |
| Event | `<model>/runtime/nimi/event/<name>.js` |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` |
| Shared | `<model>/runtime/nimi/lib/` |

NAS 处理器消费形体化呈现 API（后端无关），驱动后端（Live2D 特定扩展在类型窄化时暴露）。

NAS 处理器自动注册：runtime 扫描 `<model>/runtime/nimi/` 注册处理器；通过 Tauri notify watcher 热重载。

## 窗口行为细节

| 细节 | 值 |
| --- | --- |
| 装饰 | 无 |
| 透明 | 是 |
| 置顶 | 默认（用户可切换） |
| 动态尺寸 | 跟 model 边界 + companion 占位 |
| 启动位置 | 右下，24px 留白 |
| 后续位置 | 跨 session 记住 |
| 命中区域 | Alpha-mask + bbox 双层；像素级 alpha 采样 60Hz |
| 拖拽区域 | 只在形体化舞台内；companion + degraded 吸收指针事件 |

这些细节加起来是「Agent 在你屏幕上、你能在它在的地方跟它互动、你能拖它、屏幕其余部分照常工作」。

## 设置弹层

只有 4 个开关。有意极简：

| 开关 | 默认 |
| --- | --- |
| `always_on_top` | 开 |
| `bubble_auto_open` | 开 |
| `bubble_auto_collapse` | 开 |
| `show_voice_captions` | （用户选择） |

**没**transcript 重面。**没**工作站风格配置。Avatar app 是 applet，不是工作站。

## 阅读场景：从桌面端打开 Avatar

你在桌面端聊天里有一个 Agent。你想把 ta 拉到屏幕上。

1. **桌面端启动 Avatar。** 只发 `agent_id` + 可选 `avatar_instance_id` + 可选 `launch_source`。**无 token。无 anchor。无包描述符。**
2. **Avatar bootstrap。** 创窗 → 渲染挂载 → 发 `avatar.app.start` → 注册一等方 app → 经 Runtime 账号读视图解析 `agent_id`。
3. **加视觉包。** 形体化包 + NAS 处理器。
4. **算命中区域。** Alpha-mask + bbox。
5. **挂载舞台 + companion。** 状态搬 `loading → ready`。
6. **发 `avatar.app.ready`。** Agent 在线。

桌面端是启动器；Avatar 是载体；Runtime 是权威。

## 阅读场景：经 NAS 的点击反应

用户点 Agent 的头；你想让 Agent 反应。

1. **点击命中形体化舞台。** Alpha-mask 决定点击在 Agent 身体内。
2. **`avatar.user.click` 事件。** 带命中区域信息发出。
3. **NAS event 处理器。** `<model>/runtime/nimi/event/onClickHead.js` 的处理器为这个区域自动注册。
4. **处理器跑。** 触发害羞反应 — 跑动画、播小音效、发情绪事件。
5. **形体化呈现。** Live2D 后端渲染反应。

形体化包作者把处理器写在约定路径下。**没**注册仪式。

## 阅读场景：Runtime 不可达

Avatar 在跑时 Runtime daemon 停了。

1. **Runtime 检测。** Avatar 检测到 runtime 不可达。
2. **状态搬。** 组合状态搬 `ready → degraded:runtime_unavailable`。
3. **降级面接管。** 舞台 + companion 都被降级面替代 — 用户能看到类型化原因。
4. **没静默回退。** Avatar **不**装作没 runtime 也能跑；它**不**静默切到 mock fixture。
5. **用户选项。** 重载（runtime 回来后）或关闭。

恢复是**手动**的：只有显式重载按钮。**不**从 degraded 自动自愈到 ready。这防止静默掩盖平台问题。

## Avatar **不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 持久 transcript | 长历史住在桌面端聊天 |
| 后台语音 / 唤醒词 | 语音是显式用户触发 |
| 跨锁屏延续 | 语音**不**跨锁屏桥 |
| 静默回退到 mock | Runtime 不可达时 fail-close |
| 从 degraded 自动恢复 | 只有手动重载 |

## 来源

- [`.nimi/spec/avatar/nimi-avatar.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/nimi-avatar.md)
- [`.nimi/spec/avatar/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/index.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/mock-fixture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/mock-fixture-contract.md)
