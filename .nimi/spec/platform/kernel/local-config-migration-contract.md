# Local Config Validation And Repair Contract

> Owner Domain: `P-MIG-*`

## Scope

定义 `~/.nimi` 用户本地配置文件族的 current-schema 读取、修复路由、
`schemaVersion` fail-closed 语义，以及 `nimi_data` data-root 目录所有权/修复边界。

本契约是 T10 portfolio 的 cross-cutting authority：它**不**重新拥有任何单个
`~/.nimi` schema 文件的字段定义。每个 schema 文件的字段权威仍归其 surface owner
topic（`~/.nimi/nimi.json` → T1；`~/.nimi/runtime/config.json` /
`~/.nimi/profiles/factory-index.json` / `~/.nimi/runtime/default.json` → T2；
`~/.nimi` app registry / packages / library / grants 文件 → T4）。本契约只拥有：

- 跨文件统一的 `schemaVersion` fail-closed 规则；
- 跨文件统一的 current-schema validation framework（无自动旧 schema upgrade）；
- 跨文件统一的 repair 路由规则（unknown version / broken pointer →
  `repair_required` / `blocked`，never raw error、never silent recreate、
  never data orphaning）；
- `nimi_data` data-root 目录所有权与 destructive-cleanup confirmation floor。

Runtime `~/.nimi/runtime/config.json` 的迁移机制由 Runtime kernel 的
`K-CFG-014` / `K-CFG-015` / `K-CFG-016` 定义并执行。本契约**不**重定义该机制；
`~/.nimi` 配置文件族的统一框架与之**不竞争**：Desktop 侧不执行 Runtime config
迁移，也不提供跨文件旧 schema 自动升级。Runtime config 继续由 `K-CFG-*` 作为
该文件自身的执行权威。

不拥有：

- 任何单个 `~/.nimi` schema 文件的字段定义、默认值或 reload 语义；
- Runtime config 的迁移执行（`K-CFG-014..016` 所有）；
- `~/.nimi/nimi.json` 的 product-control 状态机（`P-COLD-009..016`）；
- Runtime model / dependency / environment materializer 对 `nimi_data` 子目录的
  写入与清理执行（`K-LENV-*`）。

## Governed Config File Family

本契约统辖的 `~/.nimi` 用户本地配置文件族（"sibling config files"）：

| File | Schema field owner topic | Notes |
|---|---|---|
| `~/.nimi/nimi.json` | T1 | product-control record；`P-COLD-009` |
| `~/.nimi/runtime/config.json` | T2 | Runtime config；迁移执行由 `K-CFG-014..016` 拥有 |
| `~/.nimi/runtime/default.json` | T2 | Runtime default seed |
| `~/.nimi/profiles/factory-index.json` | T2 | factory AIProfile index |
| `~/.nimi/apps/registry.json` | T4 | account apps registry projection |
| `~/.nimi/apps/packages.json` | T4 | installed app packages projection |
| `~/.nimi/accounts/<account-id>/apps/library.json` | T4 | account app-library projection |
| `~/.nimi/accounts/<account-id>/permissions/grants.json` | T4 | account-scoped permission grant projection |

`MUST`：本族的成员清单与每个成员的 schema-owner topic 由本契约 canonical
固化于上表，并由 `tables/local-config-file-registry.yaml` 作为结构化事实源
镜像。新增 `~/.nimi` 顶层用户本地配置文件，必须同时在上表与该表登记，否则该文件
不得被视为 governed config 并不得进入 ordinary readiness 路径。

## P-MIG-001 — Mandatory `schemaVersion` Field

`MUST`：本契约 governed config file family 中的每个文件都必须在文件根包含一个
整数 `schemaVersion` 字段。`schemaVersion` 是迁移入口标识，不是声明性占位字段。

`MUST NOT`：缺失 `schemaVersion`、`schemaVersion` 为非整数、或 `schemaVersion`
为 `0` / 负数的配置文件，不得被视为已知 schema 并不得进入 ordinary readiness
路径；该文件必须按 `P-MIG-004` 路由到修复。

