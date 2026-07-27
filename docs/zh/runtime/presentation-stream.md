# LocalAgent Presentation Stream

Runtime 持有短暂 LocalAgent turn、状态、activity、emotion、voice、interruption
与 presentation 投影真相。Consumer 只持有自己的渲染、playback、interaction
和短暂 UI 状态。

## 投影边界

Presentation stream 只携带强类型、已授权的产品 event。Runtime 在提交任何
event 前校验 model 与 Provider output。原始 parser payload、Provider
metadata、Credential、prompt、tool material 与内部 proof 都不会成为公共
stream 字段。

访问从 active session 推导。操作需要目标时，consumer 必须提供显式
LocalAgent 或 Conversation target，不能推断全局 current LocalAgent。

## Avatar 与其他 Renderer

Avatar 可以把强类型 Runtime input 映射为 renderer-local motion、expression、
camera、physics、lipsync 与 playback。这些细节留在 Avatar 本地，renderer
state 不能写回成为 LocalAgent 真相，App 也不会取得 raw motion 或 driver
control。

Desktop 与其他 App 遵循同一规则：可见状态是投影，不是合成或覆盖 Runtime
状态的权限。

## 失败行为

不可用的 diagnostics、voice 或可选 presentation 细节应单独报告强类型状态，
不能伪造 Runtime success，也不能阻塞无关 LocalAgent Conversation。

## 来源依据

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
