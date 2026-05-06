# 宿主无关边界

Nimi Coding 包最独特的一项性质，就是**厂商中立、宿主无关**。包提供方法论与合同；任何遵循合同的 AI 宿主都可以承担执行。换宿主不会改变方法论合同。

这一点在 AI 工程工具里相当少见。多数 AI 编程产品跟宿主深度绑：Cursor 的行为就是 Cursor 的行为，Copilot 的行为就是 Copilot 的行为。Nimi Coding 选择把方法论放在**项目**里，而不是放在**工具**里，工具本身可以替换。

## 这里说的「Host」是什么

这里说的宿主，指真正承担工作的 AI 环境：它读合同、跑技能（比如 `spec_reconstruction`）、产出由包来准入的结果。

| 性质 | 值 |
| --- | --- |
| Host class | `ai_native_coding_host` |
| 拥有模式 | `external` |
| 执行模式 | `delegated` |
| 安装状态 | `not_installed`（包不会装 runtime） |
| 自托管 | false |

包不拥有宿主。包负责把上下文投到项目里、把技能请求 hand off 出去、按类型化合同准入回来的结果。

## 必备的宿主能力

要求很少，也很显式：

| 能力 | 它要求什么 |
| --- | --- |
| `read_project_local_nimi_truth` | 宿主能读 `.nimi/methodology`、`.nimi/spec`、`.nimi/contracts` |
| `route_declared_external_skills` | 宿主能分发四个声明技能 |
| `fail_closed_on_missing_authority` | 缺权威时宿主不能凭空合成输出 |

满足这三条的宿主可以被准入。包对宿主的要求就到这里，不再额外索取。

## 宿主硬性约束

| 约束 | 它禁止什么 |
| --- | --- |
| `vendor_neutral_profile_only` | 宿主 adapter 不能夹带厂商专属合同 |
| `do_not_assume_local_runtime_install` | 宿主不能要求本地装 runtime |
| `do_not_claim_packet_orchestration_ownership` | 宿主不能假装自己拥有 packet 生命周期 |

正是这几条约束让包保持可携。

## 同一个项目怎么换宿主

| 关注 | 不变 | 变 |
| --- | --- | --- |
| `.nimi/spec/**`（项目规范化真相） | 是 | — |
| `.nimi/methodology/**`（policy） | 是 | — |
| `.nimi/contracts/**`（schema） | 是 | — |
| Topic 工件（已闭与待闭） | 是 | — |
| Adapter overlay 路径 | — | 是（按宿主） |

变的是 adapter。方法论本身可携。

## 两条约束为什么要一起出现

`vendor_neutral_profile_only` 加上 `do_not_claim_packet_orchestration_ownership` 合起来意味着：

- 任何特定厂商（比如 `oh-my-codex`）都可以加一份宿主 adapter；
- adapter 以**受约束桥**的身份进来，不是语义的所有者；
- 宿主特定的行为住在 adapter 里，不会渗进方法论本身。

这就是为什么 `oh-my-codex`、Codex、Claude、Gemini 这些都可以以桥的身份进来，而不会让包变得跟某家厂商耦合。

## Adapter Overlay 模式

包以 `adapters/<host-name>/profile.yaml` 的形式提供 adapter overlay。一份准入的 overlay 声明它对应宿主的特定属性，而不动包厂商中立的核心。

| Adapter overlay 路径 | 用途 |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | 把 `oh-my-codex` 准入为受约束外部执行宿主 |

`oh-my-codex` 的细节见 [附录 → oh-my-codex](/zh/nimicoding/appendix/oh-my-codex)。

别的宿主也可以按同样模式加 overlay。每份 overlay 声明该宿主满足哪些 host-class 能力，以及包能用、却又不会让包跟厂商耦合的特定路由信息。

## 阅读场景：同一个项目用两个宿主

某项目在宿主 A 上采用了 Nimi Coding。后来团队决定有些工作用宿主 B。

1. **项目状态。** `.nimi/**` 工件就位。
2. **采用宿主 B。** 添加或准入 B 的 adapter overlay（`adapters/B/profile.yaml`）。
3. **切宿主做新工作。** 新的 topic / wave / packet 用 B；A 上的旧工件依然有效。
4. **跨宿主审计。** 在 A 上做的 wave 可以在 B 上做审计（独立循环这一保证不变）。
5. **方法论不变。** 同样的四闭合框架、同样的角色分离、同样的禁用捷径目录。

可携性正是这款产品本身。

## 阅读场景：宿主达不到必备能力

某新 AI 宿主想被一个采纳了 Nimi Coding 的项目用上。它能 `read_project_local_nimi_truth`，但 `fail_closed_on_missing_authority` 那条没满足（缺权威时它会合成输出）。

1. **兼容性核验。** Adapter 兼容合同检查能力 flag。
2. **必备能力缺失。** `fail_closed_on_missing_authority` 是硬要求。
3. **拒绝准入。** 该宿主无法以桥的身份被准入。
4. **后续路径。** 要么修宿主（缺权威时不再合成），要么不让它去做被 Nimi Coding 治理的工作。

正是这套能力要求，在换宿主的情况下依然守住方法论的完整性。

## 阅读场景：solo 创业者用两个宿主

某 solo 创业者主线 AI 工作走宿主 A，审计走宿主 B（盲点不一样）。

1. **主线工作。** A 担当 manager + worker（低风险用 `inline_manager_worker` 模式；走 `manager_worker_auditor` 模式时 A 只做 worker）。
2. **审计。** B 在 A 的输出之上跑 auditor 角色。
3. **同一套方法论。** 两个宿主都在同一份 `.nimi/methodology/**` 合同下被准入。
4. **盲点彼此独立。** A 的失败模式不会带到 B 的审计里。

这就是这套方法论给 solo 创业者的卖点：用走另一个宿主的审计，去模拟出一支团队本会提供的 review 冗余。

## 「宿主无关」不等于什么

| 说法 | 真相 |
| --- | --- |
| 「这个包不要任何 AI 宿主就能跑」 | 错 —— 采纳时必须有一个准入的宿主 |
| 「随便哪个 AI 工具都能当宿主」 | 错 —— 宿主必须满足必备能力 |
| 「Adapter 没有边界」 | 错 —— Adapter 在兼容合同下被准入 |
| 「方法论可以按宿主变」 | 错 —— 方法论由包拥有，宿主无法影响 |

承诺的是**宿主可换**，不是**完全不要宿主**。

## 来源

- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
