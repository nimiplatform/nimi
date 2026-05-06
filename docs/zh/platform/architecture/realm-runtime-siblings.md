# Realm 和 Runtime 是同侪

Realm 和 Runtime 是让 Nimi 工作的两半，它们被有意造成同侪 — 谁都不依赖谁的存在。SDK 是唯一桥接它们的东西。

## 为什么是两半而不是一半

大多数 AI 产品把"云"和"本地 AI 引擎"合成一个系统：云是真相来源，瘦客户端跟它说话。Nimi 故意切开。

- **Realm** 是云端真相。它拥有世界真相、世界状态、世界历史、身份、社交图、规范经济、资产注册表、聊天 thread、云端审计 ledger。Realm 是让"同一个朋友、同一个钱包、同一个 Agent，在任何世界、任何设备上"成为现实的那一半。
- **Runtime** 是个人 PC 的 AI 引擎。它拥有 AI 推理（文本、图像、视频、音频、Embedding、STT、TTS）、GPU 仲裁、本地 Model 生命周期、工作流、Agent 执行（Chat Track 和 Life Track）、runtime 本地记忆、知识库、应用间消息、委派能力闸口、本地审计 ledger。

每一半有自己的状态机、自己的合同、自己的存储、自己的审计。**关键是**：两半都不假设另一半在跑。

## "同侪"在实操中是什么意思

| 性质 | 含义 |
| --- | --- |
| 没有依赖边 | Runtime 不需要 Realm 才能启动；Realm 不需要 Runtime 才能启动 |
| 各自独立的失败模式 | Realm 离线不挡住本地 AI 工作；Runtime 离线不挡住从 Realm 读世界真相 |
| 各自独立的所有权 | Runtime 不能改 Realm 真相；Realm 不能在你的硬件上跑 AI |
| 通过 SDK 桥接 | App 通过同一个 `@nimiplatform/sdk` 触达两半；SDK 是接缝，不是 Realm 和 Runtime 之间的后门 |

有一条特例不是同侪边：`Runtime ↔ Cognition`。Runtime 可以通过定义好的桥合同消费 Cognition 的独立记忆和知识面。这是消费，不是吸收 — Cognition 的权威仍然属于自己。

## 阅读场景：Realm 离线时 Runtime 还能跑

你在一台笔记本上跑 Nimi，网络断了。

- Runtime daemon 仍然在线。你照样可以调本地 Model、用本地 stable-diffusion 生成图、跟本地 Agent 说话、跑工作流。
- Realm 读失败。跨世界身份、规范社交图、经济结算在你重连前不可用。
- 本地审计继续记录。Realm 回来时，runtime 可以选择把本地审计聚合到云端；它**不会**回头改写本地审计真相。
- 既读 Runtime 又读 Realm 的 App 优雅降级 — 显示「Realm 离线」而不是装作云在线。

这就是同侪设计带来的：你**不会**因为云不可达就丢失 AI 能力。

## 阅读场景：Runtime 离线时 Realm 还能用

你在一台不跑本地 AI 引擎的手机或低功耗设备上读 Nimi 世界。

- Realm 读正常。你可以浏览世界、看消息、看社交图、看资产。
- 本地 AI 推理不可用 — 这台设备上没有 Runtime daemon。
- 需要生成的 App 要么走你主机器上的 Runtime（联邦，未来）要么呈现一条「无 runtime 可用」的路径。它们**不会**无声地回退到一条用户没同意的托管路由。

没 Runtime 的设备仍然是 Nimi 设备 — 它是真相那一半的瘦客户端。

## SDK 为什么桥接两半

SDK 是让"两个同侪"对 App 开发者的视角变成"一个平台"的东西。一个 `createPlatformClient()` 通过同一个类型化面暴露 realm 读和 runtime 调用。App 不需要知道 Realm 是 REST + WebSocket、Runtime 是 gRPC；不需要知道当前用的是哪个 transport profile（`node-grpc`、`tauri-ipc`、`local-broker`）。

SDK **不**做的事：它**不**发明会破坏同侪边界的捷径。没有任何 SDK 调用通过 runtime 路径改 Realm 真相；没有任何 SDK 调用通过 realm 路径读 runtime 本地状态。权威层面重要的边界，在开发者面上被保留。

## 来源

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
