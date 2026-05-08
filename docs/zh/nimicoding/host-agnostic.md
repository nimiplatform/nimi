# 宿主无关边界 (Host-Agnostic Boundary)

Nimi Coding 软件包最核心、最具区分度的属性，就是它的**厂商中立与宿主无关性**。Nimi Coding 提供的是一套方法论与契约规范；任何遵循这套契约的 AI 宿主（Host）都可以被用来执行具体的开发任务。更换 AI 宿主，并不会触碰或改变方法论底层的契约。

在当前的 AI 工程工具领域，这是独树一帜的。大多数 AI 编程产品都与特定的工具环境深度绑定——Cursor 的行为逻辑属于 Cursor，Copilot 的行为逻辑属于 Copilot。而 Nimi Coding 的定位是：方法论存在于**项目**本身之中，而不是存在于**工具**里；因此，工具是完全可随时替换的插件。

## 在此语境下，“宿主”意味着什么

在这里，“宿主”指的是真正执行工作的 AI 环境——它负责读取契约、运行技能（例如 `spec_reconstruction`），并产出可被 Nimi Coding 准入的输出。

| 核心属性 | 值 |
| --- | --- |
| 宿主类型 (Host class) | `ai_native_coding_host` |
| 所有权模式 (Ownership mode) | `external` (外部) |
| 执行模式 (Execution mode) | `delegated` (委派) |
| 安装状态 (Install state) | `not_installed` (包本身不负责安装执行环境) |
| 自托管 (Self-hosted) | 否 |

Nimi Coding 并不拥有宿主。它只负责将上下文投影到项目中，交接技能请求，并根据类型化契约来验收返回的结果。

## 必备的宿主能力

对于宿主的能力要求，极其精简且明确：

| 能力 | 要求 |
| --- | --- |
| `read_project_local_nimi_truth` | 宿主必须能够读取项目本地的 `.nimi/methodology`、`.nimi/spec`、`.nimi/contracts` |
| `route_declared_external_skills` | 宿主能够分发并执行声明的四项技能 |
| `fail_closed_on_missing_authority` | 宿主在缺失必要权威真相源时必须立即报错（fail closed），**严禁自行推断合成输出** |

只要满足这三点，一个宿主就可以被顺利准入。Nimi Coding 并不依赖上述三点之外的任何特定宿主功能。

## 刚性宿主约束

| 约束 | 所禁止的行为 |
| --- | --- |
| `vendor_neutral_profile_only` | 宿主适配器不得夹带或植入任何特定厂商的私有契约 |
| `do_not_assume_local_runtime_install` | 宿主不得假设本地已安装特定的运行时环境 |
| `do_not_claim_packet_orchestration_ownership` | 宿主不得越权，不可伪称拥有对 Packet 生命周期的管理权 |

正是这些严格的约束条件，赋予了 Nimi Coding 极强的可移植性。

## 同一个项目如何切换宿主

| 关注点 | 是否保持不变？ | 是否改变？ |
| --- | --- | --- |
| `.nimi/spec/**` (项目的权威事实源) | 是 | — |
| `.nimi/methodology/**` (治理策略) | 是 | — |
| `.nimi/contracts/**` (类型约束) | 是 | — |
| Topic 工件 (包含未完成及已关闭的记录) | 是 | — |
| 适配器覆盖层路径 (Adapter overlay path) | — | 改变（依宿主而定） |

更换宿主，改变的仅仅是适配器（Adapter）。方法论及其全部历史证据，完美具备可移植性。

## 为什么这两条约束可以有效组合？

`vendor_neutral_profile_only` 与 `do_not_claim_packet_orchestration_ownership` 这两项约束结合在一起，意味着：

- 我们可以为一个特定的厂商添加专属的适配器（比如 `oh-my-codex`）。
- 该适配器被视为一个**受限的桥接器（Constrained bridge）**准入，而非获得了语义的所有权。
- 宿主特有的行为会被牢牢隔离在适配器之中，绝不会污染通用的方法论系统。

正因如此，`oh-my-codex`、Codex、Claude、Gemini 以及其他工具，都能作为桥接器顺利接入系统，而不会让整个项目被某个厂商所“绑架”。

## 适配器覆盖层模式 (Adapter Overlay Pattern)

