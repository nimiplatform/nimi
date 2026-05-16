# 包

`@nimiplatform/nimi-coding` 是 Nimi Coding 方法论的**独立、宿主无关的边界包**。本页说明这个包提供什么、刻意不提供什么，以及为什么这样划分。

## 包的基本信息

| 属性 | 取值 |
| --- | --- |
| 包名 | `@nimiplatform/nimi-coding` |
| 当前版本 | `0.2.1` |
| 是否自托管运行时 | 否（运行时由外部 AI 宿主负责） |
| 厂商中立 | 是 |
| 宿主类别 | `ai_native_coding_host` |
| 许可协议 | MIT |
| 二进制入口 | `nimicoding` |

产品目标是让任意项目装上一套可复用的 AI 编码治理工具，初始化项目本地的 `/.nimi/**` 真相层，并对高风险工作启用 AI 原生的权威 / packet / 验收纪律。

## 包内容

| 路径 | 用途 |
| --- | --- |
| `methodology/` | 方法论源（policy） |
| `contracts/` | Schema 源（强类型契约） |
| `config/` | bootstrap 配置（manifest、host-profile 等） |
| `spec/` | bootstrap 规范种子（`bootstrap-state`、`product-scope`） |
| `cli/` | CLI 实现 |
| `bin/nimicoding.mjs` | 入口二进制 |
| `adapters/` | 宿主适配 overlay（`codex`、`claude`、`oh-my-codex`） |

`nimicoding start` 在宿主项目内执行时，会把包内的源写入项目本地的 `.nimi/**`：

| 源 | 写入位置 |
| --- | --- |
| `methodology/` | `.nimi/methodology/` |
| `contracts/` | `.nimi/contracts/` |
| `config/` | `.nimi/config/` |
| `spec/`（仅 bootstrap） | `.nimi/spec/`（仅 bootstrap 文件） |

## 包刻意不提供的能力

| 能力面 | 状态 | 推迟原因 |
| --- | --- | --- |
| packet 绑定的运行内核 | 推迟 | 方法论负责形态，不负责执行 |
| 调用 provider 的执行 | 推迟 | 包本身不直接跑 AI |
| 调度器 | 推迟 | 执行时机由宿主负责 |
| 通知 | 推迟 | UX 由宿主负责 |
| 自动化后端 | 推迟 | 自动化由宿主负责 |
| 自托管的方法论运行时 | 推迟 | 运行时所有权留在外部 |

这些都是显式**推迟的能力面**。包以"在独立适用范围内边界完整"为准则：交付方法论、契约、bootstrap 和机械校验器，不替你跑任务。

## 为什么是"边界完整"，不是"运行完整"

只在边界上完整的包可以被任意项目采用。如果同时附带运行时，就会与某种特定的执行模型耦合（特定 AI 宿主、特定调度器、特定通知系统）。

之所以做这种分割：

- 方法论是**可移植的**——和宿主无关。
- 运行时是**宿主特定的**——同一份执行可以经由 Claude、Codex、Gemini、OMX 或其他遵守契约的宿主。
- 把两者绑在一起，等于强迫使用方同时采用方法论和执行层。

包给出的承诺是：今天就能用上方法论，明天换 AI 宿主也不会改动方法论契约。

## 当前包的边界完整范围

独立形态当前的边界完整范围覆盖：

- 包身份
- 仓库基础
- 初版 AI 原生方法论种子
- 包自有的 bootstrap 源写入
- 重建、文档-规范审计、高风险执行结果的机器可读契约
- 包自有的高风险准入 schema 契约
- 产品权威表的 table-family 校验，包括发布关卡注册表使用的
  `gate_registry` 表族
- 仅种子的高风险执行 schema（packet、orchestration-state、prompt、worker-output、acceptance）
- 厂商中立的外部 host-profile 种子
- 包自有的外部宿主兼容契约种子
- 用于受限外部执行宿主互通的 host-adapter 种子
- 已准入的包自有 host adapter overlay（`codex`、`claude`、`oh-my-codex`）
- 一个边界明确的独立 CLI，覆盖分阶段的 `start`、校验、`sync`、handoff、本地 closeout 写出、topic 生命周期、sweep audit、sweep design、显式准入、治理校验器和机械执行工件校验
- 面向外部 AI 宿主的、宿主无关的语义 + 互通边界

## Release Boundary

`0.2.0` 是独立公开包的切换版本。它发布的是 bootstrap、校验、交接、本地 closeout、topic 生命周期、sweep audit、sweep design 和高风险执行关卡的 CLI 边界。