## P-MIG-002 — `schemaVersion` Fail-Closed Read

`MUST`：读取 governed config 文件时，读取方必须先比较文件 `schemaVersion` 与
该文件 owner topic 声明的当前 supported `schemaVersion`：

- `schemaVersion` 等于当前 supported version → 正常读取。
- `schemaVersion` 小于当前 supported version → fail-closed，按 `P-MIG-004`
  路由到 `repair_required`。项目未上线，Desktop 不提供旧 schema 自动升级。
- `schemaVersion` 大于当前 supported version（未知未来版本）→ fail-closed，按
  `P-MIG-004` 路由到 `repair_required`。

`MUST NOT`：读取方不得对未知 `schemaVersion` 做"猜测修复"、字段补默认、降级为
部分可用、或以 best-effort projection 当作 ready。未知 `schemaVersion` 永远是
fail-closed-to-repair，不是 fail-open。

## P-MIG-003 — Shared Current-Schema Validation Framework

`MUST`：governed config file family 必须共享同一个 current-schema validation /
repair-routing 框架，不得每个文件各自实现一套旧 schema upgrade 逻辑。该共享框架
必须提供：

- **current-version gate**：只接受该文件 owner topic 声明的当前
  `schemaVersion`。
- **no write on read**：读取、解析、版本检查、结构校验失败不得改写文件、
  不得创建 `.bak`、不得写入默认字段。
- **owner structural validation**：字段级 schema、pointer 校验、repair/regenerate
  行为仍由单文件 owner 拥有；共享框架只负责 current-schema gate 与 typed repair
  outcome。

`MUST`：若产品上线后需要真实 schema bump，必须由对应 schema owner 先提交新的
authority 与 migration packet；在该 authority admitted 之前，旧版本一律
fail-closed-to-repair。

`MUST`：Runtime `~/.nimi/runtime/config.json` 的迁移执行继续由 `K-CFG-014` /
`K-CFG-015` / `K-CFG-016` 拥有。本框架对该文件的约束是 membership /
alignment-only：`P-MIG-*` 不执行该文件迁移。

`MUST NOT`：不得存在第二套并行的 `~/.nimi` schema upgrade 实现；不得出现
Desktop 读旧版本并自动补字段、改写文件、保留 migration backup、或把旧版本当作
ordinary ready 的行为。

## P-MIG-004 — Repair Routing For Unknown Version And Broken Pointer

`MUST`：governed config 文件在以下情况必须路由到 typed 修复状态，而不是向
renderer / 上层 bubble 一个 raw error 字符串：

- 文件不可解析（parse failure）。
- `schemaVersion` 未知（`P-MIG-002` 的 fail-closed 分支）。
- 文件内引用其他 `~/.nimi` 路径 / `nimi_data` 路径的 pointer 已无法解析
  （broken pointer）。

路由目标：

- 对 `~/.nimi/nimi.json`，修复状态使用 `P-COLD-009` 的 product-control
  `state` 集合（`config_missing` / `repair_required` / `blocked`），由
  product-control backend 拥有。
- 对其他 governed config 文件，修复状态使用本契约的 typed 修复结果
  `repair_required` 或 `blocked`（依严重度），并必须可被上层归一化为产品级
  修复入口，不得作为 raw `Err` 字符串呈现。

`MUST NOT`：读取方不得通过 silent recreation 把 broken-pointer 文件"修好"——
若重建 pointer 会使既有 `nimi_data` / 既有 app / account / model / 依赖数据被
孤立（orphaning），则必须 fail-closed 到 `repair_required` / `blocked`，
保持 on-disk 文件不被静默改写。pointer 重建只允许在显式修复流程中、且确认不会
孤立既有数据后进行。

## P-MIG-005 — No Data Orphaning Invariant

`MUST`：任何 governed config 文件的修复或重建路径都必须保持 no-orphaning
invariant：若一个操作会让既有的 user / app / account / model / dependency /
environment 数据失去其权威 pointer，该操作必须 fail-closed，并把状态路由到
`repair_required` / `blocked`，直到显式修复流程在 impact 已知的前提下重新建立
一致 pointer。

