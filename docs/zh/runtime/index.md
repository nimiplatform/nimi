# Runtime

Runtime 是 Nimi 实际跑 AI 工作的那一层。它把平台层面的意图变成有规则的执行：Provider 接入、Model 管理、流式、工作流、本地能力路由、委派、审计、多模态投递，以及 Runtime 自己拥有的 Agent 参与流程。

应用不应该把 Runtime 看成一袋私有函数。Runtime 有公开合同面和明确的所有权边界。SDK 是应用代码消费这个面板的优先方式；具体规则参见 [SDK 边界](/zh/sdk/boundaries)。

## 本章节包含

- [工作流与多模态](/zh/runtime/workflows-and-multimodal) — 多步 AI 工作和非文本产物如何被治理。
- [Provider 与 Model](/zh/runtime/providers-and-models) — 当前对 Provider 和 Model 可用性的公开说法。

跨域的 [错误与兼容性](/zh/reference/errors-and-compatibility) 收集了 Runtime 错误如何呈现给应用。

## Runtime 拥有什么

Runtime 拥有所有需要在产品面板之间保持一致的执行行为：

- 请求和流式语义；
- 工作流生命周期与节点执行；
- Provider 与 Model 目录治理；
- 本地能力与设备特征路由；
- 连接器与配置规则；
- 审计、回放、失败语义；
- 委派能力闸口（gateway）和委派输出防火墙；
- Runtime 拥有的 Agent 参与、呈现、记忆基础边界。

这些职责都以 `K-*` 系列规则在 kernel 合同中独立成文；Runtime kernel 索引会列出全套。

## Runtime 不拥有什么

Runtime 不拥有 Realm 真相、桌面端 UI 决策、网页端的 release 姿态，也不拥有 Cognition 权威。当合同允许时它可以接桥或消费这些域，但不会重新定义它们。

这一区分在出问题时很关键。如果某个 Realm 读返回了不该返回的真相，修复点在 Realm，不在 Runtime 的 workaround；如果桌面端某个面板显示状态不对，修复点在桌面端，不在 Runtime 的 patch。

## 阅读场景：一次流式生成

设想一个应用调用 Runtime 在某个世界上下文里生成一段流式补全。按 Runtime 工作流合同，请求有清晰的生命周期：

1. 请求作为 `ScenarioJob` 被准入并进入 `SUBMITTED` 状态。
2. 对应的 `Workflow` 在 DAG 准备好后进入 `ACCEPTED`。
3. 流式 chunk 在流式合同下到达应用。阶段边界、终止帧、错误语义都有定义。
4. 如果生成出多模态产物（图像、音频、视频、音乐、声音），它走多模态产物合同，而不是临时的 URL。
5. 工作流到达 `COMPLETED`，写出审计记录。

这条生命周期里出任何问题，所有权都在 Runtime。应用不会自己「影子修」它，例如不会自创流式语义；它会按 Runtime 错误模型上报失败。

## 阅读场景：本地能力路由

设想桌面端用户安装了一个本地 Model，希望某种工作交给它做。Runtime 借助本地能力合同与设备特征合同决定路由到哪个引擎：

1. 本地能力注册表知道用户在该设备上准入了哪些类别。
2. 设备特征说明该设备能支持什么。
3. 本地引擎目录告诉 Runtime 哪个引擎实现这条路由。
4. 本地适配器路由确定最终适配器。

这套决策完全归 Runtime 拥有。桌面端不会绕过它，应用也不会绕过它。

## Provider 与 Model

Provider 与 Model 由 Runtime 目录合同治理：路由、能力、健康状态和错误语义都归 Runtime 拥有。想看这一面的规则，读 [Provider 与 Model](/zh/runtime/providers-and-models)。

## 来源

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
