# Platform Product Lifecycle - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/platform/product-lifecycle.authority.yaml`。

---

<!-- source: .nimi/spec/platform/kernel/cold-start-authority-contract.md -->

# Cold Start Authority Contract

> Owner Domain: `P-COLD-*`

## Scope

定义 `Nimi` 冷启动场景下的 authority owner split。本契约固化为 Platform
canonical 规则。

冷启动指 process 启动之后、account / Runtime / 本地依赖 / app registry /
factory AIProfile selection 中任何 authority 尚未 ready 的时间段。

## P-COLD-001 — Fail-Closed Only State Set

`MUST`：在任何 upstream authority ready 之前，`Nimi Home` 只能投影以下
fail-closed 状态：

- `unavailable`
- `setup-required`
- `needs-confirmation`
- `in-progress`
- `failed`
- `unsupported`
- `stale-projection`

`MUST NOT`：不得投影 `empty success`、`best-effort-ready`、`guessed
default`、`anonymous success as authenticated`、或任何"latest-known
projection"作为 ready。

## P-COLD-002 — Process Start Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Process starts | Desktop-hosted Home | 渲染 shell、加载 packaged release metadata、显示非 ready 状态 | 声称 Runtime / account / model / app / memory ready 而未消费 authority projection |

## P-COLD-003 — Runtime Bootstrap Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Runtime bootstrap | Runtime + Desktop host projection | 启动 / 观察 packaged daemon；显示精确失败 | Desktop-owned Runtime 替换、PATH fallback、fake version |

## P-COLD-004 — Account Unauthenticated Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Account unauthenticated | Realm + Runtime custody projection | 显示 sign-in / skip / local posture；Runtime 报告 local custody 状态 | Renderer durable token custody、anonymous success as authenticated |

## P-COLD-005 — Host Capability Detection Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Host capability detection | Runtime | probe / project host profile（`K-LENG-024` 与 `tables/host-capability-profiles.yaml`） | Home GPU / CUDA / Python probing 或 installer 逻辑 |

## P-COLD-006 — AIProfile Selection Policy Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| factory AIProfile selection | Platform-owned AIProfile selection policy consuming Runtime evidence | 按 `P-AIPS-004` / `P-AIPS-006` 选择 factory AIProfile；按 `D-AIPC-005` apply 到 AIConfig | UI 中 provider / model 常量（`P-AIPS-008`） |

## P-COLD-007 — Local Dependency Setup Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Local dependency setup | Runtime materializers | plan、confirm、job、verify、promote selected source records（`K-LENV-MAT-*`、`K-LENV-ACT-*`） | Home 直接 download / verify / repair |

## P-COLD-008 — First App / Apps Projection Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| First app / Apps projection | Platform registry + Home projection | 显示 admitted ordinary-visible apps + 显式 unknown / unavailable 状态 | App-local discovery truth |

## P-COLD-009 — Product-Local Control Record

`MUST`：installed Nimi product shell 的 Runtime-owner control record 固定为
`<runtime_owner_state_root>/nimi.json`。Production 将该 root 绑定到 installer-verified
service state root；request、env、argv、renderer 与 interactive-user home 都不能改写或回退该绑定。该文件拥有 ordinary product readiness gate 的小型本地
控制状态，包括 `schemaVersion`、`installId`、`productVersion`、`state`、
`dataRoot`、`firstRun`、`pointers`、and `repair`。

Allowed `state` values are:

- `not_logged_in`
- `config_missing`
- `data_root_missing`
- `data_root_selected`
- `ai_environment_unconfigured`
- `local_ai_profile_selected_assets_missing`
- `local_ai_profile_selected_environment_not_ready`
- `local_ai_assets_downloaded_environment_not_ready`
- `local_ai_ready`
- `repair_required`
- `blocked`
- `ready_for_use`

`MUST NOT`：repo `.nimi/spec/**`、Runtime config、Desktop path cache、or
app-local state must not replace `<runtime_owner_state_root>/nimi.json` as product readiness
owner. Missing or invalid `<runtime_owner_state_root>/nimi.json` routes to `config_missing` /
repair; it must not be treated as ordinary ready.

## P-COLD-010 — User-Selected Data Root

`MUST`：first-run must record an absolute user-selected `nimi_data` path in
`<runtime_owner_state_root>/nimi.json` before heavy downloads, dependency installation, app
package install, model materialization, or environment setup starts. The path is
ready only after writability and required root directory creation evidence.

`nimi_data` owns the large data plane:

```text
models/
dependencies/
environments/
apps/<local-app-principal-id>/{releases,data,cache,tmp}
accounts/<account-id>/{data,cache,exports,tmp}
cache/
logs/
audit/
generated/
tmp/
```

`MUST NOT`：first-run readiness may not silently default `nimi_data` to
`~/.nimi/data`. Existing Desktop path records may be migration inputs only; they
are not readiness truth until reconciled into `<runtime_owner_state_root>/nimi.json`.
App storage subpaths are Runtime-private principal partitions; app ID is never
a positive storage key and the displayed skeleton does not admit immutable
release materialization before 0P.

## P-COLD-011 — First-Run Install Level State Machine

`MUST`：first-run presents `Minimal` and `Recommended` install levels, not raw
provider/model/dependency routing. Both levels must be local baselines.

- `Minimal` maps to local text/chat plus local basic STT and TTS.
- `Recommended` is device-aware and may add admitted local embedding, image, or
  GPU support when Runtime evidence and user confirmation support the plan.

Only `ready_for_use` enters ordinary shell, and it requires login, valid
`<runtime_owner_state_root>/nimi.json`, selected `nimi_data`, Account Default Profile, built-in
AIConfigs, Runtime baseline readiness, and execution evidence.

