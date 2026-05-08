# CLI 概念指南 (CLI Reference)

本页旨在概念层面上，为你梳理 Nimi Coding CLI 各种界面的核心角色定位。请注意，这**不是**一份事无巨细、供你查阅参数的命令手册。

## CLI 的核心使命是什么？

CLI 存在的唯一理由，就是让每一次治理动作变得极具“显式感（Explicit）”并留下铁证：

- 创建并校验 Topic；
- 添加、选中并准入 Wave；
- 像冻结标本一样冻结执行工作包（Packet）；
- 将工作发包给执行者（Worker）或下达给审计环节；
- 记录执行产出的结果；
- 为 Wave 和 Topic 进行闭合收尾；
- 校验项目生命周期与拓扑图的一致性。

这些命令之所以至关重要，是因为一个 Topic 的真实状态**绝对不能**仅仅活在一段口口相传、随风飘散的聊天记录里。它必须凝结成坚固持久的工件（Artifacts），好让未来的其他会话（Session）能够毫无障碍地调取并审计。

## 场景案例：哪怕是单兵作战，为什么也省不掉 CLI？

假设一个独立开发者正带着他的 AI 助手，准备端到端地跑完一整个 Wave。在这种场景下，套上一层层 CLI 命令似乎显得脱裤子放屁——毕竟开发者自己心里跟明镜似的，完全知道代码改到了哪一步。但 CLI 在这里依然有着不可替代的价值，因为：

1. 只有它产出的那些结构化工件，才能让未来的代码审查（或者是未来的合作者）搞清楚当初到底拍板决定了些什么。
2. 它死板的校验步骤，能精准卡住那些单凭肉眼和单一会话极易疏忽的格式错误。
3. 这些工件，正是后续独立审计能够运作的基石与边界。
4. 只有拿着那些实实在在的收尾（Closeout）工件，你才能理直气壮地说“这活儿算是彻底干完了”，而不仅仅是一句“我记得我搞定了”的凭空承诺。

独立开发者同样需要这道正规军的防波堤。正是这道闸门，在默默保护着你的心血不在未来的某天发生隐性的架构漂移。

## 命令类别（概念理解层）

| 类别 | 它管辖的领地 |
| --- | --- |
| Topic 层 | 初始化 (Init)、校验 (Validate)、挂起 (Hold / pending)、闭合收尾 (Close) |
| Wave 层 | 添加、选中、准入 (Admit)、闭合 |
| Packet 层 | 冻结 (Freeze)、校验 |
| 执行执行层 | 预检 (Preflight)、分派下发 (Dispatch)、录入结果 |
| 审计层 | 记录审计出具的铁证、最终判决 (Judge) |
| 校验层 | 生命周期状态与拓扑图的一致性体检 |

想看确切的命令参数？请去查阅你本地的 CLI 帮助信息，或者直接去 `.nimi/topics/**` 里翻看既有的工件找灵感。那些供外部用户使用的公开命令示例，只有在项目把对外的路径彻底打磨稳定后，才会在文档里粉墨登场。

## 场景案例：一次死板校验如何拦下了架构漂移

假设某人手动编辑了一个 Topic 工件，不小心把格式改得不再匹配 Schema 的要求了。校验命令在路过时，会立刻把它揪出来，抛出一个极其明确的类型化错误（Typed error），**绝不**会让这种暗中发生的漂移溜过去。

这看起来是个不起眼的小插曲，但这恰恰是方法论赖以生存的护栏（Guardrail）。CLI 存在的意义，就是做那个强迫大家把形状捏对的“恶人”，从而让后置的审计步骤能在一个干干净净、铁证如山的环境里开展工作。

## 如何使用本页面

请利用本页来理解工作流的分类逻辑。至于确切的命令行参数该怎么敲，请直接求助本地的 CLI 帮助文档，或是参考 `.nimi/topics/**` 目录下的活生生的 Topic 工件。那些向外公开的命令样例，只有在项目对外路径完全平稳定调后，才有资格在这里被大书特书。

## 来源依据

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)