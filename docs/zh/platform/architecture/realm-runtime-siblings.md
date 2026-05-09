# Realm 与 Runtime 是同侪

Realm 与 Runtime 是 Nimi 工作的两半。它们被有意造成同侪关系：哪一半都不依赖另一半的存在。SDK 是把它们桥起来的唯一面。

## 为什么是两半，而不是一整块

主流 AI 产品把「云」和「本地 AI 引擎」融成一体：云是真相源，瘦客户端跟它说话。Nimi 有意拆开。

- **Realm** 是云一侧的真相。它持有世界真相、世界状态、世界历史、身份、社交图、规范化经济、资产注册表、聊天线程、云侧审计账本。Realm 是「在任何世界、任何设备上，是同一个朋友、同一个钱包、同一个 Agent」之所以成立的根据。
- **Runtime** 是个人 PC 上的 AI 引擎。它持有 AI 推理（文本、图像、视频、音频、embedding、STT、TTS）、GPU 仲裁、本地模型生命周期、工作流、Agent 执行（Chat Track 与 Life Track）、本地 memory、知识 bank、App 间消息、委派能力网关、本地审计账本。

两半各自有自己的状态机、契约、存储、审计。关键在于：哪一半都不假设另一半正在运行。

## 「同侪」在实际中意味着什么

| 属性 | 含义 |
| --- | --- |
| 没有依赖边 | Runtime 启动不需要 Realm；Realm 启动不需要 Runtime。 |
| 失败模式独立 | Realm 离线不阻断本地 AI；Runtime 离线不阻断从 Realm 读世界真相。 |
| 归属独立 | Runtime 不能改 Realm 真相；Realm 不能在你的硬件上跑 AI。 |
| 经由 SDK 桥接 | App 通过同一个 `@nimiplatform/sdk` 接到两边；SDK 是缝，不是 Realm 与 Runtime 之间的暗道。 |

有一条特别说明的桥不属于同侪边：`Runtime ↔ Cognition`。Runtime 在已定义的桥契约下，可以消费 Cognition 独立持有的 memory 与知识面。这是消费，不是吸并 —— Cognition 的权威仍归它自己。

## 场景：Realm 离线时 Runtime 仍在工作

你在笔记本上跑着 Nimi，网络掉了。

- Runtime 守护进程仍在。本地模型仍能调用，本地 stable-diffusion 仍能生图，本地 Agent 仍能对话，工作流仍能运行。
- Realm 读取失败。跨世界身份、规范化社交图、经济结算在恢复连接之前不可达。
- 本地审计继续记录。Realm 恢复后，Runtime 可以把本地审计向上汇总；它不会回写或重写本地的审计真相。
- 同时读 Runtime 与 Realm 的 App 优雅退化 —— 它们显示「Realm 离线」，不假装云仍然在线。

这就是同侪设计买来的东西：云不可达，并不让你失去 AI 能力。

## 场景：Runtime 不在时 Realm 正常工作

你在手机或一台不跑本地 AI 引擎的低功耗设备上读 Nimi 世界。

- Realm 读取正常。你能浏览世界、看消息、看社交图、看资产。
- 本地 AI 推理不可用 —— 这台设备没有本地 Runtime 守护进程。
- 需要生成的 App，要么把请求路由到你主机器上的 Runtime（联邦，未来方向），要么呈现「无可用 runtime」路径。它们不会偷偷转走到一个用户没同意的托管路由上。

没有 Runtime 的设备仍是 Nimi 设备 —— 它是真相一侧的瘦客户端。

## SDK 为什么把两半都桥上

SDK 让「两个同侪」从 App 开发者视角看起来是一个平台。`createPlatformClient()` 一次性把 Realm 读取与 Runtime 调用呈现在同一个强类型面上。App 不必知道 Realm 是 REST + WebSocket、Runtime 是 gRPC；也不必知道当前是哪一种传输画像（`node-grpc`、`tauri-ipc`、`local-broker`）。

SDK 不会做的事：它不发明任何破坏同侪边界的捷径。没有哪一个 SDK 调用会经由 Runtime 路径去改 Realm 真相，也没有哪一个 SDK 调用会经由 Realm 路径去读 Runtime 本地状态。权威级的边界，在开发者面上同样保留。

## 来源依据

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
