# Avatar 具身呈现

Nimi Avatar 在独立桌面窗口中呈现智能体的形象、动作与具身交互。无论承载窗口或图形后端如何变化，核心原则始终一致：**外在呈现可按宿主环境适配，但 Agent 的身份与记忆保持唯一且连贯**，不会因为切换渲染后端或窗口形态而分裂成孤立的智能体。

## 什么是 Avatar

Avatar 不只是静态立绘或 3D 网格，而是 AI 参与者的**呈现与交互层**，涵盖模型网格与骨骼、面部表情与肢体动作、本地交互事件、宿主承载能力校验，以及面向 Live2D 与 VRM 两个图形后端的渲染管线。

呈现层忠实反映 Agent 的底层状态，不自行维护平行的业务真相：
- 如果画面卡顿或渲染异常，这只是呈现层的局部问题，不代表底层 Agent 离线；
- 如果宿主调整本地呈现或报告模型不可用，这只是本地渲染适配，Agent 的人格与认知状态不会改变。

## 职责边界

**Avatar 负责：**
- 将 Agent 的具身语义（动作、表情、视线等）投射到具体宿主窗口与舞台；
- 校验宿主环境与渲染后端能否承载指定视觉模型，并在不兼容时报告明确的错误；
- 管理桌面等宿主环境下的渲染管线分支。

**Avatar 不负责：**
- 角色（Character）的持久化身份（由 Realm 管理）与 LocalAgent 的执行生命周期（由 Runtime 管理）；
- Agent 的长期记忆（由 Cognition 管理并经 Runtime 访问，Runtime 同时维护活跃会话状态）；
- 虚拟世界内的社交关系网络（由 Realm 管理）；
- 对话推理生成与多轮认知规划（由 Runtime 调度）。

明确这一边界是为了保证单一可信源：呈现层不能自行决定“Agent 是谁”或“Agent 记得什么”，否则就会与底层状态冲突，破坏跨端体验的一致性。

## 典型场景：宿主无法承载完整具身能力

当某个具身资产包含当前环境不支持的骨骼动画或特效要求时：

1. **能力校验**：宿主根据视觉准入契约评估该资产的兼容性。
2. **拒绝破损渲染**：系统不会静默展示破损网格或错乱表情，而是按契约执行受控处理——在必需模型或后端不受支持时返回明确的不兼容错误。
3. **保持底层状态完整**：无论呈现层如何调整，Realm 中的角色档案与 Runtime 中的 Agent 认知状态都保持不变。

## 典型场景：为什么 Avatar 与 Runtime 解耦

将呈现层作为独立架构域，而不是内置在 Runtime 中，主要基于三点考量：

- **宿主与后端差异**：同一具身语义需要投射到不同形态的窗口、舞台与图形后端；
- **独立的视觉准入标准**：图形渲染关注帧率预算、GPU 着色器、内存阈值与贴图格式，与推理调度指标完全不同；
- **独立排查与重放**：渲染故障可以作为纯粹的图形管线问题独立调试和重放，不必混入复杂的对话会话状态。

将呈现与 Runtime 解耦，能让各自的契约边界保持清晰、可测且易于演进。

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
