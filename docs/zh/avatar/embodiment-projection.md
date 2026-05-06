# 形体化呈现

形体化呈现是 Agent 真相变成载体上视觉输出所走的**后端无关 API 面**。NAS 处理器消费它；它产出后端特定调用（今天 Live2D，未来 VRM）。

## 它拥有什么

| 职责 | 表面 |
| --- | --- |
| 消费 runtime / SDK 语义 bundle | 读 Agent 状态、呈现 profile、当前情绪、动作 |
| 产出后端特定调用 | 把语义翻成当前活跃后端 |
| 后端无关 API | 不管什么后端，NAS 处理器形状一样 |
| 后端特定扩展 | 类型窄化时给处理器用（比如 `live2dExtension`） |

跑在后端无关 API 上的 NAS 处理器在任何后端都能用。用 `live2dExtension` 的 NAS 处理器绑死 Live2D 后端。

## 后端的判别 union

后端分支是**封闭 union**：`live2d | vrm`。

| 性质 | 值 |
| --- | --- |
| 类型 | 判别 union |
| 成员 | `live2d`、`vrm`（未来） |
| 扩展访问 | 只在类型窄化时 |
| 封闭 | 新后端要准入合同 |

NAS 处理器**不能**自己造第三个后端。后端列表是被准入的；新后端要 kernel 准入。

## 呈现在 runtime 怎么工作

| 步骤 | 生产方 | 消费方 |
| --- | --- | --- |
| Runtime 发语义 bundle | Runtime 呈现层事件流 | Avatar 呈现层 |
| 呈现层翻译 | Avatar 呈现层 | NAS 处理器 API |
| NAS 处理器跑 | NAS 处理器 | 后端特定 API（类型窄化时） |
| 后端渲染 | Live2D / VRM / 等 | 可见输出 |

## 阅读场景：跨后端 NAS 处理器

某包作者写一个 `wave` activity 处理器，希望在任何后端都能用。

1. **处理器在约定路径。** `<model>/runtime/nimi/activity/wave.js`。
2. **用后端无关 API。** 处理器调形体化呈现方法（motion、expression、pose、lookat、params、wait）。
3. **呈现层翻译。** Live2D 上经 Live2D 扩展路由；VRM 上会经 VRM 扩展路由。
4. **同一处理器到处发。** 没后端特定代码。

后端无关处理器是可移植的。

## 阅读场景：后端特定 NAS 处理器

某包作者想用 Live2D 特定功能。

1. **类型窄化。** 处理器断言后端是 `live2d`。
2. **用 `live2dExtension`。** Live2D 特定扩展 API 现在可用。
3. **处理器只在 Live2D 跑。** 用户把包装到 VRM 后端的 avatar 上，类型窄化失败；处理器回退到准入替代或把 activity 标为不支持。

判别 union 防止意外的后端耦合。

## 阅读场景：语义 bundle 驱动 activity

某 Agent 的 runtime 发出「happy」情绪事件。

1. **Runtime 发出。** `runtime.agent.expression.*` 事件，emotion = happy。
2. **呈现层消费。** 把情绪映到准入 Live2D 参数（比如嘴形、表情预设）。
3. **Live2D 后端渲染。** Agent 在形体化舞台显示开心表情。
4. **NAS 处理器可组合。** `continuous` 处理器可加额外动作强化情绪。

Runtime 是来源；呈现层是类型化翻译；后端是渲染器。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| Agent 语义状态 | Runtime 呈现 profile + 事件流 |
| 呈现语义 | Avatar 形体化呈现合同 |
| NAS 处理器 API | Avatar agent-script 合同 |
| 后端特定调用 | 后端分支合同（live2d / vrm） |

## 来源

- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