`0.2.1` 保持这个包边界不变，并新增 `gate_registry` 表族，用于产品自有的发布关卡注册表。发布关卡注册表不是闭合枚举，也不是通用产品目录；它承载 registry 元数据、profile、tier、target、reason code 和 gate 条目，这些内容属于产品权威。

Runtime 执行、调度、通知、provider 调用和自托管方法论执行仍在包边界之外。适配器特定 helper 不会改变这个边界。

## Bootstrap 形态

`config/bootstrap.yaml` 声明包的 bootstrap 状态：

| 字段 | 取值 |
| --- | --- |
| `bootstrap_contract` | `nimicoding.bootstrap` |
| `bootstrap_contract_version` | 1 |
| `profile` | `default` |

在宿主项目内执行 `nimicoding start` 即接管 bootstrap，该项目随后成为采用 Nimi Coding 的项目。

## 技能清单

`config/skills.yaml` 声明四个技能面（详见 [Skills](/zh/nimicoding/skills)）：

| 技能 | 是否必需 |
| --- | --- |
| `spec_reconstruction` | 是 |
| `doc_spec_audit` | 是 |
| `audit_sweep` | 否 |
| `high_risk_execution` | 否 |

bootstrap 状态声明 `runtime_installed: false`、`installation_mode: deferred`。包不假设运行时存在；技能由外部宿主实现。

## 宿主画像

`config/host-profile.yaml` 声明厂商中立的宿主预期：

| 属性 | 取值 |
| --- | --- |
| `host_class` | `ai_native_coding_host` |
| `runtime_contract_ref` | `.nimi/methodology/skill-runtime.yaml` |
| `compatibility_contract_ref` | `.nimi/contracts/external-host-compatibility.yaml` |
| `ownership_mode` | `external` |
| `execution_mode` | `delegated` |
| `install_state` | `not_installed` |
| `self_hosted` | `false` |

宿主必备能力是最小集合：

- `read_project_local_nimi_truth`
- `route_declared_external_skills`
- `fail_closed_on_missing_authority`

宿主硬性约束：

- `vendor_neutral_profile_only`
- `do_not_assume_local_runtime_install`
- `do_not_claim_packet_orchestration_ownership`

## 场景：项目首次采用这个包

某个项目希望采用 Nimi Coding 方法论。

1. **获取包**。按 [安装指南](/zh/nimicoding/installation) 从 npm 安装 `@nimiplatform/nimi-coding`。
2. **运行 bootstrap**。`nimicoding start` 在项目根目录初始化 `.nimi/**`。
3. **包内源被写入项目**。methodology / contracts / config / spec 写入对应路径。
4. **`spec_reconstruction` 技能可用**。项目可把任务交给已准入的外部 AI 宿主完成规范重建。
5. **方法论开始运转**。项目可以准入 topic、冻结 packet、做预检、派发 worker（经由宿主）、记录审计、关闭 wave。

包接管的是项目的 bootstrap 层；项目得到的是方法论层。

## 场景：切换 AI 宿主

某个项目当初采用 Nimi Coding 时绑定了某个 AI 宿主，现在希望换一个。

1. **方法论保持不变**。`.nimi/methodology/` 和 `.nimi/contracts/` 不动。
2. **替换宿主适配 overlay**。`adapters/<host-name>/profile.yaml` 是宿主特定那一层，需要替换的就是它。
3. **packet 不变**。已有的 topic / wave / packet 工件继续是工作记录的权威源。
4. **闭合条件不变**。四闭合框架继续生效。

方法论住在项目里，宿主可替换。

## 当前不在范围内的能力

如果你希望用 Nimi Coding 做一些当前形态之外的事：

- **不会自动执行 packet**。CLI 负责 bootstrap 与校验，不替你跑 packet。
- **没有内建调度**。调度在包之外。
- **不直接调用 provider**。包本身不调 AI provider，调用方是宿主 AI。
- **没有自托管的方法论运行时**。运行时所有权留在外部。

这些是被推迟，不是被放弃。它们位于"独立形态边界完整"范围之外。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/CHANGELOG.md`](https://github.com/nimiplatform/nimi-coding/blob/main/CHANGELOG.md)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi-coding/blob/main/AGENTS.md)
- [`nimi-coding/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/table-family.schema.yaml)
- [`nimi-coding/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/bootstrap.yaml)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/skills.yaml)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/host-profile.yaml)
- [`nimi-coding/adapters/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/adapters/README.md)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
