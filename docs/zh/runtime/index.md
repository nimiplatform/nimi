# Runtime

Runtime 是实际承担 AI 任务执行的底层架构。它负责将平台层面的意图转化为受严格治理的执行操作。这其中包括管理提供商（Provider）、模型目录、流式传输、工作流、本地路由策略、权责委派、行为审计、多模态产物，以及由 Runtime 直接维护的 Agent 参与逻辑。

应用开发时不应将 Runtime 视作可随意调用的内部函数库。Runtime 具备公开的标准契约面与清晰的职责归属边界。应用代码调用 Runtime 的推荐路径是经由 SDK 接入，详见 [SDK 边界](/zh/sdk/boundaries)。

## 本节包含的内容

执行表面：

- [工作流](/zh/runtime/workflows)：探讨 DAG 执行模型、强类型的节点种类，以及工作流状态机。
- [流式传输](/zh/runtime/streaming)：剖析四种流式模式、终止帧机制、反压（Backpressure）控制以及 Fail-Closed 语义。
- [多模态执行](/zh/runtime/multimodal)：涵盖图像、视频、音频、语音与音乐的能力契约；Provider 异步任务生命周期机制及产物归一化处理。
- [Agent 执行机制](/zh/runtime/agent-execution)：介绍 Chat Track 与 Life Track 调度模式、Hook 意图的分发逻辑，以及 APML 输出格式。
- [记忆与知识](/zh/runtime/memory-and-knowledge)：阐述 Runtime 维护的基础记忆底座，及其与 Cognition 模块的桥接。

Provider 与路由：

- [连接器与 Provider](/zh/runtime/connectors-and-providers)：说明受管云端 Provider 身份认证、连接器生命周期、归一化的远端执行路径，以及凭证面的分离策略。
- [本地模型](/zh/runtime/local-models)：探讨本地引擎挂载、引擎优先的路由逻辑、本地模型目录搜索，以及设备画像解析方案。

运维与扩展能力：

- [CLI 与 Daemon](/zh/runtime/cli-and-daemon)：解析后台守护进程（Daemon）的生命周期、RPC 接口暴露规则，以及首次接入引导流程。
- [委派能力](/zh/runtime/delegated-capability)：介绍外部 AI 接入网关、委派输出的安全防火墙，以及相关的授权审批与审计追踪。
- [本地审计](/zh/runtime/audit-local)：说明 Runtime 内部的本地审计账本记录机制及回放模型。

此外，跨切面的 [错误归属](/zh/reference/error-ownership) 章节汇总了 Runtime 层的错误如何标准化地暴露给上层应用；[兼容姿态](/zh/reference/compatibility-posture) 则列出了约束 Runtime 契约的平台级向下兼容范围。

## Runtime 的权责范围

为确保平台级执行行为在各产品表面的一致性，以下核心职责完全由 Runtime 掌控：

- 统一的请求生命周期与流式传输语义；
- 工作流生命周期的编排与底层节点执行；
- 提供商（Provider）与模型目录的准入与治理；
- 本地计算能力的探测与基于设备画像的路由；
- 服务连接器的生命周期管理及配置规则；
- 审计记录、场景回放支撑以及标准化的失败语义；
- 面向受委派能力的外部接入网关及受委派输出安全防火墙；
- 维持 Agent 参与的基础状态、呈现接口及底层记忆基底边界。

每一项职责均对应一份独立的内核（Kernel）契约，并归属于 `K-*` 规则族。通过查阅 Runtime 内核索引，可找到各项职责对应的具体契约规范。

## Runtime 不包含的权责

Runtime 不掌控 Realm 层的世界真相定义权、不决定桌面端的 UI 呈现策略、不负责网页端的发布姿态，亦无权干涉 Cognition 层的核心权威。在遵循特定契约的前提下，Runtime 可以桥接并消费这些域的服务与数据，但无权覆盖或重新定义它们。

这种权责分界在系统排错时尤为重要。如果一次 Realm 查询返回了异常的真相数据，修复工作必须深入 Realm 层内部进行，绝不可在 Runtime 层通过临时代码绕过。同样，若桌面端 UI 将内部状态错误地呈现给用户，修复点必定在于桌面端，而非 Runtime。

## 场景演示：单次流式生成任务

设想某应用调用了 Runtime，在特定世界的上下文中生成一段流式文本。依据 Runtime 工作流契约，该请求将经历以下生命周期：

1. 用户的请求被准入，实例化为一个 `ScenarioJob`，状态变更为 `SUBMITTED`。
2. 随着后端 DAG 拓扑准备就绪，对应的 `Workflow` 过渡至 `ACCEPTED` 状态。
3. 文本流式分片将严格遵照流式传输（Streaming）契约推送至应用。执行阶段（Stage）切换边界、终止帧的送达时机以及异常错误语义，均受到一致的控制。
4. 若任务产生了多模态附属产物（如图像、音频、视频、音乐或语音），这些产物必须依循专门的多模态产物契约进行传递，严禁使用非标准的临时 URL。
5. 最终，工作流流转至 `COMPLETED` 状态，底层审计账本记录同步写入。

在此生命周期中，任何环节发生故障，责任均归属于 Runtime。上层应用应当忠实地依据 Runtime 的标准化错误模型向上报告，而不应私自构建容错逻辑以掩盖底层错误。

## 场景演示：本地能力的智能路由

假设一位桌面端用户自行安装了某个本地 AI 模型，并期望以此处理特定任务。此时，Runtime 将基于本地能力规范与设备画像契约，决策目标执行引擎：

1. 本地能力注册表向 Runtime 报告该设备已开放的能力类别。
2. 设备硬件画像模块向 Runtime 呈现该设备当前的算力边界与硬件支撑条件。
3. 本地引擎目录（Local Engine Catalog）指明能够承接此种路由请求的具体引擎。
4. 本地适配器路由组件（Adapter Router）完成最终决策，选定负责执行计算的适配器实例。

这套严密的决策链条完全属于 Runtime 的权责。桌面端及上层应用均不应干涉或强行绕过此路由流程。

## Provider 与模型目录的开放姿态

针对外部提供商（Provider）与内部模型目录的治理逻辑，已在契约层面给出严谨定义。可用性目录需在 Runtime 内核层面彻底确定并取得准入证据后方可对外发布。当前的契约面设计，详见 [连接器与 Provider](/zh/runtime/connectors-and-providers)（针对托管云提供商）以及 [本地模型](/zh/runtime/local-models)（针对本地计算引擎）文档。

## 来源依据

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
