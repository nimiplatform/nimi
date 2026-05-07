# 包

`@nimiplatform/nimi-coding` 是一份**独立、宿主无关的边界包**，承载 Nimi Coding 方法论。这一页讲清楚包提供什么、有意不提供什么、以及这个形态为什么重要。

## 包是什么

| 性质 | 值 |
| --- | --- |
| 包名 | `@nimiplatform/nimi-coding` |
| 仓库阶段 | bootstrap |
| 自托管 | 否（runtime 拥有权委派给外部 AI 宿主） |
| 厂商中立 | 是 |
| Host class | `ai_native_coding_host` |
| 许可 | MIT |
| Bin | `nimicoding` |

产品目标：让任意项目可以装上一份可复用的 AI 编程治理工具，bootstrap 一份项目本地 `/.nimi/**` 层，再按 AI 原生的权威 / packet / 接受度纪律去做高风险工作。

## 包里面有什么

| 路径 | 用途 |
| --- | --- |
| `methodology/` | 方法论源（policy） |
| `contracts/` | Schema 源（类型化合同） |
| `config/` | Bootstrap 配置（manifest、host-profile 等） |
| `spec/` | Bootstrap spec 种子（`bootstrap-state`、`product-scope`） |
| `cli/` | CLI 实现 |
| `bin/nimicoding.mjs` | 入口可执行 |
| `adapters/` | 宿主 adapter overlay（比如 `oh-my-codex`） |

`nimicoding start` 在宿主项目里跑时，会把包里的源映射到项目下的 `.nimi/**`：

| 源 | 映到 |
| --- | --- |
| `methodology/` | `.nimi/methodology/` |
| `contracts/` | `.nimi/contracts/` |
| `config/` | `.nimi/config/` |
| `spec/`（bootstrap） | `.nimi/spec/`（仅 bootstrap 文件） |

## 包有意**不**提供什么

| 表面 | 状态 | 推迟的理由 |
| --- | --- | --- |
| Packet-bound run kernel | 推迟 | 方法论拥有形态，不拥有执行 |
| Provider 后端执行 | 推迟 | 包自己不跑 AI |
| Scheduler | 推迟 | 执行时机是宿主的事 |
| 通知 | 推迟 | UX 是宿主的事 |
| 自动化后端 | 推迟 | 自动化是宿主的事 |
| 自托管方法论执行 | 推迟 | runtime 拥有者保持外部 |

这些都是显式的**推迟表面**。包做到「在它独立范围内边界完整」 —— 它提供方法论、合同、bootstrap、机器校验器，但它不跑工作。

## 为什么是「边界完整、不是执行完整」

边界完整地做出方法论的包，可以被任何项目采纳。同时把自己的 runtime 也带上的包，会绑死到一种特定的执行模型（某个 AI 宿主、某种 scheduler、某种通知系统）。

之所以拆开，是因为：

- 方法论是**可携的** —— 不挑宿主。
- runtime 是**宿主特定的** —— 同一段执行可以路由到 Claude、Codex、Gemini、OMX 或别的合同遵循宿主。
- 把两者绑在一起，会逼采纳者把方法论与执行层一起吞下。

包给出的承诺是：「今天就可以采纳这套方法论；明天换 AI 宿主，方法论合同不用动」。

## 当前包的表面

当前独立范围是边界完整的，覆盖：

- 包身份
- 仓库地基
- 初始 AI 原生方法论种子
- 包拥有的 bootstrap 源映射
- 机器可读的 reconstruction、doc-spec-audit、high-risk-execution 结果合同
- 包拥有的规范化高风险准入 schema 合同
- 仅种子的高风险执行 schema（packet、orchestration-state、prompt、worker-output、acceptance）
- 厂商中立的外部 host-profile 种子
- 包拥有的外部宿主兼容合同种子
- 受约束外部执行宿主互通用的 host-adapter 种子
- 包拥有、给 `oh_my_codex` 的准入 host-profile overlay 种子
- 一份带边界的独立 CLI，含分阶段 `start`、validation、handoff、本地 closeout 映射、显式准入、机械执行工件校验
- 给外部 AI 宿主的宿主无关语义 + 互通边界

