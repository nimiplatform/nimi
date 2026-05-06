# Avatar 事件

Avatar 发一份类型化事件面，NAS 处理器、mod、runtime 组件订阅。事件家族在 kernel 层准入；不是自由格式。

## 事件家族

| 家族 | 覆盖什么 |
| --- | --- |
| `avatar.user.*` | 用户输入 — 点击、拖拽、悬停 |
| `avatar.activity.*` | Activity 事件 — 类型化动作请求 |
| `avatar.motion.*` | 动作生命周期 |
| `avatar.expression.*` | 表情变化 |
| `avatar.pose.*` | 姿势变化 |
| `avatar.lookat.*` | 凝视方向 |
| `avatar.speak.*` | 语音 / 声音输出生命周期 |
| `avatar.lipsync.*` | 口型帧事件 |
| `avatar.app.*` | App 生命周期（`start`、`ready` 等） |
| `avatar.companion.*` | Companion 面事件 |
| `avatar.composition.*` | 组合状态转换 |

每个家族被准入；新家族要 kernel 准入。

## 准入家族示例

### `avatar.user.*`

| 事件 | 触发时机 |
| --- | --- |
| `avatar.user.click` | 用户点击（带命中区域信息） |
| `avatar.user.drag` | 用户拖拽 |
| `avatar.user.hover` | 用户悬停 |

### `avatar.activity.*`

Activity 是类型化动作请求。NAS activity 处理器在匹配事件上触发。

### `avatar.motion.*`、`avatar.expression.*`、`avatar.pose.*`、`avatar.lookat.*`

生命周期事件：started、in-progress、completed。

### `avatar.speak.*`、`avatar.lipsync.*`

语音输出生命周期：语音被请求、音频回放、口型帧同步。

### `avatar.app.*`

| 事件 | 触发时机 |
| --- | --- |
| `avatar.app.start` | Avatar app 启动 |
| `avatar.app.ready` | 组合状态到 `ready` |

### `avatar.composition.*`

组合状态机的状态转换（`loading → ready → degraded:* → relaunch-pending`）。

## 阅读场景：Mod 订阅 Avatar 事件

某 mod 想在 Agent 表达情绪时响应。

1. **Mod 注册。** 通过准入桌面端 hook 能力，mod 订阅 `avatar.expression.*`。
2. **Avatar 发出。** Agent 的 runtime 驱动表情更新时，呈现层发出 `avatar.expression.changed`。
3. **Mod 收到。** 类型化事件带旧 + 新表情。
4. **Mod 动作。** 在它的准入能力白名单内。

Avatar 事件可观测；mod **不**必构造自己的状态推断循环。

## 阅读场景：跨 App 协同

另一个 App（不是 Avatar）想跟 Avatar 协同 — 比如把视觉情绪跟聊天 UI 同步。

1. **Avatar 发出表情事件。** 跨 runtime 事件总线。
2. **另一个 App 订阅。** 通过准入 runtime 事件订阅。
3. **App 协同。** 两边大致同时反映同一情绪。

`avatar_instance_registry` 提供跨 App 协同接缝（在 avatar app-shell 合同下准入）。

## 阅读场景：口型桥

Agent 说话；嘴型应跟音频同步。

1. **Runtime 发语音回放事件。** 通过准入 runtime 呈现时间线。
2. **`lipsync_frame_batch`。** Runtime 发带类型化时序的帧批次。
3. **Avatar 消费。** 通过 SDK 队列，帧到达 Avatar。
4. **Avatar 桥到 Live2D。** 帧驱动 Live2D `ParamMouthOpenY` 参数。
5. **可见结果。** 嘴型跟音频回放同步。

口型是 wave-3 准入桥；它是平台里更精细的跨域编排路径之一。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 事件分类 | Avatar 事件合同 |
| 事件发出 | Avatar 呈现层 |
| 事件消费 | NAS 处理器、mod、其他 App |
| 跨实例协同 | `avatar_instance_registry` |
| 口型桥 | Runtime 呈现层事件流 + SDK 队列 + Avatar `ParamMouthOpenY` |

## 来源

- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-debug-session-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/voice-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/voice-contract.md)