Nimi Coding 通过在 `adapters/<host-name>/profile.yaml` 下提供适配器覆盖层来实现对接。一个获准入的覆盖层声明了它特有的宿主属性，但丝毫不会改变 Nimi Coding 厂商中立的核心机制。

| 适配器覆盖层路径 | 目的 |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | 将 `oh-my-codex` 准入为一个受限的外部执行宿主 |

有关 `oh-my-codex` 的具体细节，详见 [附录 → oh-my-codex](/zh/nimicoding/appendix/oh-my-codex)。

其它宿主的覆盖层也可以沿用同样的模式添加。每个覆盖层负责列明自身具备哪些被要求的宿主能力，并提供必要的路由细节，Nimi Coding 借此完成调度调用而不陷入厂商耦合。

## 场景案例：同一个项目使用两个不同的宿主

一个项目一直在宿主 A 的环境下采用 Nimi Coding。后来，团队决定某些特定任务交由宿主 B 处理。

1. **项目状态**：所有 `.nimi/**` 事实源及历史记录都完好存在。
2. **引入宿主 B**：添加或准入宿主 B 的适配器覆盖层（`adapters/B/profile.yaml`）。
3. **分配新任务**：新的 Topic / Wave / Packet 安排在宿主 B 上执行；过去在宿主 A 上建立的工件依旧完全有效。
4. **跨宿主审计**：由宿主 A 执笔产出的 Wave，可以交由宿主 B 进行审计（天然提供了独立循环的审计保障）。
5. **方法论不变**：相同的四个闭合维度、相同的角色分离机制、相同的禁用模式清单。

这种真正的跨工具可移植性，正是该产品的核心价值。

## 场景案例：能力不达标的宿主

出现了一款新的 AI 编程工具，团队想将其接入采用 Nimi Coding 的项目中。该宿主满足 `read_project_local_nimi_truth`，但达不到 `fail_closed_on_missing_authority` 的标准（它在缺失权威事实源时，总是喜欢擅自推断并合成输出）。

1. **兼容性核查**：宿主适配器兼容性契约对能力标识进行评估。
2. **缺失核心能力**：发现不具备强制要求的 `fail_closed_on_missing_authority` 能力。
3. **拒绝准入**：该宿主作为桥接器的准入请求被拒绝。
4. **后续路径**：要么修正该宿主（保证缺失事实源时绝不捏造），要么不要在受 Nimi Coding 管控的项目中使用它。

这些能力门槛，是我们在不同宿主间切换时依然能够保证方法论纯洁性的底线。

## 场景案例：使用双宿主的独立创业者

一位毫无团队支持的独立开发者，使用宿主 A 来处理主要的代码生成，而利用宿主 B 进行审计（因为它们拥有不同的盲点区）。

1. **主要开发**：宿主 A 充当 Manager 和 Worker（在风险较低的工作中可以采取 `inline_manager_worker` 模式，或在 `manager_worker_auditor` 模式中仅作为 Worker）。
2. **独立审计**：宿主 B 根据宿主 A 产出的结果执行 Auditor 角色。
3. **遵循同套方法论**：两个宿主均受控于同一套 `.nimi/methodology/**` 契约体系。
4. **隔离盲点**：宿主 A 生成时产生的逻辑盲区，不会顺延带入宿主 B 的审计循环中。

这正是这套方法论对独立开发者最强大的吸引力：**通过调度不同的 AI 宿主执行审计，你甚至能在单兵作战时模拟出一个团队才有的防错冗余度**。

## “宿主无关”不代表什么

| 错误说法 | 真相 |
| --- | --- |
| “不需要任何 AI 宿主，系统就能跑起来” | 错误 —— 这套机制的运转必须依赖一个已准入的宿主。 |
| “随便什么 AI 工具都能当宿主” | 错误 —— 宿主必须满足特定的能力红线要求。 |
| “适配器没有任何边界限制” | 错误 —— 适配器的准入受到严格的兼容性契约束缚。 |
| “方法论可以根据不同宿主的特点自行变化” | 错误 —— 方法论始终由 Nimi Coding 定义并全盘掌控，在所有宿主面前保持绝对一致。 |

Nimi Coding 的承诺是 **宿主可任意替换 (host-swappable)**，绝不是 **无需宿主 (host-free)**。

## 来源依据

- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
