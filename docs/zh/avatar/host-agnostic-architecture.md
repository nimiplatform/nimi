# 宿主无关架构

> 状态：现已可用。宿主无关的映射层是 Avatar 正在运行的核心；后端分支都接在这一层上。

Avatar 的架构只围绕一个承诺：**Agent 语义不属于任何渲染器**。Agent 在做什么——它的活动、表情、姿态、视线和语音——是 Runtime 维护的事实。Live2D、VRM 以及未来的任何后端，都是同一层后端无关映射之下可以互换的执行分支。

教学模型如下：

```
agent semantics  →  embodiment projection  →  backend-specific execution
```

- **Agent 语义**在 Runtime / SDK 一侧：活动 id、呈现流、情绪状态和对话锚点都在那里。Avatar 从不自己发明语义真相。
- **具身映射**是 Avatar 的宿主无关 API。它消费 Runtime 的语义包和事件流，翻译成后端中立的提示：`activity`、`expression`、`pose`、`lookat`、`status_text`、`speak`、命中区域意图和外壳意图。
- **后端执行**看当前挂载的是哪个分支：今天是经 Cubism SDK for Web 的 Live2D；明天是经 three-vrm 的 VRM。每个后端都实现同一个 `BackendBranch` 接口。

## 映射层的所有权

| 层 | 所有权 | 非所有权 |
| --- | --- | --- |
| 智能体语义 (运行时 / SDK) | 活动、情感、姿态、状态文本、呈现流、对话锚点 | 每帧后端调用 |
| 具身映射 (Avatar) | 后端中立提示转换、外壳边界意图、命中区域意图、NAS 处理器 API 接口 | 运行时语义真相、后端像素 |
| 后端分支 (Live2D / VRM / …) | 模型加载、参数写入、绘制循环、音频桥接、Alpha 遮罩 | 后端选择 (封闭联合、内核准入) |

映射层是语义与渲染相遇的**唯一**场所。NAS 处理器位于其上方；后端分支位于其下方。

## 封闭后端联合

后端并非可插拔的字符串。`BackendKind` 是一个封闭的判别联合类型：`'live2d' | 'vrm'`。新增后端需要修订契约。因此今天针对映射 API 编写的 NAS 处理器在 VRM 发布后仍能继续工作——处理器不会硬编码后端。

存在后端特定的扩展（例如，用于参数 ID 直接写入的 `Live2DBackendExtension`），但它们只有在类型收窄后才能访问。使用 `live2dExtension` 的处理器声明 `requires: ['live2d-extension']`，并接受它将无法在非 Live2D 后端上运行。

## 读者场景：同一处理器在两个后端上运行

包作者在 `<model>/runtime/nimi/activity/wave.js` 处编写了一个 `wave` 活动处理器。该处理器调用映射方法：运动、表情、等待、姿态。不使用 `live2dExtension`。不包含后端字面量。

1.  **今日 (Live2D 已挂载)。** 映射将运动/表情调用转换为 Cubism API 调用；波浪动作播放。
2.  **明日 (VRM 已挂载)。** 映射将相同的调用转换为 three-vrm API 调用；波浪动作播放 VRM 等效效果。
3.  **同一处理器，两个后端。** 具身包中没有针对特定后端的代码。封闭联合确保了这种安全性——处理器不会引入一个映射无法转换的第三方后端。

## 读者场景：载体边界保持后端无关

Avatar 窗口必须根据当前活动后端渲染的内容调整自身大小：今日是 Live2D 模型 Alpha 边界框，明日是 VRM 视口。

1.  **后端报告 `BackendNominalBounds`。** 宽度、高度、身体中心。由后端定义；由映射消费。
2.  **应用外壳通过映射消费。** 窗口 `set_size` 通过映射拥有的外壳意图发生，而非通过 Live2D 调用。
3.  **伴随表面组合。** 始终可见的伴随表面将其足迹添加到具身边界；外壳在每次更改时调整大小。

Avatar 窗口不知道是 Live2D 还是 VRM 已挂载。它只消费映射。

## 读者场景：跨表面连续性

同一个智能体出现在桌面聊天和 Avatar 载体中。两者必须同时反映相同的情感。

1.  **运行时发出 `runtime.agent.state.emotion_changed`。** 具有权威性。
2.  **映射转换。** Avatar 消费该事件；映射发出一个带有类型化转换的 `avatar.expression.changed` 事件。
3.  **后端渲染。** Live2D 参数更新；载体显示新表情。
4.  **桌面聊天表面也反映。** 桌面的 `.nimi/spec/desktop/agent-projection.authority.yaml` 直接消费运行时事件；两个表面保持同步，因为运行时是单一数据源。

载体和聊天表面无需相互协调。它们都消费运行时。

## 边界总结

| 关注点 | 所有者 | 接口/表面 |
| --- | --- | --- |
| 活动 / 情感 / 姿态真相 | 运行时 | `runtime.agent.*` 事件 |
| 持久化呈现配置 | Runtime | 类型化的 Runtime 呈现配置 |
| 后端无关接口 | Avatar | `BackendProjection` |
| 后端执行 | 当前后端分支 | 封闭的 Live2D、VRM 或 Nimi2D 分支 |
| 处理器约定 | Avatar (NAS) | Avatar 本地准入处理器 |
| 桌面聊天智能体瞬态表面 | 桌面 | `.nimi/spec/desktop/agent-projection.authority.yaml` |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
