# LocalAgent 访问与 App 授权

每个 App 看到的是同一个 LocalAgent 模型。无论 App 直接调用 SDK，还是从脚
手架搭出来，用的都是同一套强类型 Runtime 能力；不同的只是接入宿主的方
式，产品模型本身没有两套。

## 从 Session 推导访问

针对每次操作，Runtime 根据当前会话弄清：账号是谁、哪个 App 在请求、它
被授权做什么、目标是哪个 LocalAgent 或范围、请求的是哪个操作。调用方提
交强类型 intent，并在需要时给出显式的 LocalAgent ID。

你给出的 ID 只是目标，不证明你拥有它或有权访问。Runtime 会拒绝未授权或
过期的目标，同时不泄露任何内部会话材料。

## App 边界

已授权 App 可以：

- 提交强类型 LocalAgent intent；
- 读取或订阅有限的 Conversation、状态、语音、呈现、Memory 与 Knowledge
  视图；
- 观察强类型的 ready、blocked、unavailable 或 failed 状态。

App 永远不会拿到 Realm 凭证、Provider 密钥、Runtime 会话凭据、私有的授
权证据、账号级 LocalAgent 全量清单、原始服务商事件，或任何能重建内部上
下文的材料。

Nimi Home 和桌面端承载当前的本地 App 路径，但它们不会取代 Runtime 成为
授权的决定者或 LocalAgent 的运行者。

## 来源依据

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
