# 本地优先，可联邦

Nimi 把你的机器当作 AI 中心。云端是世界和身份住的地方；你的机器是 AI 实际跑的地方。平台被设计成"只有你的电脑在线时也好用"，并且能在其他机器加入时组成一个更大的算力网络。

## "本地优先"对 Nimi 意味着什么

本地优先平台是用户主设备对自己数据和执行有真实权威的平台。它不是改名的「客户端-服务器」 — 它是一种**离线也能活下来**的姿态。

在 Nimi 这里：

- **AI 推理在你的硬件上跑**。Runtime 拥有文本 / 图像 / 视频 / 音频 / Embedding / STT / TTS 执行，并仲裁 GPU 使用。你不需要云订阅就能用 AI。
- **记忆和知识默认本地**。记忆是 opt-in；默认底层在本地受监督运行。知识库住在 runtime 本地存储里，靠显式 ingest。
- **审计本地优先**。每次 AI 调用、每次 Model 操作、每次授权决策都落在 runtime 本地审计 ledger。Realm 云审计是另一个面。
- **云是 opt-in**。到云端 AI Provider 的连接器是有类型、有 scope 的凭证，是你**选择**加上去的，不会被意外加上。

云端那一半（Realm）仍然重要 — 它拥有规范世界真相和跨世界身份。但 Realm **不**在 AI 执行路径上。Realm 离线时你仍然有 AI 能力。

## 联邦方向（长期）

Runtime 愿景再往前一步：一个对等的算力网络，机器之间联邦 AI 能力。

具体长期方向：

- 你的机器可以为朋友承载能力。你闲置的 GPU 周期在他人同意和你的访问策略下跑别人的图像生成。
- 你的机器可以调进朋友的机器。如果你的笔记本没 GPU 但你家的台式机有，笔记本通过同样的 SDK 形状跟台式机的 runtime 说话。
- 能力被 scoped token 限定。联邦不是"任何人都能用我的 GPU"，而是已认可 token 授予一个声明的 scope，审计 lineage 端到端保留。

联邦是长期方向，不是当下要交付的承诺。当前 Runtime 是单机；联邦面在架构层被认可，让未来的联邦不必打破本地优先合同。

## 阅读场景：第一次本地优先安装

你在一台带独显的全新笔记本上装 Nimi。

1. 你启动 Runtime daemon。它把本地 GPU 注册成能力面，并报告设备特征。
2. 你装一个本地 Model — 比如一个能装进显存的量化文本 Model。本地引擎目录解析 Model 并准备它的 bundle。
3. 你可选地加一个云端 Provider 连接器（如果你有相应订阅）。连接器是带 scoped 凭据的受管身份。
4. 你打开一个 App。App 通过 `sdk/runtime` 调生成。Runtime 根据请求形状和你的配置，决定路由到本地 Model 还是云端连接器。
5. 审计落在你 runtime 本地 ledger。如果以后你登 Realm，你可以选择把审计聚合到云端；不一定要这么做。

整个过程平台没有要求云订阅。云是你 runtime 可以选择路由过去的能力，**不**是前置条件。

## 阅读场景：跨自己两台机器工作

你有一台笔记本一台台式机。台式机有强力 GPU。

- 现在：你的笔记本和台式机各跑自己的 Runtime。彼此独立。Model 哪台都能装；身份通过 Realm 绑到你的账号；runtime 状态本地。
- 未来：联邦面让笔记本通过 scoped token 向台式机的 Runtime 请求能力。笔记本上的 App 看到的是普通的 `sdk/runtime` 调用；实际推理跑在台式机。审计在两台 ledger 上保留。

这条联邦流程在 runtime kernel 里作为未来方向被认可；今天的本地优先姿态正是让未来联邦安全的前提。

## 为什么本地优先对 AI 平台重要

| 风险 | 本地优先如何避免 |
| --- | --- |
| Vendor lock-in | Provider 连接器有类型可替换；平台本身不依赖任一 Provider |
| 订阅税 | 本地 Model 和本地能力是一等的；云端 opt-in |
| 隐私泄露 | 记忆、知识、审计默认在你机器上；云同步是显式的 |
| 网络断连 | AI 工作没有网也继续跑 |
| 硬件 vendor 绑架 | runtime 仲裁 GPU 访问，跨硬件可移植 |

架构承诺：上面这些失败模式都不能让平台无声降级。

## 来源

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/connector-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/connector-contract.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
