# 本地优先，可联邦

Nimi 让你的机器成为 AI 中心。云端是世界与身份所在的地方；你的机器是 AI 实际跑的地方。平台被设计成"只有你的电脑在线时也好用"，并且能在其他机器加入时组成更大的算力网络。

## "本地优先"对 Nimi 意味着什么

本地优先平台是这样一种平台：用户的主要设备对自己的数据与执行有真正的权威。它不是被换皮的"客户端 / 服务端"，而是断网仍能成立的一种姿态。

具体到 Nimi：

- **AI 推理在你的硬件上跑**。Runtime 拥有文本 / 图像 / 视频 / 音频 / 嵌入 / STT / TTS 的执行，并仲裁 GPU 使用。用 AI 不需要云订阅。
- **记忆与知识默认本地**。记忆是可选项；默认在本地受监督运行。知识库存在 Runtime 的本地存储里，需显式入库。
- **审计先本地**。每一次 AI 调用、每一次模型操作、每一次授权决定，都进 Runtime 本地审计账本。Realm 云端审计是另一层。
- **云端是可选项**。连接云端 AI Provider 的连接器是带显式凭证、限定作用域的强类型对象，需要你主动添加，不会被意外加入。

云端那一半（Realm）依然重要——它拥有规范化世界真相与跨世界身份。但 Realm 不在 AI 执行路径上。Realm 离线时你仍能用 AI 能力。

## 长线方向：联邦

Runtime 的愿景再走一步：一个机器之间互相联邦 AI 能力的对等算力网络。

具体方向：

- 你的机器可以为朋友承载能力。在他们同意、你授予的访问策略下，你的闲置 GPU 周期跑别人的图像生成。
- 你的机器可以调用朋友的机器。如果你的笔记本没有 GPU 但家里桌面机有，笔记本通过同样形态的 SDK 调到桌面机的 Runtime。
- 能力受限定作用域 Token 约束。联邦不等于"任何人都能用我的 GPU"。一份准入的 Token 授予一段声明的作用域，端到端保留审计血缘。

联邦是长线方向，不是当下的发布承诺。当下 Runtime 是单机的；联邦面在架构层面已被准入，未来引入联邦无需破坏本地优先契约。

## 场景：本地优先的首次启动

你在一台带独显的新笔记本上装 Nimi。

1. 启动 Runtime 守护进程。它把本地 GPU 注册为能力面，并报告设备画像。
2. 安装一个本地模型——比如能塞进 VRAM 的量化文本模型。本地引擎目录解析模型并准备好它的包。
3. 可选添加一个云端 Provider 连接器（你已订阅）。连接器是带限定作用域凭证的受管身份。
4. 打开应用。应用通过 `@nimiplatform/sdk/runtime` 调用生成。Runtime 按请求形态与你的配置决定走本地模型还是云端连接器。
5. 审计落进你的 Runtime 本地账本。如果你之后登录 Realm，可以选择把审计向上聚合，不强制。

整个过程没有任何一步要求云端订阅。云端是 Runtime 可以选择的能力，不是前置条件。

## 场景：自己两台机器之间协作

你有一台笔记本和一台桌面机。桌面机有强 GPU。

- 当下：笔记本与桌面机各跑一个 Runtime，互相独立。模型可装在任一台；身份通过 Realm 与你的账户相连；Runtime 状态本地。
- 未来：联邦面让笔记本在限定作用域 Token 下向桌面机的 Runtime 请求能力。笔记本上的应用看到的是普通的 `@nimiplatform/sdk/runtime` 调用；实际推理在桌面机上发生。审计跨两份账本保留。

这条联邦路径在 Runtime kernel 中作为未来方向被准入；当下的本地优先姿态正是未来联邦能安全展开的根基。

## 为什么本地优先对 AI 平台重要

| 风险 | 本地优先阻断的东西 |
| --- | --- |
| 厂商锁定 | Provider 连接器是强类型可替换的；平台本身不依赖任何单一 Provider |
| 订阅税 | 本地模型与本地能力是一等公民；云端是可选项 |
| 隐私泄露 | 记忆、知识、审计默认在你的机器上；云端同步显式 |
| 网络故障 | AI 工作不联网也能继续 |
| 硬件厂商绑架 | Runtime 仲裁 GPU 访问，跨硬件可移植 |

架构承诺：以上任何失败模式都不应让平台静默退化。

## 来源依据

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
