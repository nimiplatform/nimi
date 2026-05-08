# Runtime

Runtime 是真正跑 AI 工作的那一层。它把平台意图变成受治理的执行：provider、模型目录、流式、工作流、本地路由、委派、审计、多模态产物，以及由 Runtime 持有的 Agent 参与。

应用不应把 Runtime 当成私有函数的合集来调。它有公开的契约面和清晰的归属边界。应用代码使用它的推荐方式是经由 SDK，详见 [SDK 边界](/zh/sdk/boundaries)。

## 本节包含什么

- [工作流与多模态](/zh/runtime/workflows-and-multimodal)：多步 AI 工作和非文本产物如何被治理。
- [Provider 与模型](/zh/runtime/providers-and-models)：当前关于 provider 和模型可用性的公共说明。

跨切面的 [错误与兼容性](/zh/reference/errors-and-compatibility) 一页汇总了 Runtime 错误如何呈现给应用。

## Runtime 持有什么

下面这些执行行为需要在所有产品表面保持一致，归 Runtime 所有：

- 请求与流式语义；
- 工作流生命周期与节点执行；
- provider 与模型目录治理；
- 本地能力与设备画像路由；
- 连接器与配置规则；
- 审计、回放、失败语义；
- 受委派的能力网关与受委派输出防火墙；
- Runtime 持有的 Agent 参与、呈现与记忆基底边界。

每一项责任都对应一份独立的 kernel 契约，按 `K-*` 规则族分类。规范的 runtime kernel 索引列出了每份契约对应的页。

## Runtime 不持有什么

Runtime 不持有 Realm 真相、桌面端 UI 决策、网页端发布姿态，也不持有 Cognition 权威。当契约允许时，它可以衔接或消费这些域，但不能重新定义它们。

这条分界在出问题的时候特别要紧。如果一次 Realm 读取返回了不该返回的真相，修复要做在 Realm，不能在 Runtime 里绕过去。如果一个桌面端表面把状态显示错了，修复在桌面端，不在 Runtime 打补丁。

## 读者场景：一次流式生成

某个应用调用 Runtime，在某个世界的上下文里生成一段流式补全。按 runtime workflow 契约，这次请求有一条明确的生命周期：

1. 请求被准入为 `ScenarioJob`，进入 `SUBMITTED` 状态。
2. 对应的 `Workflow` 在 DAG 准备好之后进入 `ACCEPTED`。
3. 流式分片按 streaming 契约送达应用。stage 边界、终止帧、错误语义都有明确定义。
4. 如果产生了多模态产物（图、音、视频、音乐、语音），它会按多模态产物契约传递，而不是临时拼一个 URL。
5. 工作流到达 `COMPLETED`，审计记录写入。

这条生命周期里任何一步出问题，归属都在 Runtime。应用不会自己造一套流式语义来打掩护，而是按 Runtime 错误模型上报失败。

## 读者场景：一条本地能力路由

桌面端用户装了某个本地模型，想让它来处理某一类工作。Runtime 按本地能力与设备画像契约决定路由到哪个引擎：

1. 本地能力注册表知道这台设备上用户准入了哪些类别。
2. 设备画像告诉 Runtime 设备能支撑什么。
3. 本地引擎目录告诉 Runtime 哪个引擎实现了对应路由。
4. 本地适配器路由决定最终的适配器。

整条决定链归 Runtime 所有。桌面端不绕开它，应用也不绕开它。

## Provider 与模型姿态

文档在契约层描述 provider 与模型治理。在拿到准入的 runtime 目录证据之前，文档不会公开发布可用性目录。当前姿态以及未来公开目录需要回答的问题，详见 [Provider 与模型](/zh/runtime/providers-and-models)。

## Source Basis

- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/rpc-surface.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/rpc-surface.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/delivery-gates-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delivery-gates-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
