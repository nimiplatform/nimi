# 附录：oh-my-codex 适配器

`oh-my-codex` 是 Nimi Coding 依赖包内置的一款**已准入的外部执行宿主适配器层**。它提供了一个标准化示例，展示了特定 AI 宿主如何作为“受限桥接器”被准入治理体系，而不获取方法论层面的语义所有权。

**说明**：本页属于**附录**性质，并非方法论的核心概念。Nimi Coding 方法论始终保持宿主中立特性 (Host-agnostic)；`oh-my-codex` 仅作为适配器准入模式的参考实现。针对其他 AI 宿主的适配器亦可遵循此模式构建。

## 适配器提供的配置数据

| 配置文件 | 核心作用 |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | `oh-my-codex` 作为执行宿主的准入覆盖层配置 |

该配置覆盖层声明了以下内容：

- 确认 `oh-my-codex` 作为受限桥接器的准入身份。
- 声明该宿主符合哪些基础宿主能力 (Host-class capabilities) 标准。
- 规定了依赖包允许的、针对该宿主的特定路由通信细节。

**关键限制**：该适配器**未**声明任何语义所有权；确保方法论的核心控制流持续保持厂商中立。

## 适用场景

在以下情况中，建议使用 `oh-my-codex` 适配器：

- 项目选择 `oh-my-codex` 作为 AI 技能分派与执行的实际宿主。
- 期望在运行 `nimicoding doctor` 时输出具名的适配器元数据，而非通用的外部宿主配置描述。

## 不适用场景

在以下情况中，应直接使用通用的外部宿主配置（不使用覆盖层）：

- 项目直接与已准入的 AI 平台（如 Claude、Codex、Gemini 等）进行交互集成。
- 除了基础的厂商中立配置外，无需额外的特定宿主路由逻辑。

Nimi Coding 的架构承诺在于：任何遵循兼容契约的宿主均可接入系统；具名适配器层仅为优化集成体验，而非架构强制要求。

## 场景演练：从 oh-my-codex 切换至替代宿主

某项目此前依托 `oh-my-codex` 运行，现计划将其替换为另一款已准入的 AI 宿主。

| 执行步骤 | 动作详情 |
| --- | --- |
| 方法论配置变更 | 无 —— 方法论核心策略文件保持不变。 |
| 适配器变更 | 若不再使用，可移除 `oh-my-codex` 配置覆盖层；或保留以作归档记录。 |
| 新宿主集成 | 应用通用的外部宿主配置，或在必要时引入针对新宿主的适配器覆盖层。 |
| 历史工件处理 | 过去由 `oh-my-codex` 生成并验证的 Topic / Wave / Packet / Closeout 记录依然具备完全效力。 |

该特性体现了方法论系统高度的跨宿主可移植性。基础设施层面的替换，绝不会导致已建立历史工件及审计记录的失效。

## 场景演练：开发并准入全新的宿主适配器

假设需为一款名为 `host-x` 的新 AI 系统编写接入适配器。

| 执行步骤 | 动作详情 |
| --- | --- |
| 建立 `adapters/host-x/profile.yaml` | 参照 `oh-my-codex` 覆盖层的基础结构。 |
| 声明宿主能力标识 | 明确标示该宿主满足了哪些强制要求的基准能力。 |
| 声明符合刚性约束 | 承诺维持厂商中立、不依赖本地运行时，且不接管系统调度权限。 |
| 记录特定路由细节 | 仅配置必要的集成路由参数，避免将逻辑侵入方法论核心。 |
| 执行 `nimicoding doctor` 校验 | 运行诊断以验证配置契约的兼容性。 |

一旦准入流程完成，新适配器将成为可选项。工具包支持同时保留多个已准入覆盖层，项目组可根据具体的工程上下文选择调用的宿主。

## 声明限制

本附录未主张 `oh-my-codex` 是唯一受支持的外部执行宿主、官方推荐工具或方法论采纳的前置条件。它仅作为配置覆盖层结构的范例，供其他 AI 宿主的接入参考。

同时，本页不提供关于 `oh-my-codex` 软件自身的应用说明——此类信息应查阅该工具官方的上游技术文档。

## 来源依据

- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
