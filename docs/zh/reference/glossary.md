# 术语表

公共 Nimi 文档跨域使用的术语。每条都是给读者的摘要；精确权威归在 `.nimi/spec/**`。

某个术语归属于某个权威域时，词条指向该域，而不是在术语表里重新定义规则。

## 平台与世界模型

**Nimi**。一个 AI 开放世界平台。世界、Agent、应用、Runtime 服务、身份共享同一个社会与语义环境，而不是每个 App 自己发明一套私有的世界模型。

**世界（World）**。长时存活的语义与社交环境，有自己的规则、参与者、历史、在场。任何被准入为创作者的人都可以建造世界；平台提供跨世界契约，让身份与意义能在世界之间流转。

**开放世界（Open World）**。能与其他世界经由平台协议组合的世界。这与「开源」不是同一件事。它指的是参与、身份可携带、跨世界共享语义。

**参与者（Participant）**。世界内的一等实体。人、AI Agent、App 都可以参与，但能力与权威画像不同。

**六个协议基础协议**。平台协议定义的固定跨世界契约面：Timeflow、Social、Economy、Transit、Context、Presence。世界可以定义自己的内部规则；跨世界的意义则必须归在这六份契约里。

**与 OASIS 的对照**。Nimi 借的是 OASIS 这种世界引擎的形态，不是它的内容。OASIS 在原作里是物理世界引擎；Nimi 是社会与语义世界引擎。世界规则由创作者撰写，跨世界契约面是固定的。

## 权威域

**权威域（Authority Domain）**。命名的归属面（Platform、Runtime、SDK、桌面端、Realm、Avatar、Cognition、Nimi Coding），各自负责一种特定真相。跨域的主张必须经过准入，不能默认。

**Platform（平台）**。持有开放世界模型、协议基础协议、权威规则。

**Runtime**。持有 AI 执行：provider、工作流、流式、多模态投递、本地能力路由、委派、审计，以及 Runtime 持有的 Agent 参与。

**SDK**。面向 App 的 TypeScript 接入边界。App 通过 SDK 消费 Runtime、Realm、世界组合、scope、Mod，不跨进私有内部。

**桌面端（Desktop）**。第一方原生外壳。承载桌面端契约准入的原生、本地、Mod 能力。

**网页端（Web）**。选定平台面的受限呈现。不会因暗示就继承桌面端原生能力。

**Realm**。持有语义真相：世界状态、世界历史、聊天、社交、经济、资产、Transit、绑定、Resource 语义。公共文档讲的是公共读取路径；后端、Dashboard、创作者侧权威在私有仓库里，不会被并入公共文档。

**Avatar**。持有具身 Agent 呈现：具身呈现、carrier 视觉接受、外壳特定渲染边界。

**Cognition**。独立持有 memory、知识、prompt 服务、引用、completion、技能服务，以及 Runtime 桥语义。

**Nimi Coding**。AI 编码治理工作流：topic、wave、packet、preflight、审计、closeout 证据。

## Runtime 词汇

**工作流（Workflow）**。Runtime 持有的多步执行图。具备节点类型、状态转移、流式事件、终态结果。

**流式（Streaming）**。Runtime 关于部分 / 终态投递的契约，包括阶段边界、终态帧、错误语义、闸门。

**Provider**。AI 能力的外部或本地源。Provider 身份与能力信息是 Runtime 治理的数据，不是宣传文案。

**模型目录（Model Catalog）**。Runtime 治理的模型身份、能力、生命周期状态的真相源。

**多模态制品（Multimodal Artifact）**。Runtime artifact 契约下产出的非文本输出（图、音、视频、声音、音乐）。

**委派能力（Delegated Capability）**。Runtime 持有的、把请求转发给外部 provider 的权威，受防火墙与审批契约约束。

**本地能力（Local Capability）**。本地执行所需的 Runtime 持有路由、设备画像、引擎能力语义。

## SDK 词汇

**Surface（接入面）**。SDK 的命名子路径，自己有一份导出与边界契约（`sdk/runtime`、`sdk/realm`、`sdk/world`、`sdk/ai-provider`、`sdk/scope`、`sdk/mod`、`sdk/types`）。

**边界（Boundary）**。规范准入的导入或调用规则，让 App 不能跨入 Runtime、Realm、Cognition 的私有内部。

**呈现（Projection）**。某条权威契约的强类型 App 视图。它不重新定义契约，只把契约暴露出来。

## Realm 词汇

**真相（Truth）**。世界规范化的语义事实，归属 Realm。

**世界状态（World State）**。世界的当前状态，受世界状态契约管控。

**世界历史（World History）**。过往状态与转移，受世界历史契约管控。

**聊天（Chat）**。对话参与世界意义时，Realm 持有的聊天语义。

## 桌面端词汇

**外壳（Shell）**。桌面端第一方原生 UI 面。

**Mod**。桌面端的扩展，跑在用户面附近，受 Hook 能力白名单约束。

**Hook 能力**。经强类型 Hook 面授予 Mod 的具体白名单能力。

**Web 适配器**。桌面端选定面到浏览器的受限呈现。原生启动、Mod 注册、原生窗口行为、敏感令牌持久化都在这一面里关闭。

## Avatar 词汇

**具身（Embodiment）**。Agent 进入视觉或交互 carrier 的受治理呈现。

**Carrier**。承载具身的宿主面，按强类型视觉接受契约渲染。

## Cognition 词汇

**Memory**。Cognition 持有的长期参与者上下文。

**知识（Knowledge）**。Cognition 持有的可检索结构化信息。

**Prompt 服务**。Cognition 持有的权威 prompt 模板与服务通道。

**Runtime 桥**。Runtime 在不吞并 Cognition 权威的前提下消费 Cognition 的接缝。

## Nimi Coding 词汇

**Topic**。高风险或承载权威工作的受治理工作主线。

**Wave**。Topic 内有边界的归属切片。一个 wave 在同一时间只隔离一个闭合域。

**Packet**。Wave 的执行契约的冻结版，包括允许的读、允许的写、接受不变式、负向测试、停止线。

**Preflight**。Wave 实施前的停止线检查。

**审计（Audit）**。证明工作匹配权威与消费者需求的证据。

**Closeout**。判断工作在所有闭合维度上确实做完的决定。

**闭合维度**。权威闭合、语义闭合、消费者闭合、抗漂移闭合。Wave 只有四者全部满足才算闭合。

**伪闭合**。一个维度看似完成、另一维度其实失败的产物。常见形态：构建过了但页面不可读；页面可读但缺权威源；路由存在但对读者无价值。

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/desktop/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/index.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