`MUST NOT`：Cloud API, cloud-only, cloud-first, hybrid, connector setup, video
generation, or app-specific pack setup may satisfy first-run readiness.

## P-COLD-012 — Ready Entry And Auth Gate

`MUST`：after `ready_for_use`, Desktop opens ordinary product use at
`Chat -> Nimi Chat`. `Home` remains the Realm feed surface; it is not the ready
entry target.

`MUST`：logged-out ordinary shell use is not current product baseline.
Unauthenticated users route to login or recovery-only states until a Runtime
account session projection exists.

`MUST NOT`：Desktop may not render the ordinary shell as normal use when account
state is `not_logged_in`, and may not treat anonymous Runtime/debug posture as
authenticated product readiness.

## P-COLD-013 — Runtime Config Owner Split

`MUST`：Production Runtime configuration belongs to the isolated Runtime OS
service principal at its OS-profile protected location. Product-control may
send selected `nimi_data` only through an exact typed protected operation;
Runtime stores `dataRootRef`/managed roots in service-owned state. Physical
Runtime config paths are never product-control pointers.

`MUST`：On Windows the native Desktop host, through the shared Kit protected
local adapter, prepares the user-selected data-plane root for the exact fixed
`NimiRuntime` service SID before invoking that typed operation. The user
remains the root owner, the service access is inheritable only to the selected
tree, reparse-point roots fail closed, and Runtime independently verifies and
records the result. Renderer ACL mutation, broad service/user grants, or a
test-only principal are forbidden.

`MUST NOT`：`~/.nimi/config.json`, retired
`~/.nimi/runtime/config.json`, `<runtime_owner_state_root>/nimi.json`, Desktop caches, env, argv,
or renderer metadata cannot become Runtime security/configuration truth. The
pre-release hardcut imports no old Runtime config or credentials; ambiguity
fails closed and requires fresh service configuration.

## P-COLD-014 — Canonical First-Run State Machine

`MUST`：first-run product states, entry conditions, allowed user actions, exit
conditions, and copy floor are canonically recorded in
`tables/first-run-state-machine.yaml`.

`MUST`：Desktop first-run UI must consume the product-control state semantics
from this table. Generic cold-start diagnostics may be displayed as secondary
status, but must not replace the first-run workflow state.

`MUST NOT`：Desktop may not collapse the first-run workflow into generic
`ready` / `available` / `done` states, and may not show technical enum names as
the primary user-facing copy.

## P-COLD-015 — Product-Control Record Schema Invariants

`MUST`：the canonical product-control record schema invariants are recorded in
`tables/product-control-record-schema.yaml`.

`MUST`：any path that transitions `<runtime_owner_state_root>/nimi.json` to `ready_for_use` must
validate selected `nimi_data`, local install level, Account Default Profile,
built-in `AIConfig` refs, Runtime baseline ref, and execution evidence ref.

`MUST NOT`：Runtime config, Desktop path cache, file existence, transfer
completion, import success, endpoint probe, script exit, or renderer-local
state may satisfy product readiness without the `ready_for_use` product-control
record and required evidence fields.

For the signed `dev_kernel_checkpoint` non-release profile only, the first real
installation creates a Product Control record below a service-owned development
state lineage. The lineage identity is the exact signed trial id, the
first-install `developmentStateCandidateId`, and a cryptographically random
`acceptanceRoundId`. Later signed Runtime candidate updates preserve those two
state-lineage fields while independently replacing and verifying the current
`runtimeCandidateId`. Product Control, Runtime local state, audit,
model-registry, generated identity, and durable grants therefore remain bound
to the same lineage. Runtime restart and binary update must preserve completed
First Run state. A fresh lineage requires an explicit destructive repair/reset
operation and never follows merely from installer `Install`. Existing or
damaged records follow the normal repair/fail-closed state machine and must not
be silently reset in place.

The protected lineage and round identity must not be selected by HOME,
TEMP, renderer state, endpoint, environment, argv, or a request field. The
signed checkpoint profile may affect only the visible directory proposal, the
lineage's Runtime data-plane roots, and the user's explicit selection through
the normal typed Product Control operation. When the signed installer records
an explicit absolute development data-root binding, Runtime uses that protected,
lineage-bound field as its proposal and data-plane root. Otherwise Runtime
derives the proposal from the verified interactive Windows SID's OS profile
mapping plus the signed trial id and build-record-verified Runtime candidate id.
Desktop must prefer the Runtime projection and must not reconstruct a checkpoint
path from HOME, USERPROFILE, TEMP, renderer state, argv, endpoint, or request
data. The proposal never selects or writes `dataRoot`; explicit user confirmation
through the normal typed operation remains required.

An explicit development data-root binding does not import Product Control,
account, audit, model-registry, or generated-identity state from another Runtime
partition. Existing model, dependency, and environment payload bytes may be
reused only after the current candidate independently verifies catalog hashes,
manifests, compatibility, and activation readiness and writes new evidence into
its isolated service-owned state. Existing files or an older local-state record
alone cannot satisfy First Run.
The checkpoint profile remains `non_release` and
`non_promotable_to_product_close`; it cannot become a product bypass or a
parallel Product Control store.

## P-COLD-016 — Product Ready Admission Evidence Composition

`MUST`：transition to `ready_for_use` is admitted only by the Runtime-owned
product-control service operation defined in
`tables/product-control-record-schema.yaml`. The renderer may request or display
finalization, but it cannot write `ready_for_use`, mint evidence refs, or
declare refs valid. Desktop shell may provide bounded OS helpers such as native
directory picking, but product-control validation, readiness admission, and
`<runtime_owner_state_root>/nimi.json` writes belong to Runtime.

Admission composes evidence in this order:

