# 具身化语义层（Embodiment Projection）

具身化语义层是一组**宿主无关**的 API。它从 Agent 的真相状态出发，向下产出某个具体后端的渲染调用。NAS 处理器消费这层接口，由它再翻译成 Live2D（当前）或 VRM（未来）需要的指令。

## 这一层负责什么

| 职责 | 接口面 |
| --- | --- |
| 消费 Runtime / SDK 的语义包 | 读取 Agent 状态、展示画像、当前情绪与动作 |
| 产出后端调用 | 把语义翻译成当前激活后端的指令 |
| 提供宿主无关 API | 不论后端是谁，NAS 处理器形态保持一致 |
| 暴露后端专属扩展 | 类型收窄后才可用，例如 `live2dExtension` |

只用宿主无关 API 写出的 NAS 处理器，可以在任何后端运行。一旦用了 `live2dExtension`，这个处理器就和 Live2D 绑定。

## 后端选型：判别联合

后端是一个**封闭的判别联合**：`live2d | vrm`。

| 属性 | 值 |
| --- | --- |
| 类型 | 判别联合 |
| 成员 | `live2d`，`vrm`（未来） |
| 扩展访问 | 仅在类型收窄后开放 |
| 封闭性 | 新增后端必须经过规范准入 |

NAS 处理器无法擅自定义第三个后端。后端清单只在内核层准入，新增后端走规范流程。

## 运行期的工作流

| 步骤 | 生产方 | 消费方 |
| --- | --- | --- |
| Runtime 发出语义包 | Runtime 的展示流 | Avatar 语义层 |
| 语义层翻译 | Avatar 语义层 | NAS 处理器 API |
| NAS 处理器执行 | NAS 处理器 | 后端专属 API（类型收窄后） |
| 后端渲染 | Live2D / VRM 等 | 屏幕上的可见输出 |

## 场景：跨后端通用的 NAS 处理器

某个包作者要写一个 `wave` 动作处理器，希望它在任何后端都能跑。

1. **按约定路径放置文件**：`<model>/runtime/nimi/activity/wave.js`。
2. **只用宿主无关 API**。处理器调用语义层的方法，例如 motion、expression、pose、lookat、params、wait。
3. **语义层负责翻译**。在 Live2D 上走 Live2D 扩展通道；在 VRM 上走 VRM 扩展通道。
4. **同一份处理器走遍所有后端**，没有任何后端专属代码。

宿主无关的处理器天然可移植。

## 场景：绑定后端的 NAS 处理器

另一个包作者想用 Live2D 独有的能力。

1. **类型收窄**。处理器先断言后端是 `live2d`。
2. **使用 `live2dExtension`**。Live2D 专属扩展 API 此时可见。
3. **只在 Live2D 上生效**。如果用户把这个包装到 VRM 后端的 Avatar 上，类型收窄会失败，处理器要么走规范的备选路径，要么把这次活动标记为不支持。

判别联合在这里阻止意外的后端耦合。

## 场景：语义包驱动一次表演

Agent 的 Runtime 发出一次"开心"情绪事件。

1. **Runtime 发出**：`runtime.agent.expression.*` 事件，emotion = happy。
2. **语义层接收**。把情绪映射到准入的 Live2D 参数，例如嘴形和表情预设。
3. **Live2D 后端渲染**。Agent 在具身化舞台上呈现开心表情。
4. **NAS 处理器可叠加**。`continuous` 类型的处理器可以再加一段动作，强化这次情绪表达。

Runtime 是源头，语义层做强类型翻译，后端只负责渲染。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| Agent 的语义状态 | Runtime 展示画像与展示流 |
| 语义翻译 | Avatar embodiment-projection 契约 |
| NAS 处理器 API | Avatar agent-script 契约 |
| 后端专属调用 | 后端分支契约（live2d / vrm） |

## Source Basis

- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
