# 智能体呈现流

> 状态：运行中 (Running) 今日。瞬时呈现接口（轮次投影 + 呈现事件 + 状态事件）已发布；面向模型的 APML 传输格式已准入。

智能体呈现流是运行时与任何希望实时渲染智能体行为的应用之间的**瞬时投影接口**——例如，桌面聊天显示消息文本流式传输，Avatar 渲染情感变化，工具包消费者读取轮次生命周期。

它不同于**持久化**的 `AgentPresentationProfile`（缓慢变化的默认语音/资产/表情预设绑定），也不同于**面向模型**的 APML 传输格式。应用消费的是类型化投影，而非原始 APML 或持久化配置文件。

## 权限边界

| 层级 | 所有者 | 所属职责 |
| --- | --- | --- |
| 持久化呈现配置文件 | 运行时 (`agent-presentation-contract.md`) | 默认语音 + 资产 + 表情预设绑定 |
| 面向模型的 APML 传输格式 | 运行时 (`agent-output-wire-contract.md`) | 公共 APML 标签准入、解析器验证、映射到类型化投影 |
| 瞬时呈现流 | 运行时 (`agent-presentation-stream-contract.md`) | 锚点作用域的轮次生命周期 + 瞬时呈现请求 + 当前情感投影 |
| 渲染器本地插值/物理 | 各应用（Avatar、桌面、工具包） | 视觉/音频渲染 |

该流是**运行时拥有的已提交真实状态**。渲染器本地插值、运动句柄、Live2D 参数写入和外壳编排是应用本地关注点。

## 已准入的投影家族

运行时拥有的稳定投影家族：

### 轮次生命周期 (`runtime.agent.turn.*`)

锚点作用域、流作用域的事件，涵盖从接受到完成的一个轮次。

| 家族 | 用途 |
| --- | --- |
| `runtime.agent.turn.accepted` | 轮次已准入运行时 |
| `runtime.agent.turn.started` | 轮次执行开始 |
| `runtime.agent.turn.reasoning_delta` | 推理文本块 |
| `runtime.agent.turn.text_delta` | 用户可见文本块 |
| `runtime.agent.turn.structured` | 结构化输出负载 |
| `runtime.agent.turn.message_committed` | 消息已提交（携带 `message_id`） |
| `runtime.agent.turn.post_turn` | 轮次后准入活动（例如，伴随服务） |
| `runtime.agent.turn.completed` | 成功终结 |
| `runtime.agent.turn.failed` | 失败终结 |
| `runtime.agent.turn.interrupted` | 用户发起的打断 |
| `runtime.agent.turn.interrupt_ack` | 运行时确认打断 |

所需封装结构：`agent_id`、`conversation_anchor_id`、`turn_id`、`stream_id`。`message_committed` 额外携带 `message_id`。

### 呈现请求 (`runtime.agent.presentation.*`)

流作用域的瞬时呈现投影——智能体希望具身/聊天界面在此轮次中执行的操作。

| 家族 | 用途 |
| --- | --- |
| `runtime.agent.presentation.activity_requested` | 活动意图（已准入的活动本体 ID） |
| `runtime.agent.presentation.motion_requested` | 动作意图 |
| `runtime.agent.presentation.expression_requested` | 表情意图 |
| `runtime.agent.presentation.pose_requested` | 姿态意图 |
| `runtime.agent.presentation.pose_cleared` | 清除姿态 |
| `runtime.agent.presentation.lookat_requested` | 注视意图 |

所需封装结构：`agent_id`、`conversation_anchor_id`、`turn_id`、`stream_id`。

### 智能体状态 (`runtime.agent.state.*`)

智能体作用域的投影，可能源自某个锚点/轮次，但作用于整个智能体。

| 家族 | 用途 |
| --- | --- |
| `runtime.agent.state.status_text_changed` | 自由文本状态更新 |
| `runtime.agent.state.execution_state_changed` | 执行生命周期状态 |
| `runtime.agent.state.emotion_changed` | 当前情感投影 |
| `runtime.agent.state.posture_changed` | 姿势投影 |

所需封装结构：`agent_id`。与锚点/轮次/流的源头关联是可选的，仅当状态投影可追溯到特定的连续性分支时才存在。

### 钩子 (`runtime.agent.hook.*`)

与状态具有相同的封装结构——智能体作用域，锚点关联可选。有关钩子侧的框架，请参阅[平台 → 智能体 → 钩子意图](/platform/agents/hook-intent)。

## APML：面向模型的传输格式，而非应用消费

对于 Live2D 伴随底层支持方向，已准入的面向模型的传输格式是 **APML** 内联标记。模型发出 APML；运行时解析 + 验证；运行时发出类型化投影；**应用消费的是类型化投影，绝非原始 APML 解析器事件**。