1. product-control record shape, `installId`, `productVersion`, selected
   `nimi_data`, and local first-run install level
2. authenticated Runtime account session / account binding from
   `RuntimeAccountService`
3. local account profile library `accountDefaultProfileRef` from `P-AIPS-013`,
   bound to the authenticated `account_id` and selected data root
4. selected first-run local factory `AIProfile` refs and baseline commit refs
   from `P-AIPS-*`
5. Runtime local baseline readiness `runtimeBaselineRef` from
   `K-LENV-ACT-011`
6. built-in Desktop AIConfig refs for `desktop.chat.nimi` and
   `desktop.chat.agent` from `P-AISC-006` / `D-AIPC-013`
7. Runtime baseline execution `executionEvidenceRef` from `K-AIEXEC-007`
8. atomic `<runtime_owner_state_root>/nimi.json` write to `ready_for_use`

`MUST`：each ref is a durable, owner-verifiable evidence ref. String shape,
field presence, UUID/ULID format, or renderer-provided equality checks are not
verification.

`MUST NOT`：Cloud API, cloud-only, cloud-first, hybrid, video generation,
connector setup, app-specific packs, Runtime route health, file existence,
localStorage, Desktop path cache, Runtime config alone, endpoint probes, or
app-level REST calls may participate as positive ready evidence.

## Cross-Authority Closure

`MUST`：本契约的每条规则均依赖下列 upstream authority；它们的 owner split
是不变 invariant：

- `P-AIPS-*` AIProfile selection policy。
- Nimi App registry / 申请 / cross-authority joins。
- permission fabric（account、data、agent identity、AI spend、
  memory / cognition access）。
- first-party app integration（Avatar，受 Avatar productization
  master gate 约束）。

`MUST NOT`：在 upstream authority 未 ready 前以"代为预判"的 default ready 状态投影任何
upstream authority。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
- `.nimi/spec/runtime/kernel/config-contract.md` — `K-CFG-*`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md`
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml`


---

<!-- source: .nimi/spec/platform/kernel/local-config-migration-contract.md -->

# Local Config Validation And Repair Contract

> Owner Domain: `P-MIG-*`

## Scope

定义 `~/.nimi` 用户本地配置文件族的 current-schema 读取、修复路由、
`schemaVersion` fail-closed 语义，以及 `nimi_data` data-root 目录所有权/修复边界。

本契约是 T10 portfolio 的 cross-cutting authority：它**不**重新拥有任何单个
`~/.nimi` schema 文件的字段定义。每个 schema 文件的字段权威仍归其 surface owner
authority family（`<runtime_owner_state_root>/nimi.json` → T1；
`~/.nimi/profiles/factory-index.json` / `~/.nimi/runtime/default.json` → T2）。
Runtime-owned local-app principal, record, permission-decision, session, inventory, and
package-seam state is service-owned protected state and is never a `~/.nimi`
interactive-user projection. 本契约只拥有：

- 跨文件统一的 `schemaVersion` fail-closed 规则；
- 跨文件统一的 current-schema validation framework（无自动旧 schema upgrade）；
- 跨文件统一的 repair 路由规则（unknown version / broken pointer →
  `repair_required` / `blocked`，never raw error、never silent recreate、
  never data orphaning）；
- `nimi_data` data-root 目录所有权与 destructive-cleanup confirmation floor。

Production Runtime configuration is service-principal-owned protected state,
not a `~/.nimi` user-local config file and not a member of this registry.
`K-CFG-014..016` govern only future transitions of already service-owned state;
they do not import `~/.nimi/runtime/config.json` as Runtime service state.
Desktop and this framework must not inspect, repair, migrate, recreate, or point
at that file. K-CFG-001 separately admits the non-release development updater
to read only its exact `dataRootRef` and promote it to an explicit signed
installer selection; that bounded read does not register the file here or admit
any other field.

不拥有：

- 任何单个 `~/.nimi` schema 文件的字段定义、默认值或 reload 语义；
- Runtime service-state transition or retired user-config import（the latter is forbidden）；
- `<runtime_owner_state_root>/nimi.json` 的 product-control 状态机（`P-COLD-009..016`）；
- Runtime model / dependency / environment materializer 对 `nimi_data` 子目录的
  写入与清理执行（`K-LENV-*`）。

## Governed Config File Family

本契约统辖的 `~/.nimi` 用户本地配置文件族（"sibling config files"）：

| File | Schema field owner authority | Notes |
|---|---|---|
| `<runtime_owner_state_root>/nimi.json` | T1 | product-control record；`P-COLD-009`；production root is installer-verified service state |
| `~/.nimi/runtime/default.json` | T2 | Runtime default seed |
| `~/.nimi/profiles/factory-index.json` | T2 | factory AIProfile index |

`MUST`：本族的成员清单与每个成员的 schema-owner authority 由本契约 canonical
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
该文件 owner authority 声明的当前 supported `schemaVersion`：

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

- **current-version gate**：只接受该文件 owner authority 声明的当前
  `schemaVersion`。
- **no write on read**：读取、解析、版本检查、结构校验失败不得改写文件、
  不得创建 `.bak`、不得写入默认字段。
- **owner structural validation**：字段级 schema、pointer 校验、repair/regenerate
  行为仍由单文件 owner 拥有；共享框架只负责 current-schema gate 与 typed repair
  outcome。

`MUST`：若产品上线后需要真实 schema bump，必须由对应 schema owner 先提交新的
authority 与 migration packet；在该 authority admitted 之前，旧版本一律
fail-closed-to-repair。

`MUST NOT`：本框架不得把 retired `~/.nimi/runtime/config.json` 注册为成员、
修复输入或 migration source。Runtime service-owned state is outside the
interactive-user file family and follows `K-CFG-014..016` only.

