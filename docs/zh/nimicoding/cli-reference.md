# CLI 概念指南

本页说明 CLI 命令的概念分类，具体参数请查阅本地帮助。

## CLI 工具的核心使命

CLI 系统存在的根本目的，是确保每次开发治理动作具备高度的**显式化**特征，并产生不可篡改的证据链：

- 创建并结构化校验 Topic 容器；
- 添加、选中并严格准入波次；
- 冻结用于限定执行边界的工作包；
- 将执行请求或审计任务分派下发；
- 将执行产出结果客观录入系统；
- 执行 Wave 和 Topic 的最终闭合收尾；
- 全局验证系统生命周期与架构拓扑的一致性。

这些指令的必要性在于，Topic 的真实治理状态**绝对不可**依赖于发散的对话流或临时记忆。其关键数据必须固化为可持久保存的记录工件，从而支持后续独立会话的提取与复审。

## 场景分析：为何单人开发模式同样需强依赖 CLI

假设一名独立开发者依靠 AI 辅助，正准备端到端地完成一个 Wave 开发。在这种场景中，CLI 流程看似增加了步骤——开发者自身完全知晓工作进展和代码修改。然而，CLI 的介入依然具备不可替代的工程价值，原因在于：

1. CLI 强制生成的结构化工件，是未来的代码审查环节（或后续参与的协作者）精确还原当下决策逻辑的唯一凭证。
2. 系统内置的机械化校验机制，能够准确拦截由于人工疏忽或单一会话疲劳导致的结构异常与缺陷。
3. 产出的证据工件，界定了后续独立审计工作的基础与边界。
4. 只有当明确的闭合收尾工件生成并归档后，一项修改才被在工程级别认定为“彻底完成”，而非仅仅是一项主观承诺。

独立开发者与大型团队面临同样的系统退化风险。正是这一套工具机制，确保了现有的代码产出能够抵御未来演进中潜在的隐性漂移风险。

## 指令功能归类体系（概念层级）

| 逻辑类别 | 管辖领域及功能覆盖 |
| --- | --- |
| Topic 治理层 | 启动初始化、数据校验、强制挂起、最终闭合 |
| Wave 协同层 | 分支添加、目标选中、边界准入、逻辑闭合 |
| Packet 约束层 | 边界冻结、数据结构校验 |
| 执行调度层 | 执行前预检、任务派发、执行结果系统录入 |
| 独立审计层 | 审计证据录入、最终评判认定 |
| 全局校验层 | 系统生命周期的一致性与逻辑拓扑检查 |

如需获取确切的命令行指令参数，请参阅本地部署的 CLI 帮助系统，或参考 `.nimi/topics/**` 目录下生成的实际 Topic 记录工件。供最终用户参考的详细命令示例，将在产品外部调用路径完全标准化后更新至操作文档。

## 场景分析：自动化校验如何拦截隐性漂移

假设某团队成员手动编辑了一个 Topic 工件，修改后的结构已不符合底层 Schema 的合规要求。在此时的流程中，自动化校验指令将立刻捕捉该错误，抛出强类型异常警告，从而**杜绝**此类非标准漂移行为渗入系统。

这类看似微小的拦截动作，构成了方法论赖以维系的核心安全防线。CLI 的存在强制规范了数据形状，进而保障后续审计步骤能够依赖最纯净的记录证据执行校验。

## 文档使用建议

请将本页面作为理解工作流指令分类逻辑的高阶指南。有关精准的命令行参数配置和调用语法，请直接查阅本地工具帮助文档或对 `.nimi/topics/**` 目录下的实际工件进行参考分析。

## 来源依据

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)