| 公共 APML 标签 | 准入位置 |
| --- | --- |
| `<message>` (顶层) | 用户可见的轮次文本主体 |
| `<emotion>` (消息内部) | 投影到运行时当前情感状态 |
| `<activity>` (消息内部) | 投影到运行时活动本体 |
| `<action kind="image\|voice">` (同级) | 带有 `<prompt-payload>` + `<prompt-text>` 的图像/语音动作 |
| `<time-hook>` (顶层) | 基于时间的钩子意图 |
| `<event-hook>` (顶层) | 窄范围事件钩子（`event-user-idle` / `event-chat-ended`），带有 `<effect kind="follow-up-turn">` |

公共 APML **不**准入以下内容：

- 直接的 `<motion>`、`<expression>`、`<lookat>`、`<pose>`、
  `<clear-pose>`（这些是下游 Avatar 投影路由——请参阅
  [生成运动提供者](/avatar/generated-motion-provider.md)）
- 语音韵律、表面路由、通知、工具调用、
  思维链、内存写入、姿势/状态、钩子取消、
  命名空间扩展、模块扩展、解析器事件语法
- 视频动作
- 原始 `apml.*` 事件

格式错误的 APML 会导致轮次闭环失败，并伴随可观察的轮次故障。不存在“尽力恢复”或“隔离式 JSON 回退”——模型必须发出已准入的 APML，否则轮次将失败。

## 流提交、打断与失败

| 事件 | 语义 |
| --- | --- |
| `turn.message_committed` | 消息文本在 `message_id` 下持久提交；下游消费者（Realm 聊天）以此事件为锚点 |
| `turn.interrupted` | 用户在轮次中途打断；根据流策略保留部分内容 |
| `turn.interrupt_ack` | 运行时确认打断；下游界面停止流式传输 |
| `turn.failed` | 终结性失败；轮次不会留下未提交的待处理状态 |
| `turn.completed` | 终结性成功 |

打断是**锚点作用域的**：相同锚点的界面共享打断传播；同一智能体下不同锚点的界面则不共享。

## 读者场景：桌面聊天渲染流式回复

用户在桌面聊天中提交一个轮次。

1.  **提交。** 桌面调用运行时以开始轮次。
2.  **已接受 + 已开始。** `turn.accepted` 随后 `turn.started` 传播到所有连接到锚点的界面。
3.  **文本增量流。** `turn.text_delta` 事件按顺序到达；桌面聊天增量渲染。
4.  **呈现请求触发。** 轮次中途，`presentation.expression_requested` 触发；Avatar（也已连接）更新表情，即使文本仍在流式传输。
5.  **消息提交。** `turn.message_committed` 携带 `message_id`；Realm 聊天将消息锚定在会话线程下。
6.  **轮次完成。** `turn.completed` 终结事件。

三个界面，一个类型化事件流，没有应用自行定义轮次语义。

## 读者场景：APML 驱动文本和具身

模型发出一个 APML 响应，其中包含带有情感提示和活动提示的消息。

1.  **模型发出。** `<message><emotion name="happy" /><activity name="wave" />
    Hi! It's good to see you.</message>`。
2.  **运行时解析。** APML 解析器验证；准入投影。
3.  **类型化事件触发。** `turn.text_delta` 携带用户可见文本；`state.emotion_changed` 投影“happy”；`presentation.activity_requested` 投影“wave”，并带有已准入的活动本体 ID。
4.  **应用消费。** 桌面聊天渲染文本；Avatar 的投影层通过活跃后端路由活动；Avatar 事件总线触发 `avatar.expression.changed`。

模型编写了 APML；应用消费了类型化事件。APML 绝不会以原始解析器输出的形式到达应用。

## 读者场景：用户在流式传输中途打断

用户在轮次流式传输时点击停止。

1.  **打断请求。** 应用调用运行时打断 API 以处理当前轮次。
2.  **`turn.interrupted` 触发。** 所有相同锚点的界面停止流式传输。
3.  **`turn.interrupt_ack` 触发。** 运行时确认打断语义；部分文本被保留。
4.  **下一个轮次干净启动。** 没有遗留的待处理状态。

打断协议已准入；应用不会在其之上自行定义“取消”语义。

## 流不执行的操作

- 它不拥有渲染器本地插值或物理。
- 它不拥有后端特定的运动句柄或 Live2D 参数写入（这些是 Avatar 后端执行）。
- 它不拥有 Avatar 放置或外壳编排。
- 它不准入 JSON 消息-动作传输格式；APML 是此发展路线的已准入公共模型传输格式。
- 它不准入尽力 APML 修复；格式错误的 APML 会导致轮次闭环失败。

## 边界摘要

| 关注点 | 所有者 |
| --- | --- |
| 持久化呈现配置文件（默认语音/预设/资产） | 运行时 (`agent-presentation-contract.md`) |
| 面向模型的 APML 传输格式 | 运行时 (`agent-output-wire-contract.md`) |
| 瞬时流（轮次 + 呈现 + 状态事件） | 运行时 (`agent-presentation-stream-contract.md`) |
| 渲染器本地执行 | 各应用（Avatar / 桌面 / 工具包消费者） |
| 会话连续性 | 运行时 (`agent-conversation-anchor-contract.md`) |

## 来源依据

- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml)