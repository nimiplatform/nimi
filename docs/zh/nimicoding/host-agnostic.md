# 宿主无关边界

Nimi Coding 包最具辨识度的属性是**厂商中立、宿主无关**。包提供方法论与契约，执行由任何遵守契约的 AI 宿主负责。换宿主不会改变方法论契约。

这一点在 AI 工程工具里很罕见。多数 AI 编码产品与宿主深度耦合——Cursor 的行为就是 Cursor 的行为，Copilot 的行为就是 Copilot 的。Nimi Coding 的定位反过来：方法论住在**项目里**，不在**工具里**；工具是可替换的。

## 这里的"宿主"指什么

宿主是真正执行工作的 AI 环境——读取契约、运行技能（例如 `spec_reconstruction`）、产出由包负责准入的结果。

| 属性 | 取值 |
| --- | --- |
| 宿主类别 | `ai_native_coding_host` |
| 所有权模式 | `external` |
| 执行模式 | `delegated` |
| 安装状态 | `not_installed`（包不安装运行时） |
| 自托管 | false |

包不拥有宿主。包负责把上下文送进项目，转交技能请求，再按强类型契约准入结果。

## 宿主必备能力

最少且明确：

| 能力 | 要求 |
| --- | --- |
| `read_project_local_nimi_truth` | 宿主须读取 `.nimi/methodology`、`.nimi/spec`、`.nimi/contracts` |
| `route_declared_external_skills` | 宿主可派发已声明的四项技能 |
| `fail_closed_on_missing_authority` | 权威缺失时，宿主不得自行合成输出 |

满足这三项的宿主即可准入。除此之外，包不要求宿主特有功能。

## 宿主硬约束

| 约束 | 它禁止什么 |
| --- | --- |
| `vendor_neutral_profile_only` | 宿主适配器不得夹带厂商专属契约 |
| `do_not_assume_local_runtime_install` | 宿主不得要求本地运行时存在 |
| `do_not_claim_packet_orchestration_ownership` | 宿主不得自称拥有 packet 生命周期 |

这些约束让包保持可移植。

## 同一项目如何切换宿主

| 关切 | 保持不变 | 发生变化 |
| --- | --- | --- |
| `.nimi/spec/**`（项目权威真相） | 是 | — |
| `.nimi/methodology/**`（策略） | 是 | — |
| `.nimi/contracts/**`（schema） | 是 | — |
| 议题工件（已闭合与 pending） | 是 | — |
| 适配器 overlay 路径 | — | 是（与宿主相关） |

变化的是适配器。方法论本身可移植。

## 两条约束如何配合

`vendor_neutral_profile_only` 加上 `do_not_claim_packet_orchestration_ownership`，合起来意味着：

- 可以为某个厂商加一份宿主适配器（例如 `oh-my-codex`）。
- 适配器以**受约束的桥**身份准入，而不是语义所有者。
- 宿主特有行为住在适配器里，不进入方法论。

正因如此，`oh-my-codex`、Codex、Claude、Gemini 等才能以桥的身份被准入，而包本身不会与厂商绑定。

## 适配器 overlay 模式

包按 `adapters/<host-name>/profile.yaml` 提供适配器 overlay。一份准入的 overlay 声明宿主特有属性，但不改变包的厂商中立内核。

| 适配器 overlay 路径 | 用途 |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | 把 `oh-my-codex` 准入为受约束的外部执行宿主 |

关于 `oh-my-codex` 详细信息，见 [Appendix → oh-my-codex](/nimicoding/appendix/oh-my-codex)。

其他宿主 overlay 可按相同模式新增。每份 overlay 命名宿主满足的宿主类能力，以及包可使用、又不会引发厂商耦合的少量宿主特有路由细节。

## 读者场景：同一项目用两种宿主

某项目以宿主 A 接入 Nimi Coding。后来团队决定让宿主 B 承担一部分工作。

1. **项目状态。**`.nimi/**` 工件齐全。
2. **接入宿主 B。**新增或准入 B 的适配器 overlay（`adapters/B/profile.yaml`）。
3. **新工作切到宿主 B。**新议题 / wave / packet 走宿主 B；宿主 A 下的旧工件依然有效。
4. **跨宿主审计。**宿主 A 之下创作的 wave，可由宿主 B 审计（独立回路保证）。
5. **方法论保持不变。**同一套四闭合、同一套角色分离、同一份禁用快捷方式目录。

可移植性本身就是产品。

## 读者场景：宿主不达标

一款新 AI 宿主想接入采用 Nimi Coding 的项目。它满足 `read_project_local_nimi_truth`，但不满足 `fail_closed_on_missing_authority`（权威缺失时仍合成输出）。

1. **兼容性核查。**宿主适配器兼容性契约评估能力位。
2. **必备能力缺失。**`fail_closed_on_missing_authority` 是必需项。
3. **拒绝准入。**该宿主不被准入为桥。
4. **下一步。**要么修复宿主（权威缺失时不再合成），要么不在该项目里使用它来承担 Nimi Coding 治理下的工作。

这些能力要求，正是宿主切换时让方法论完整性不动摇的依靠。

## 读者场景：单人创业者使用两种宿主

一位单人创业者用宿主 A 做主要 AI 工作，用宿主 B 做审计（盲点不同）。

1. **主要工作。**宿主 A 既是管理者又是 worker（低风险任务下走 `inline_manager_worker` 模式；高风险下作为 `manager_worker_auditor` 模式中的 worker）。
2. **审计。**宿主 B 担任审计员角色，复核宿主 A 的输出。
3. **方法论一致。**两个宿主都在同一份 `.nimi/methodology/**` 契约下被准入。
4. **盲点独立。**宿主 A 的失败模式不会被带入宿主 B 的审计。

这正是方法论对单人创业者的提案：把审计路由到另一个宿主，模拟一个团队本应提供的复核冗余。

## 宿主无关不等于什么

| 说法 | 实情 |
| --- | --- |
| "包不需要任何 AI 宿主就能跑" | 否——接入需要被准入的宿主 |
| "任何 AI 工具都能当宿主" | 否——宿主必须满足必备能力 |
| "适配器没有边界" | 否——适配器在兼容性契约下准入 |
| "方法论可以按宿主变化" | 否——方法论由包持有，与宿主无关 |

承诺的是**宿主可换**，不是**无宿主**。

## Source Basis

- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
