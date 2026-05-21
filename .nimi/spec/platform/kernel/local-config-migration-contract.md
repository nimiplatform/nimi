# Local Config Migration And Repair Contract

> Owner Domain: `P-MIG-*`

## Scope

定义 `~/.nimi` 用户本地配置文件族的跨文件 schema 迁移、修复路由、
`schemaVersion` fail-closed 语义，以及 `nimi_data` data-root 迁移流程。

本契约是 T10 portfolio 的 cross-cutting authority：它**不**重新拥有任何单个
`~/.nimi` schema 文件的字段定义。每个 schema 文件的字段权威仍归其 surface owner
topic（`~/.nimi/nimi.json` → T1；`~/.nimi/runtime/config.json` /
`~/.nimi/profiles/factory-index.json` / `~/.nimi/runtime/default.json` → T2；
`~/.nimi` app registry / packages / library / grants 文件 → T4）。本契约只拥有：

- 跨文件统一的 `schemaVersion` fail-closed 规则；
- 跨文件统一的 migration framework（ordered registry + backup + atomic
  rewrite + idempotent replay）；
- 跨文件统一的 repair 路由规则（unknown version / broken pointer →
  `repair_required` / `blocked`，never raw error、never silent recreate、
  never data orphaning）；
- `nimi_data` data-root 迁移流程（size/impact preview、typed state machine、
  destructive-cleanup confirmation）。

Runtime `~/.nimi/runtime/config.json` 的迁移机制由 Runtime kernel 的
`K-CFG-014` / `K-CFG-015` / `K-CFG-016` 定义并执行。本契约**不**重定义该机制；
`~/.nimi` 配置文件族的统一框架与之**对齐**：相同的 ordered-migration、
pre-migration backup、atomic write、idempotent replay 语义在 `P-MIG-*` 中作为
跨文件 floor 固化，Runtime config 继续由 `K-CFG-*` 作为该文件自身的执行权威。

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
| `~/.nimi/registry.json` | T4 | account apps registry projection |
| `~/.nimi/packages.json` | T4 | installed app packages projection |
| `~/.nimi/library.json` | T4 | account profile library projection |
| `~/.nimi/grants.json` | T4 | permission grant projection |

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
- `schemaVersion` 小于当前 supported version 且存在已登记的迁移路径 → 按
  `P-MIG-003` 执行顺序迁移后再读取。
- `schemaVersion` 大于当前 supported version（未知未来版本）→ fail-closed，按
  `P-MIG-004` 路由到 `repair_required`。
- `schemaVersion` 小于当前 supported version 且**无**已登记迁移路径 →
  fail-closed，按 `P-MIG-004` 路由到 `repair_required`。

`MUST NOT`：读取方不得对未知 `schemaVersion` 做"猜测修复"、字段补默认、降级为
部分可用、或以 best-effort projection 当作 ready。未知 `schemaVersion` 永远是
fail-closed-to-repair，不是 fail-open。

## P-MIG-003 — Shared Migration Framework

`MUST`：governed config file family 必须共享同一个迁移框架，不得每个文件各自
实现一套 schema upgrade 逻辑。该共享框架必须提供：

- **ordered migration registry**：每个文件族的迁移步骤按 `from_version` →
  `to_version` 有序登记；迁移引擎按顺序逐级应用，不得跳级隐式升级。
- **per-step migration plan**：每个迁移步骤必须声明 `from_version`、
  `to_version`、字段级变更、默认值策略与 fail-close 条件。未知旧字段只能通过
  显式迁移规则处理，不得静默丢弃。
- **pre-migration backup**：迁移成功写回前，必须保留可恢复的 pre-migration
  备份或等价回滚材料。
- **atomic rewrite**：迁移后写回必须是原子写；写回失败时保留旧文件、终止该
  文件进入 ordinary readiness，并暴露 typed 失败给上层。
- **idempotent replay**：同一版本配置多次重放迁移，输出结果必须一致。

`MUST`：per-file *migration step 定义*（具体某次 `schemaVersion` 递增的字段级
变更）由该文件的 schema-owner topic（T1 / T2 / T4）随版本 bump 一并提供并登记
进 registry。本契约只拥有 framework 与登记约束，不预先编写他人文件的迁移步骤。

`MUST`：Runtime `~/.nimi/runtime/config.json` 的迁移执行继续由 `K-CFG-014` /
`K-CFG-015` / `K-CFG-016` 拥有。本框架对该文件的约束是 alignment-only：`P-MIG-*`
框架语义必须与 `K-CFG-*` 一致，二者不得对同一文件给出冲突的迁移执行规则。

`MUST NOT`：不得存在第二套并行的 `~/.nimi` schema upgrade 实现；不得出现
"schema 已升级但投影仍停留旧版本"的漂移。

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
进入修复流程，由 `P-MIG-007` 的迁移/重连流程处理。

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

## P-MIG-007 — `nimi_data` Migration Flow

`MUST`：first-run 之后移动 `nimi_data` data root 必须是一个显式迁移流程，
不是 first-run 的 casual back-button，也不是单纯改写 data-root pointer。该迁移
流程必须包含：

- **size/impact preview**：在确认前向用户展示待迁移数据规模、受影响目录
  （按 `P-MIG-006` 的 owner 分类）与预计影响。
- **typed migration state machine**：迁移过程必须经过 typed 状态（至少
  `preview` → `confirmed` → `in_progress` → `verifying` → `completed`，
  以及失败分支 `failed` / `repair_required`），不得是单步不可观测的改写。
- **fail-closed on partial move**：迁移中途失败时，必须进入可恢复的失败状态，
  保留既有 data root 仍可指向、不得使任一侧数据被孤立（`P-MIG-005`）。
- **pointer commit last**：`~/.nimi/nimi.json` 的 `dataRoot` / `pointers`
  与 Runtime config 的 `dataRootRef` 只能在数据已迁移并通过校验后、作为迁移的
  最后一步原子提交。

`MUST NOT`：迁移流程不得在数据搬运完成并校验通过之前改写 data-root pointer；
不得在没有 preview 的情况下执行 data root 变更；不得把 data-root 变更降级为
runtime config 的静默 re-sync。

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
  作为跨文件 floor 与之对齐，不重定义其执行规则。
- `nimi_data` 子目录的 materialization 写入与 job 执行仍归 Runtime
  `K-LENV-*`；本契约只拥有目录 owner/cleanup 表与 data-root 迁移流程。
- per-file schema 字段定义仍归各 owner topic（T1 / T2 / T4）；本契约只拥有
  跨文件 migration framework 与 repair-routing 规则。

## Fact Sources

- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-009..P-COLD-016`
- `.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`
- `.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml`
- `.nimi/spec/runtime/kernel/config-contract.md` — `K-CFG-014`, `K-CFG-015`, `K-CFG-016`, `K-CFG-018`
- `.nimi/topics/ongoing/2026-05-20-nimi-product-manual-authority-recovery/product-manual-full-authority.md` — §`nimi_data` Directory Ownership (614-632), §Migration And Repair Rules (634-644)
