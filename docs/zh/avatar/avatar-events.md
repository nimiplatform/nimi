# Avatar 事件

## 状态：现在 (Running today)

事件分类法已在内核层级获得准入；事件总线已交付。

Avatar 对外暴露一组强类型事件，供 NAS 处理器、Mod 与 Runtime 组件订阅。事件家族在内核层准入，不接受自由格式。

## 事件家族

| 家族 | 覆盖范围 |
| --- | --- |
| `avatar.user.*` | 用户输入：点击、拖拽、悬停 |
| `avatar.activity.*` | 活动事件：强类型动作请求 |
| `avatar.motion.*` | 动作生命周期 |
| `avatar.expression.*` | 表情变更 |
| `avatar.pose.*` | 姿态变更 |
| `avatar.lookat.*` | 视线方向 |
| `avatar.speak.*` | 语音输出生命周期 |
| `avatar.lipsync.*` | 唇形帧事件 |
| `avatar.app.*` | App 生命周期（`start`、`ready` 等） |
| `avatar.companion.*` | Companion 表面事件 |
| `avatar.composition.*` | 合成态状态机迁移 |

每个家族都需准入；新增家族走内核准入流程。

## 已准入家族示例

### `avatar.user.*`

| 事件 | 触发时机 |
| --- | --- |
| `avatar.user.click` | 用户点击，附带命中区域信息 |
| `avatar.user.drag` | 用户拖拽 |
| `avatar.user.hover` | 用户悬停 |

### `avatar.activity.*`

活动是强类型动作请求。NAS 的 activity 处理器在对应事件上触发。

### `avatar.motion.*`、`avatar.expression.*`、`avatar.pose.*`、`avatar.lookat.*`

各自的生命周期事件：开始、进行中、完成。

### `avatar.speak.*`、`avatar.lipsync.*`

语音输出生命周期：语音请求触发、音频回放、唇形帧与音频对齐。

### `avatar.app.*`

| 事件 | 触发时机 |
| --- | --- |
| `avatar.app.start` | Avatar app 启动 |
| `avatar.app.ready` | 合成态进入 `ready` |

### `avatar.composition.*`

合成态状态机的迁移事件（`loading → ready → degraded:* → relaunch-pending`）。

## 场景：Mod 订阅 Avatar 事件

某个 Mod 想在 Agent 表达情绪时做点反应。

1. **Mod 注册**。通过准入的桌面端 hook 能力订阅 `avatar.expression.*`。
2. **Avatar 发出事件**。Agent 的 Runtime 驱动一次表情更新时，Avatar 语义层发出 `avatar.expression.changed`。
3. **Mod 收到事件**。事件强类型，包含旧表情与新表情。
4. **Mod 在准入能力清单内行动**。

Mod 不需要自己推断 Avatar 状态——事件本身就是可观测面。

## 场景：跨 App 协同

另一个 App（不是 Avatar）希望与 Avatar 协同——例如把视觉情绪同步到聊天 UI。

1. **Avatar 发出表情事件**。事件经由 Runtime 事件总线广播。
2. **另一个 App 订阅**。通过准入的 Runtime 事件订阅接口接收。
3. **两个 App 同步呈现**。在大致同一时刻反映出相同的情绪。

跨实例协同的接缝由 `avatar_instance_registry` 提供（在 Avatar app-shell 契约中准入）。

## 场景：唇形同步桥

Agent 开口说话，唇形需要与音频对齐。

1. **Runtime 发出语音回放事件**。通过准入的 Runtime 展示时间线。
2. **`lipsync_frame_batch`**。Runtime 发出强类型时序的帧批次。
3. **Avatar 消费帧**。帧通过 SDK 队列抵达 Avatar。
4. **Avatar 桥接到 Live2D**。帧驱动 Live2D 的 `ParamMouthOpenY`。
5. **可见结果**。唇形与音频对齐。

唇形同步是一条 wave-3 准入的桥接路径，是平台中跨域编排链路较长的一条。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| 事件分类 | Avatar event 契约 |
| 事件发出 | Avatar 语义层 |
| 事件消费 | NAS 处理器、Mod、其它 App |
| 跨实例协同 | `avatar_instance_registry` |
| 唇形同步桥 | Runtime 展示流 + SDK 队列 + Avatar `ParamMouthOpenY` |

## 来源依据

- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-debug-session-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/voice-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/voice-contract.md)