That prohibition governs this migration framework and production Runtime
configuration. It does not forbid the exact K-CFG-001 development-updater
`dataRootRef` read, which cannot register, repair, or import the file and cannot
consume any other field.

`MUST NOT`: the framework must not register, repair, recreate, dual-read, or
dual-write retired `~/.nimi/apps/{registry,packages}.json` or
`~/.nimi/accounts/<account-id>/{apps/inventory,permissions/grants}.json` files.
Local-app owner state is resolved from the separate Runtime K-APP/K-GRANT/
K-PLOCAL stores under the verified OS-user partition.

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

- 对 `<runtime_owner_state_root>/nimi.json`，修复状态使用 `P-COLD-009` 的 product-control
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
只能通过 Runtime 拥有的 management / job 路径变更；`apps/<local-app-principal-id>/data/`
是 Runtime-private principal partition，record remove/tombstone 后默认保留为
delete-only state，删除需显式用户动作；`accounts/<account-id>/` 大数据需显式
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

- `<runtime_owner_state_root>/nimi.json` 的 product-control 状态机仍归 `P-COLD-009..016`；本契约
  对该文件只提供 governed-family 成员资格与统一 fail-closed/repair-routing
  floor，不重定义其 `state` 集合。
- Runtime service-owned state transition remains under `K-CFG-014..016` and is
  outside this user-local registry. Retired `~/.nimi/runtime/config.json` is
  neither membership nor repair/migration input.
- `nimi_data` 子目录的 materialization 写入与 job 执行仍归 Runtime
  `K-LENV-*`；本契约只拥有目录 owner/cleanup 表与 data-root relocation admission
  floor，不提供 ordinary Desktop relocation 执行面。
- per-file schema 字段定义仍归各 owner authority family（T1 / T2）；本契约只拥有
  跨文件 current-schema validation framework 与 repair-routing 规则。

## Fact Sources

- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-009..P-COLD-016`
- `.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`
- `.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml`
- `.nimi/spec/runtime/kernel/config-contract.md` — `K-CFG-014`, `K-CFG-015`, `K-CFG-016`, `K-CFG-018`


---

<!-- source: .nimi/spec/platform/kernel/nimi-home-contract.md -->

# Nimi Home Contract

> Owner Domain: `P-HOME-*`

## Scope

定义 `Nimi Home` — Platform 拥有的产品入口/壳层 authority surface。
本契约只定义产品 ontology 与非 owner 边界，shell IA 与实现细节由
`.nimi/spec/canonical/desktop/shell-ui.authority.yaml`（`rule.nimi.desktop.shell-ui.r049..r061`）拥有。

不创建 `.nimi/spec/home/**` 平级 kernel。

## P-HOME-001 — Authority Boundary

`Nimi Home` 是 Platform 拥有的产品入口/壳层 authority surface。
当前由 desktop host 渲染。

`MUST`:

- 本 authority 只表达产品入口/壳层 ontology、placement、与跨域 projection
  许可。
- shell IA 与实现细节由 Desktop kernel `D-HOME-*` 拥有。
- Web 入口 boundary 仍由 `web-release-contract.md`（`P-WEB-*`）拥有；Web
  surface 不被本契约升格为 product entry shell 平级 owner，除非未来明确
  admit。

`MUST NOT`:

- 不得创建 `.nimi/spec/home/**` 平级 kernel。
- 不得让 `Nimi Home` 名称作为 schema、registry、table 列名、IPC 命令名、
  或文件路径段被复用为第二种 authority 名义。

## P-HOME-002 — Hosted Shell Binding

`Nimi Home` 通过 Desktop-hosted shell 渲染：

- Desktop kernel 拥有 hosted shell 实现 contract。
- Platform 拥有产品入口 ontology 与 placement。
- Desktop hosted shell 必须按 `D-HOME-*` 实现，不得自行重写 `Nimi Home`
  ontology。

## P-HOME-003 — Non-Owner Rules

`MUST NOT`：`Nimi Home` 不得拥有以下任一 truth：

- installer / downloader / materializer 执行 ownership
- selected source record（K-LENV-MAT-*, K-LENV-ACT-*）
- Runtime model catalog / host capability profile / local compute pack
  authority（K-LENG-024..K-LENG-028）
- Realm 账户 / 云端 / world / economy / social authority
- Cognition 语义 memory / knowledge artifact authority
- Avatar `.nimi/spec/avatar/**` kernel authority
- 共享 Nimi Content Pack 渠道
- agent identity 跨 app 平级 owner（参见 `agent-identity-floor-contract.md`）

## P-HOME-004 — Surface Registry Requirement

`MUST`：`Nimi Home` 的 surface placement 由 Desktop canonical shell UI authority
拥有，并由 `config/desktop-shell-ui-home-surfaces.yaml` 非权威投影为以下入口：

- `first-run`
- `apps`
- `agent-chat`
- `runtime-health`
- `app-health`
- `account`
- `settings`
- `diagnostics`
- `developer-mode`
- `failure-projection`

每个 surface 行必须显式列出其 source authority 与 forbidden ownership；不允许
出现"集中式 generic surface"既消费多 authority 又不声明边界。

## P-HOME-005 — AIProfile Selection Consumption

`MUST`：`Nimi Home` 必须通过
`aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）消费
Platform-owned AIProfile selection policy（`P-AIPS-001..P-AIPS-013`）输出的
factory AIProfile reference。

UI / first-run / shell / first-party app AIProfile 绑定代码均不得内嵌
provider / connector / engine / model 字符串常量。

mechanical guard：no-provider/no-model gate（见 `P-AIPS-008`）。

## P-HOME-006 — Agent Chat Placement Boundary

`MUST`：Agent Chat 在 `Nimi Home` 内是 in-shell reference surface only。
本契约固定其作为 placement，但不收编 transcript / history / identity /
grant / memory / `ConversationAnchor` 的 ownership。

`MUST NOT`:

- Agent Chat 不得拥有 chat-derived memory truth 或跨 app agent identity
  truth。
- 完整 identity / grant / memory semantics 由 permission fabric、
  `app-memory-access-contract.md`、`runtime-agent-service-contract.md`、与
  `agent-identity-floor-contract.md` 接管。

## P-HOME-007 — Mandatory AIScopeRef

`MUST`：所有 Agent Chat 执行 path（以及 `Nimi Home` 内任何调用
`Runtime` AI execution 的 path）必须显式携带 `AIScopeRef`（`P-AISC-001`）。

mechanical guard：`check:home-shell-aiscoperef-required`。

## P-HOME-008 — No Private Path

`MUST NOT`：`Nimi Home` 任何代码层不得 import：

- `runtime/internal/**`
- Realm private client / private transport
- SDK private internals

mechanical guard：`check:home-shell-no-runtime-internal-import`。

## P-HOME-009 — Apps Non-Owner Rule

`MUST`：`Apps` surface 消费 Nimi App registry / package projection、SDK Nimi
App client projection、与 Runtime registration / enforcement projection。
`Library` 与 `Discovery` 只能作为 lower-level projection 或历史实现名，不得
定义最终 ordinary primary navigation label。

`MUST NOT`:

- 不得拥有 admission truth、marketplace truth、economy truth、package
  trust truth、或第二份 app discovery 平面。
- 不得从 app-local spec、workspace source tree、或未 admitted registry row
  推导 ordinary Apps 可见性。
- 不得在 ordinary Apps 中显示 Avatar；隐藏 Avatar 也不得把 package /
  install / update truth 移入 Agent Chat。
- 不得引入“Home tab as Home”命名递归。

## P-HOME-010 — First Screen Rule

`MUST`：`Nimi Home` 的首屏必须是可用 product control。

`MUST NOT`：首屏不得是 marketing copy、landing page、或第三方 placeholder。
首屏可以 fail-closed 展示 cold-start authority 状态（`P-COLD-001`），但
必须直接给到用户可操作的产品控制面（settings、setup、account、Runtime
health、Apps 等）。

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-001..P-ARCH-021`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/canonical/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r049..r061`
- `config/desktop-shell-ui-home-surfaces.yaml` — non-authoritative machine projection
- `.nimi/spec/sdks/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdks/kernel/local-environment-projection-contract.md` — `S-RUNTIME-119`


---

<!-- source: .nimi/spec/platform/kernel/nimi-self-update-contract.md -->

# Nimi Self-Update Contract

> Owner Domain: `P-SUPD-*`

## Scope

定义 `Nimi` 产品的 self-update authority。本契约拥有 release channel
identity、trust posture、compatibility gates、rollback policy，并锁定与
`Nimi Home` 用户面、Runtime daemon handoff、App registry 与 Runtime local
environment 之间的非 owner 边界。

## P-SUPD-001 — Self-Update Policy Owner

`MUST`：Platform 拥有产品 self-update policy、release channel identity、
trust posture、compatibility gates、与 rollback policy。

`MUST NOT`:

- 不得让 Desktop host、Nimi Home shell、SDK consumer、或 first-party
  Nimi App 自创 release channel 或 rollback policy。
- 不得让 Runtime materializer 通过 self-update 通道安装/更新模型或本地
  依赖。

## P-SUPD-002 — Home User Surface Owner

`MUST`：`Nimi Home` 拥有 user-facing self-update discovery、consent、
progress、restart UI、rollback UI、与 diagnostics projection。

`MUST NOT`：Nimi Home 不得自创 channel identity、自定义 pubkey/endpoint
policy、或绕过本契约的 fail-closed semantics（`P-SUPD-006`）。

## P-SUPD-003 — Runtime Handoff Owner

`MUST`：Runtime 拥有 daemon lifecycle handoff、stop/start/restart status、
与更新后真实本地 health。

`MUST NOT`：Runtime 不得在 self-update 路径中替代 selected source record
更新或 model catalog 更新（这些归 `P-SUPD-005`）。

## P-SUPD-004 — App Registry Update Boundary

`MUST`：Nimi App registry 拥有 app package 更新事实。Nimi
self-update 不得替代 app package 更新；app package 更新也不得替代 Nimi
self-update。

## P-SUPD-005 — Selected Source Record Non-Mutation Rule

`MUST NOT`：Nimi self-update 路径不得 mutate Runtime-owned selected source
record、`local-environment-dependencies.yaml` 状态、或
`K-LENV-MAT-*` / `K-LENV-ACT-*` 管理的 model / dependency truth。

Runtime local environment materializers 仍按 `K-LENG-024..K-LENG-028` 独立
负责 model / dependency 的下载、verification、selected source record
promotion。

## P-SUPD-006 — Fail-Closed Self-Update

`MUST`：缺少 release evidence、verification 失败、signature mismatch、
rollback 必须、daemon handoff 不可达、或 compatibility gate 不通过时，
Nimi Home 必须显式投影对应 fail-closed 状态（`failed`、
`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection` 等）。

`MUST NOT`：不得静默升级、不得隐式跳过 verification、不得以"latest"为
ready 投影。

## P-SUPD-007 — Existing Desktop Self-Update Supersession

`MUST`：`.nimi/spec/canonical/desktop/shell-runtime.authority.yaml` 的 self-update plane 继续保留
为 desktop-host 实现细节（atomic Desktop release unit、与 independently
installed Runtime service 的 signed release compatibility、updater
pubkey/endpoint 实现等）。它在本 Platform policy 之下作为 desktop-hosted
实现层级；rename 产品文案为 `Nimi` 时按
`naming-and-kernel-ontology.md` 与 desktop kernel supersession 规则执行。

`MUST NOT`：不得把 Desktop 自更新合同当成 Platform 产品 self-update
policy 平级 owner；Desktop bundle、Tauri/Electron host、renderer 或 Kit
不得携带、stage、执行、选择或探测 production Runtime binary。Runtime 的
install/update/rollback/activation 只能由 signed service installer/updater 与
OS service manager 持有。

## P-SUPD-008 — Web Self-Update Boundary

`MUST NOT`：本契约不 admit web self-update 路径。如需要 web 自更新形态，
必须由未来一次显式 `web-release-contract.md` cut admit。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/canonical/desktop/shell-runtime.authority.yaml` — desktop-host self-update implementation
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md`
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`


---

<!-- source: .nimi/spec/platform/kernel/nimi-package-release-contract.md -->

# Nimi Package Release Contract

> Owner Domain: `P-PKGREL-*`

## Scope

定义 `Nimi` 可安装产品的 package / release / update identity。本契约固定
installable product name、bundle identity、release channel identity、updater
endpoint / pubkey policy、install-gateway handoff scope、failure projection
要求，以及 Nimi self-update、app updates、Runtime local dependency updates
之间的关系。

## P-PKGREL-001 — Installable Product Name

`MUST`：`Nimi` 是 user-facing installable product 的唯一名称。

`MUST NOT`:

- 不得在 user-facing UI、安装包元数据、release manifest、updater channel
  identity、registry schema、或 IPC 命令名中出现 `Desktop` 作为 product
  identity。
- 不得引入 `Launcher` 作为 user-facing product identity；`launcher` 只允许作为
  internal capability category term，不得进入安装包、release、updater、registry、
  IPC、或 user-facing product identity surface。

## P-PKGREL-002 — Atomic Bundle Identity

`MUST`：每个 Nimi 安装/更新 bundle 是单一原子 release unit，至少包含：

- Desktop-host shell binary
- 内嵌 Runtime daemon binary（与 Desktop-host 版本严格绑定）
- 已 admit 的 release metadata（含版本、release channel、signature、
  rollback metadata）

`MUST NOT`：不得通过 hot-patch、partial-replace、out-of-band 替换 Runtime
binary 形成与 Desktop-host 不同步的 release unit。

## P-PKGREL-003 — Release Channel Identity

`MUST`：release channel identity 由本契约配合 `release-gate-registry.yaml`
admit；已 admit channel 固定为 `stable` 与 `beta`。其他 channel 不属于当前
release identity surface。

`MUST NOT`：UI / SDK / app 不得自创 channel 字符串作为产品事实源。

## P-PKGREL-004 — Updater Endpoint And Pubkey Policy

`MUST`：updater endpoint 与 pubkey policy 是 Platform-owned configuration。
pubkey rotation 必须经过本契约显式 admit（含 rotation 信号、grace window、
旧 pubkey 失效条件）。

`MUST NOT`：Desktop builder、Runtime、SDK、app 不得绕过本契约动态注入 / 切
换 updater endpoint 或 pubkey。

## P-PKGREL-005 — Install Gateway Handoff Scope

`MUST`：web install gateway（`P-WEB-*`）admit Nimi 安装包下载、签名 /
pubkey 验证、handoff 给 desktop-host installer 的 scope。

`MUST NOT`：install gateway 不得：

- 执行 Runtime local environment materialization
- 安装 / 更新模型或本地依赖
- 持久化 Runtime selected source record
- mutate user PATH / machine PATH / shell profile / 系统 Python / system
  CUDA / package-manager global state

## P-PKGREL-006 — Failure Projection Requirement

`MUST`：每个 release / update 失败 path 必须暴露显式 Nimi Home projection
（`failed`、`rollback-required`、`verification-failed`、`unsupported`、
`stale-projection` 等）。

`MUST NOT`：不得通过"latest version unavailable"等 generic 字段隐藏失败
原因；fail-closed 状态必须能追溯到具体 reason class。

## P-PKGREL-007 — Three Update Surfaces Are Distinct

`MUST`：Nimi self-update、app updates（Nimi App registry）、与
Runtime local dependency updates（`K-LENG-024..K-LENG-028`、
`K-LENV-MAT-*`、`K-LENV-ACT-*`）是三个独立 authority surface。

`MUST NOT`：任一 surface 不得静默 mutate 另外两个 surface 的 source of
truth。

## P-PKGREL-008 — No Unrecorded Packaging Identity Split

`MUST`：packaging / release / update identity 是同一 authority family；不切出
未记录的 subordinate owner。如未来需要扩展 web 自更新或 web-only install
identity，必须由显式 `web-release-contract.md` cut 处理。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/platform/kernel/tables/release-gate-registry.yaml`
- `.nimi/spec/canonical/desktop/shell-runtime.authority.yaml` — desktop-host self-update implementation
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`


---

<!-- source: .nimi/spec/platform/kernel/web-release-contract.md -->

# Web Release Contract

> Owner Domain: `P-WEB-*`

## P-WEB-001 — Web Surface Ownership

`apps/web/**` is the first-party web surface for the Nimi site, static legal pages, Cloudflare function adapters, and web-shell mode adapters. It is platform-owned release/web evidence, not an app-local subordinate spec slice unless a later `.nimi/spec` admission explicitly changes that ownership.

The Nimi Ecosystem Simulator is the independent `apps/simulator/**` product
owned by `P-SIM-*`. `apps/web` may expose a typed navigation link to its
deployment route, but it must not become the Simulator Shell, selected-module
registry, State Engine, source materializer, build owner, or evidence owner.

## P-WEB-002 — Desktop Public Boundary

Web shell mode may consume desktop public-for-web surfaces and web-specific adapter replacements, but it must not import Tauri APIs, desktop-private renderer aliases, runtime internals, or local filesystem behaviors. Unsupported desktop-only release/self-update surfaces must fail closed rather than returning pseudo-success values.

Web shell bootstrap is client-only: no SSR and no service worker cache are part of the product contract. `realmBaseUrl` resolves to the browser same-origin deployment unless an admitted web release adapter supplies a different origin. Browser OAuth redirect replaces Tauri deep links, and raw bearer tokens remain memory-only while persistent browser storage carries non-sensitive session metadata.

Web fetch adaptation may reuse the public proxy-fetch shape, but in `hasTauriInvoke() = false` mode it resolves to native browser `fetch`; it does not inherit Desktop CORS bypass or private IPC behavior.

Simulator is not a third Desktop shell mode. Web code must not add `simulator`
to the `desktop | web` shell-mode enum, import selected Simulator App source,
or cause the Web artifact and Simulator artifact to share one module graph.

## P-WEB-003 — Install Gateway Ownership

`apps/install-gateway/**` is the platform release distribution gateway for install scripts, platform manifests, updater metadata, and release-feed projection. Release data must come from the admitted GitHub release source, checksum validation must remain explicit for platform archives, and generated distribution copies must not become source truth.

## P-WEB-004 — Cloudflare Boundary

Cloudflare Workers/Pages functions under the web and install gateway surfaces are deployment adapters. They may proxy or project admitted runtime/release data, but they must not invent runtime, SDK, realm, desktop, or release truth outside their admitted source contracts.

Simulator deployment may use its own Cloudflare static-site configuration and
origin. It does not require co-location with an API server, and no Simulator
module may rely on a Cloudflare function as a hidden real-capability backend.
Cross-origin navigation between Web and Simulator does not merge their builds,
credentials, CSPs, environment schemas, or release evidence.

## P-WEB-005 — Evidence Root Admission

Audit evidence roots for `apps/web/**`, `apps/install-gateway/**`, and other platform web/release support surfaces must be admitted through `.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml`. Audit tooling must not infer these roots from broad `apps/**` ownership or from package names alone.

`apps/simulator/**` evidence is admitted under its own Simulator authority row.
It cannot be inferred as Web evidence merely because both artifacts are
browser-deployed or use Cloudflare.


---

<!-- source: .nimi/spec/platform/kernel/nimi-first-party-integration-contract.md -->

# Nimi First-Party Integration Contract

> Owner Domain: `P-FPI-*`

## Scope

定义 first-party Nimi App hardcut target（Avatar）通过 Platform
Nimi App registry / SDK Nimi App client / SDK Nimi permission client 与
Runtime 集成的产品级 authority。本契约不实现 app 代码、Tauri packaging、
Runtime 集成本身；它锁定 first-party 集成的 contract 关系与"hard cut 之后
无 standalone ordinary-user product truth"的边界。

## P-FPI-001 — First-Party Hardcut Targets

`MUST`：first-party hardcut target 仅限当前 admitted
`tables/nimi-app-registry.yaml` row 集合（现为 Avatar，`nimi.avatar`）。

`MUST NOT`：不得在 first-party hardcut closeout 中使用 deferred first-party app
作为 evidence；只能使用当前 admitted registry rows 或明确准入的 app slice。

## P-FPI-002 — Single Registry Source

`MUST`：first-party app 集成消费 `tables/nimi-app-registry.yaml` 的对应
row，且 install / launch / update
/ uninstall / health / repair 必须通过 SDK Nimi App client surface
（`S-APP-001..S-APP-008`）。

`MUST NOT`：不得引入与 registry 并列的第二份 install / launch
truth；不得让 Desktop hosted shell 或 first-party app 自行实现安装逻辑。

## P-FPI-003 — AIProfile Selection Hint Consumption

`MUST`：first-party 集成应用 `ai_profile_selection_ref` 通过
`aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）进入 scope-bound
`AIConfig`（`D-AIPC-005`）。

`MUST NOT`：first-party app factory AIProfile 绑定代码不得内嵌
provider / connector / engine / model 字符串常量（`P-AIPS-008`、
`P-HOME-005`）。

## P-FPI-004 — First-Party Authority Classification

`MUST`：first-party app 与第三方 app 使用同一 `P-PERM-015` 分类。Registry
`permission_requirements` 只声明真正面向用户的已准入 public permission；
当前 first-party rows 均为空列表。Built-in product/service operation 必须由
其 Platform/Runtime/Realm/Cognition product contract 精确准入，app-private
storage 与 app-owned commands 分别走 base entitlement 与 app-owned authority。

`MUST NOT`：first-party publisher/review status 不得生成 seed grant、扩大
第三方 permission、把 account/session/metering/profile/storage 伪装成 grant，
或经 ad-hoc IPC 代理 protected Nimi operation。

## P-FPI-005 — Runtime Registration Consumer Relationship

`MUST`：app 启动通过 `app.launch(appId, scopeRef)`（`S-APP-003`）触发
Runtime registration；registration mode 必须匹配 registry row 中的
`runtime_registration_mode`（当前 admitted 值集合：`app-managed`）。

`MUST NOT`：app 不得绕过 SDK Nimi App client 直接调用 Runtime registration
私有 RPC；不得在 launch path 中自行 sandbox / supervise 进程。

## P-FPI-006 — Avatar Master Gate Clearance

`MUST`：Avatar first-party integration now treats the Avatar productization
master gate as cleared for the default `nimi.avatar` app. The canonical
`tables/nimi-app-registry.yaml` Avatar row must remain `admission_status:
admitted` while ordinary Apps exposure stays controlled by
`ordinary_visibility: hidden-internal`.

`MUST`：Avatar launch must register the `nimi.avatar` local first-party Runtime
app instance before reading Runtime account session status. Account, agent,
permission, and storage checks must continue to fail closed through Runtime and
Platform registry truth.

`MUST NOT`：不得恢复 standalone ordinary-user launch truth、parallel admission
truth，或通过 app-local session shim 绕过 Runtime `RegisterApp`。

## P-FPI-007 — No Standalone Ordinary-User Truth After Hard Cut

`MUST`：hard cut 之后，Avatar 在 ordinary-user product truth 层不得
保留 standalone install / launch / update 路径；只允许 Nimi App registry
行作为 ordinary-user product truth。

`MUST NOT`：不得保留 standalone Avatar 安装包作为 ordinary-user product
channel。Avatar remains hidden from ordinary Apps while package/update
coordination stays registry/package-owned.

source-development workflows 可继续以 standalone 方式启动，但必须遵守
`P-FPM-004` 的 source-development marker rule。

## P-FPI-008 — Avatar Kernel Authority Retention

`MUST`：Avatar kernel authority 保持在 `.nimi/spec/avatar/**`。first-party
integration 仅添加 Nimi App registry / SDK integration / migration
contract，而不把
Avatar kernel 迁移到 app-local subordinate spec 路径下或降级为 app-local
spec admission。

`MUST NOT`：不得把 Avatar 视为 app-slice admission 真相
（`P-APP-*` 与 `P-NAPP-*` 是 orthogonal authority，参见
`P-NAPP-010`）。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015; P-NAPP-018..P-NAPP-029`
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-first-party-migration-contract.md` — `P-FPM-001..P-FPM-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/canonical/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r049..r061`
- `.nimi/spec/avatar` (kernel authority retained)


---

<!-- source: .nimi/spec/platform/kernel/nimi-first-party-migration-contract.md -->

# Nimi First-Party Migration Contract

> Owner Domain: `P-FPM-*`

## Scope

定义 first-party Nimi App hardcut target（Avatar）从 standalone
install path 迁移到 Nimi App registry 行的 product 级 migration authority。
本契约固化 `design.md` "First-Party Migration Policy" 决议，并锁定
migration failure fail-closed 状态机、source-development marker rule 与
no-silent-user-state-reset rule。

## P-FPM-001 — Required Migration Questions

`MUST`：first-party hardcut implementation 必须为每个 hardcut target 显式回答以下
问题，并把答案落到对应 app 的 migration plan：

1. 当前存在哪些 standalone Avatar 用户状态？
2. 哪些状态是 app-private、迁移后仍留在 app 内？
3. 哪些状态必须升级为 Nimi account / data / permission truth？
4. 哪些本地文件或设置变为 Nimi Home-managed install state？
5. 迁移失败时如何处理？
6. source-development 阶段可否同时存在 standalone 与 Nimi-managed 两份
   变体？

`MUST NOT`：在缺少完整答案前实施 hard cut；不得在 migration plan 留
未解析占位文本。

## P-FPM-002 — Migration Failure Fail-Closed State Machine

`MUST`：迁移路径 typed state set：

- `migration-pending`
- `migration-in-progress`
- `migration-failed`
- `migration-blocked`
- `migration-recoverable`
- `migration-completed`

UI / SDK / app 必须显式区分这些状态；Nimi Home 投影必须按
`P-COLD-001` 与 `P-NAPP-008` fail-closed 状态机一致。

`MUST NOT`：不得用单一 `unavailable` 文案折叠多个 migration failure
原因；不得静默成功。

## P-FPM-003 — No Silent User State Reset

`MUST`：migration 失败必须保留 explicit recoverable state；用户的
existing standalone state 不得被静默 reset、清空、或绕过 audit 重写。

`MUST NOT`：失败时不得：

- silently 生成全新 app identity
- 直接当成 empty success
- 留下 orphan user state 没有任何 reconcile 路径

## P-FPM-004 — Source-Development Marker Rule

`MUST`：source-development workflows 可继续 standalone 启动，但仅在显
式 developer execution marker（如 `NIMI_DEV_MODE=true`、CLI
`--dev` flag、明确的 IDE-task launch profile）之下进行。

`MUST NOT`：source-dev 路径不得：

- 出现在 ordinary-user 安装包
- 出现在 release channel 默认值
- 借 staging release channel 隐式升格成 ordinary-user product truth

## P-FPM-005 — Zero Dual-Track Period After Hard Cut

`MUST`：每个 hardcut target 的迁移计划必须显式声明 cutover window：

- cutover 起止时间 / 触发条件
- 在 cutover 后 ordinary-user product truth 中只允许 Nimi-managed
  variant
- 任何 standalone variant 必须在 cutover 后立即停止作为 ordinary-user
  product 入口

`MUST NOT`：cutover 之后不得保留 standalone / Nimi-managed 双轨 ordinary-
user product truth。

## P-FPM-006 — Per-App Implementation Plan Requirement

`MUST`：first-party hardcut implementation 必须为每个 first-party hardcut target
产生：

- `P-FPM-001` 的完整问题答案
- `P-FPM-005` 的 cutover window 声明
- `P-FPM-002` 状态机在 UI / SDK / app 层的映射
- audit / rollback / re-run 的具体步骤

`MUST NOT`：不得用通用 boilerplate plan 替代 per-app plan；不得跨 app
共用一个 cutover window。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-first-party-integration-contract.md` — `P-FPI-001..P-FPI-008`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015; P-NAPP-018..P-NAPP-029`
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/canonical/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r049..r061`


---