`MUST NOT`：missing config 文件不得通过写入一个指向新空目录的默认 pointer 来
"恢复"，如果磁盘上已存在一个先前选定的 `nimi_data` / 数据目录——该情况必须
进入 blocked/repair 流程；在 data-root relocation Support/Admin capability admitted
之前，不得提供普通迁移、重连、或 pointer rewrite。

## P-MIG-006 — `nimi_data` Directory Ownership Authority

`MUST`：`nimi_data` 数据根下每个一级目录的 owner 与 cleanup rule 由
`tables/nimi-data-directory-ownership.yaml` canonical 固化。该表是 `nimi_data`
目录所有权与清理策略的唯一结构化事实源。

`MUST`：任何对 `nimi_data` 子目录的清理 / 删除 / 修复操作都必须遵守该表中对应
行声明的 owner 与 cleanup rule。`models/` / `dependencies/` / `environments/`
只能通过 Runtime 拥有的 management / job 路径变更；`apps/<app-id>/data/` 默认
在 app 卸载时保留，删除需显式用户动作；`accounts/<account-id>/` 大数据需显式
用户 / export / delete 策略。

`MUST NOT`：Desktop shell、Support surface 或任何 renderer 不得绕过对应 owner
直接 mutate `models/` / `dependencies/` / `environments/`；app 卸载不得按隐含
副作用删除 shared models、Runtime dependencies、account data 或其他 app 的
数据。

## P-MIG-007 — `nimi_data` Relocation Requires Admitted Support/Admin Authority

`MUST`：first-run 之后移动 `nimi_data` data root 不属于 ordinary Desktop app
行为。若产品需要该能力，必须作为显式 Support/Admin capability 先 admitted，并
证明其 owner、impact preview、typed state machine、pointer commit last、Runtime
config re-sync 与 no-orphaning 语义。

`MUST NOT`：普通 Desktop 设置页、renderer、或 product-control first-run path
不得把 data-root 变更降级为 silent pointer rewrite、普通重新选择、或 Runtime
config 的静默 re-sync。

## P-MIG-008 — Destructive Cleanup Confirmation

`MUST`：任何可能删除 user / app / account 数据的清理操作（包括 cache 清理、
generated artifact 清理、release payload 清理、account/app data 删除）都必须
在执行前提供 explicit confirmation 与 impact preview，并遵守 `P-MIG-006` 对应
目录行的 cleanup rule。

`MUST NOT`：任何清理路径不得在无 impact preview 与无显式确认的前提下删除
non-cache 的 user / app / account 持久数据；`cache/` / `tmp/` 类纯缓存目录的
清理可不强制确认，但仍必须遵守 `P-MIG-006` 的 cleanup rule 分类。

## Cross-Authority Boundaries

- `~/.nimi/nimi.json` 的 product-control 状态机仍归 `P-COLD-009..016`；本契约
  对该文件只提供 governed-family 成员资格与统一 fail-closed/repair-routing
  floor，不重定义其 `state` 集合。
- `~/.nimi/runtime/config.json` 的迁移执行仍归 `K-CFG-014..016`；本契约只
  作为跨文件 membership / repair floor 与之对齐，不重定义其执行规则。
- `nimi_data` 子目录的 materialization 写入与 job 执行仍归 Runtime
  `K-LENV-*`；本契约只拥有目录 owner/cleanup 表与 data-root relocation admission
  floor，不提供 ordinary Desktop relocation 执行面。
- per-file schema 字段定义仍归各 owner topic（T1 / T2 / T4）；本契约只拥有
  跨文件 current-schema validation framework 与 repair-routing 规则。

## Fact Sources

- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-009..P-COLD-016`
- `.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`
- `.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml`
- `.nimi/spec/runtime/kernel/config-contract.md` — `K-CFG-014`, `K-CFG-015`, `K-CFG-016`, `K-CFG-018`
- `.nimi/topics/ongoing/2026-05-20-nimi-product-manual-authority-recovery/product-manual-full-authority.md` — §`nimi_data` Directory Ownership (614-632), §Migration And Repair Rules (634-644)
