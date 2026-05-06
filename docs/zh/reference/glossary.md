# 术语表

公开 Nimi 文档里跨域用的术语。每条是给读者的摘要；准确权威住在 `.nimi/spec/**`。

某术语归某具体权威域时，术语表条目指向那个域、**不**重新定义规则。术语表行跟规范冲突时，规范赢、术语表该更新。

## 平台与世界模型

**Nimi。** 一个 AI 开放世界平台。世界、Agent、应用、runtime 服务、身份共享一个社交与语义环境，**不**是每个 App 自己发明私有世界模型。

**世界。** 长期存在的语义与社交环境，有自己的规则、参与者、历史、在场。任何被准入的世界创作者都能建世界；平台提供跨世界合同让身份与含义在世界之间移动。

**开放世界。** 通过平台协议跟其他世界可组合的世界。它**跟**「开源」**不**一样。它指的是参与、身份可携、跨世界共享语义。

**参与者。** 世界里一等实体。人、AI Agent、应用都能参与，但带不同能力与权威 profile。

**六个基础协议。** 平台协议定义的固定跨世界合同面：Timeflow、Social、Economy、Transit、Context、Presence。世界可以定义自己内部规则，但跨世界的含义必须 fit 这六个合同。

**OASIS 类比。** Nimi 在形状上跟 OASIS 风格世界引擎类比，**不**在内容上。Spec 里把 OASIS 框成物理世界引擎；Nimi 是社交与语义世界引擎。世界规则由创作者定义；跨世界合同面是固定的。

## 权威域

**权威域。** 一个有名拥有者面（Platform、Runtime、SDK、Desktop、Realm、Avatar、Cognition、Nimi Coding），负责某种特定真相。跨权威域的声明必须被准入、**不**隐含。

**Platform。** 拥有开放世界模型、协议基础协议、权威规则。

**Runtime。** 拥有 AI 执行：Provider、工作流、流式、多模态投递、本地能力路由、委派、审计、runtime 拥有的 Agent 参与。

**SDK。** TypeScript App 面访问边界。App 通过 SDK 消费 Runtime、Realm、世界组合、scope、mod，**不**穿过私有内部。

**Desktop。** 一等方原生外壳。承载桌面端合同准入的原生、本地、mod 能力。

**Web。** 选定平台面的受约束版本。**不**隐含继承桌面端原生能力。

**Realm。** 拥有语义真相：世界状态、世界历史、聊天、社交、经济、资产、通行、绑定、resource 语义。公开文档描述公开读路径；后端、dashboard、创作者侧权威住在私有仓库、**不**被吸纳进公开文档。

**Avatar。** 拥有形体化 Agent 呈现：形体化呈现、载体视觉接受度、shell 特定渲染边界。

**Cognition。** 拥有独立记忆、知识、prompt 服务、引用、completion、技能服务、runtime 桥语义。

**Nimi Coding。** AI-coding 治理工作流：topic、wave、packet、preflight 检查、审计、closeout 证据。

## Runtime 词汇

**Workflow。** Runtime 拥有的、被治理的多步执行图。有节点类型、状态转换、流式事件、终态结果。

**Streaming。** Runtime 的部分与最终投递合同，含阶段边界、终止帧、错误语义、闸门。

**Provider。** AI 能力的外部或本地来源。Provider 身份与能力信息是受治理的 runtime 数据、**不**是营销文案。

**Model 目录。** Runtime 治理的 model 身份、能力、生命周期状态的真相来源。

**多模态 artifact。** 在 Runtime artifact 合同下产出的非文本输出（图像、音频、视频、语音、音乐）。

**委派能力。** Runtime 拥有的、把请求转给外部 Provider 的权威，在 firewall 与审批合同下。

**本地能力。** Runtime 拥有的本地执行路由、设备 profile、引擎能力语义。

## SDK 词汇

**Surface。** 带自己 export 与边界合同的命名 SDK 子路径（`sdk/runtime`、`sdk/realm`、`sdk/world`、`sdk/ai-provider`、`sdk/scope`、`sdk/mod`、`sdk/types`）。

**边界。** Spec 准入的 import 或调用规则，防 App 穿进 Runtime、Realm、Cognition 私有内部。

**Projection（spec 路径里的 `*projection*`）。** spec 文件名里出现 `*projection*`（比如 `realm/projection.md`、`error-projection.md`）指底层权威合同的类型化 App 面「读视图」或「形状」。这个面**不**重新定义合同；它暴露合同。中文 body prose 用「读视图」「读聚合面」「形状」等表达，避免把「projection」字面化。

## Realm 词汇

**真相。** 关于一个世界的规范化语义事实，归 Realm 拥有。

**世界状态。** 一个世界的当前状态，受世界状态合同治理。

**世界历史。** 过去状态与转换，受世界历史合同治理。

**聊天。** 对话参与世界含义时 Realm 拥有的聊天语义。

## Desktop 词汇

**Shell。** Desktop 的原生一等方 UI 面。

**Mod。** 在 hook 能力白名单下跑在用户面附近的桌面端扩展。

**Hook 能力。** 经类型化 hook 面授给 mod 的具体白名单能力。

**Web Adapter。** 选定桌面端面到浏览器的受约束版本。原生 bootstrap、mod 注册、原生窗口行为、超出浏览器安全限的敏感 token 持久化都在这个面被禁。

## Avatar 词汇

**形体化。** Agent 到视觉或交互载体的、被治理的呈现形态。

**载体。** 在类型化视觉接受度合同下渲染形体化的宿主面。

## Cognition 词汇

**记忆。** Cognition 拥有的长期参与者上下文。

**知识。** Cognition 拥有的可检索结构化信息。

**Prompt 服务。** Cognition 拥有的权威 prompt 模板与服务道。

**Runtime 桥。** Runtime 经其消费 Cognition 而**不**吸纳 Cognition 权威的接缝。

## Nimi Coding 词汇

**Topic。** 给高风险或承载权威工作的、被治理的工作轨。

**Wave。** Topic 内一个有界 owner cut。Wave 一次隔离一个闭合域。

**Packet。** Wave 的冻结执行合同，含允许读、允许写、接受性不变量、负向测试、停止线。

**Preflight。** Wave 实现开始前的停止线检查。

**审计。** 工作匹配权威与消费方需要的证据。

**Closeout。** 跨所有闭合维度工作真完成的决定。

**闭合维度。** 权威闭合、语义闭合、消费方闭合、抗漂移闭合。Wave 只在四个全满足时闭合。

**伪闭合。** 输出按某个闭合维度看完整、可在另一个维度上失败。常见形状：build 过但页不可读；页可读但缺 source 权威；路由存在但无读者价值。

## 姿态与兼容

**Pre-launch 姿态。** 项目当前的对外发布姿态：平台模型已 documented；安装命令、分发渠道、Provider 可用性、Model 目录在配套证据被准入后才公开出现。

**硬切。** 有意移除某条路由或页，**不**作为隐藏兼容入口保留。

**选定子集。** 有意暴露子集而**不**镜像所有的 locale 或面。公开中文版本是选定的、**不**是全镜像。

## 来源

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
