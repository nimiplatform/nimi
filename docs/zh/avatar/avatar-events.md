# Avatar 事件

Avatar 事件用于描述类型明确、范围受限的本地呈现结果。Avatar 自己的处理器
和组件可以据此响应渲染、播放、交互、后端与生命周期变化。它们不是公开驱动
接口，不是跨 App 事件总线，也不保存 Runtime 的 LocalAgent 事实。

## 观察事件族

| 事件族 | 本地观察内容 |
| --- | --- |
| `avatar.user.*` | 有频率限制的指针交互与命中区域结果 |
| `avatar.activity.*` | Avatar 本地活动处理的开始、完成或取消 |
| `avatar.motion.*` | 后端验证后的动作结果 |
| `avatar.expression.*` | 后端验证后的表情结果 |
| `avatar.pose.*` | 后端验证后的姿态结果 |
| `avatar.lookat.*` | 后端验证后的注视结果 |
| `avatar.speak.*` | Avatar 本地音频播放与中断结果 |
| `avatar.lipsync.*` | 范围受限的口型同步阶段，不包含逐帧公开事件 |
| `avatar.app.*` | Avatar 应用生命周期 |
| `avatar.composition.*` | 封闭的外壳生命周期 |

每个事件都有明确名称、类型化载荷、活跃 Avatar 实例、必要时经过验证的后端
结果，以及所有者规定的频率约束。这个接口不提供通配驱动钩子或通用公开取消
能力。

## Runtime 输入与 Avatar 输出

LocalAgent 参与、轮次、呈现意图、情绪状态、语音时间线、对话连续性和来源
关系都由 Runtime 管理。Avatar 通过 SDK 消费这些类型化结果，并在后端执行后
报告本地发生的事情。

例如，Runtime 的呈现活动到达后，Avatar 接受该活动，随后可以报告
`avatar.activity.start`。本地处理器和后端给出结果后，Avatar 还可以报告完成
或取消。它不会重新制造一条 Runtime 事件，也不会用渲染成功改写 Runtime
状态。

## 场景：用户点击 Avatar

1. 用户点击具身呈现中可见的区域。
2. 当前后端返回范围受限的命中区域结果。
3. Avatar 为当前实例发出类型化的 `avatar.user.click`。
4. 已支持的 Avatar 本地处理器可以在 Avatar 范围内响应。

这个事件不会向其他 App 开放原始动作、表情、渲染器或后端控制。

## 场景：语音与口型同步

1. Runtime 提供类型化的语音时间信息和音频播放输入。
2. Avatar 把音频源连接到当前 Live2D、VRM 或 Nimi2D 后端的音频消费者。
3. 后端在本地计算范围受限的嘴部权重并完成渲染。
4. 本地播放产生结果后，Avatar 可以报告播放生命周期或口型同步阶段。

逐帧嘴部参数留在渲染路径中。Avatar 不会公开已退休的逐帧口型产品事件，也
不会自行创建语音时间线事实。

## 场景：后端进入就绪状态

1. Avatar 验证 `live2d`、`vrm` 或 `nimi2d` 中的一个后端分支。
2. 后端加载资源并产生可见输出。
3. Avatar 为当前实例报告本地后端或生命周期结果。
4. Runtime 输入、实例或后端不匹配时，Avatar 拒绝成功形态的事件。

## 所有权一览

| 事项 | 所有者 |
| --- | --- |
| 本地渲染、播放、交互、后端与生命周期观察 | Avatar |
| 本地事件处理器 | Avatar |
| LocalAgent 参与、呈现、状态、语音时间线、对话连续性和来源关系 | Runtime |
| 后端参数执行 | 当前 Avatar 后端分支 |
| 跨 App 产品状态 | 对应的 Realm 或 Runtime 接口 |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