## Bootstrap 姿态

`config/bootstrap.yaml` 声明包的 bootstrap 状态：

| 字段 | 值 |
| --- | --- |
| `bootstrap_contract` | `nimicoding.bootstrap` |
| `bootstrap_contract_version` | 1 |
| `profile` | `default` |

宿主项目跑 `nimicoding start` 时拾起 bootstrap。该项目就成为一个采纳了 Nimi Coding 的项目。

## Skill 清单

`config/skills.yaml` 声明四个 skill 表面（详情见 [Skills](/zh/nimicoding/skills)）：

| Skill | 必需 |
| --- | --- |
| `spec_reconstruction` | 是 |
| `doc_spec_audit` | 是 |
| `audit_sweep` | 否 |
| `high_risk_execution` | 否 |

Bootstrap state 里写明 `runtime_installed: false`、`installation_mode: deferred`。包不假设 runtime 已经在；外部宿主来实现 skill。

## Host Profile

`config/host-profile.yaml` 声明厂商中立的宿主预期：

| 性质 | 值 |
| --- | --- |
| `host_class` | `ai_native_coding_host` |
| `runtime_contract_ref` | `.nimi/methodology/skill-runtime.yaml` |
| `compatibility_contract_ref` | `.nimi/contracts/external-host-compatibility.yaml` |
| `ownership_mode` | `external` |
| `execution_mode` | `delegated` |
| `install_state` | `not_installed` |
| `self_hosted` | `false` |

必备宿主能力很少：

- `read_project_local_nimi_truth`
- `route_declared_external_skills`
- `fail_closed_on_missing_authority`

宿主硬约束：

- `vendor_neutral_profile_only`
- `do_not_assume_local_runtime_install`
- `do_not_claim_packet_orchestration_ownership`

## 阅读场景：一个项目采纳这套包

某项目要采纳 Nimi Coding 方法论。

1. **拿到包。** 按 [安装](/zh/nimicoding/installation) 把 npm 包 `@nimiplatform/nimi-coding` 装进项目。
2. **跑 bootstrap。** `nimicoding start` 在项目根初始化 `.nimi/**`。
3. **包源映射就位。** 方法论 / 合同 / 配置 / spec 源都被映到项目路径下。
4. **`spec_reconstruction` skill 可用。** 项目可以 hand off 给已准入的外部 AI 宿主做规范化 spec 重建。
5. **方法论开始用起来。** 项目从此可以 admit topic、冻结 packet、跑 preflight、dispatch worker（经宿主）、记录审计、闭 wave。

包给项目套上一层方法论。

## 阅读场景：换 AI 宿主

一个采纳了 Nimi Coding 的项目想从一个 AI 宿主换到另一个。

1. **方法论不动。** `.nimi/methodology/` 与 `.nimi/contracts/` 保持原样。
2. **换 adapter。** Adapter overlay（`adapters/<host-name>/profile.yaml`）是宿主特定的那一片，要换的就是它。
3. **Packet 不动。** 已有的 topic / wave / packet 工件继续作为规范化工作记录。
4. **闭合条件不动。** 四闭合框架继续适用。

方法论住在项目里，宿主可以换。

## 当前包暂时不做什么

如果你想用 Nimi Coding 做它准入范围之外的事，答案是「目前还不行，这是有意为之」。具体：

- **没有自动 packet 执行。** CLI 做 bootstrap 与校验，不自主跑 packet。
- **没有内置调度。** 调度在包之外。
- **没有 Provider 后端执行。** 包自己不调 AI provider；AI 宿主调。
- **没有自托管方法论 runtime。** runtime 拥有权保持外部。

这些是推迟，不是放弃。它们落在边界完整的独立范围之外。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/bootstrap.yaml)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/bootstrap-state.yaml)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/product-scope.yaml)
