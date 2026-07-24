# AIProfile Selection Policy Contract

> Owner Domain: `P-AIPS-*`

## Scope

定义 Platform 拥有的 `factory AIProfile catalog` 与 `AIProfile selection policy`
权威：Platform 负责为 Nimi 平台准备一组可被 first-run、scope-bound apply、以及
admitted first-party Nimi App 选用的 portable `AIProfile` 模板，并定义在何种
host posture / user posture 下 deterministically 选择哪一行 `AIProfile`。

本契约**不**重新解释 `D-AIPC-001..D-AIPC-012` 描述的 `AIProfile` /
`AIConfig` / `AISnapshot` 三段式 consumption model；也**不**把 Runtime 提升为
产品 profile 选择器。Scope / app owner 拥有 `AIConfig` intent；Runtime 承担
host capability、local compute pack、dependency plan、materialization job、
activation gate、route feasibility 与 execution evidence owner 角色
（`K-AIEXEC-001..K-AIEXEC-005`、`K-DEV-001..K-DEV-009`、`K-LENV-*`、
`K-LENG-024..K-LENG-028`、`K-LOCAL-013..K-LOCAL-015`）。本契约严格禁止建立
`AIProfile` / `AIConfig` / `AISnapshot` 之外的第四份 AI live config truth，
任何 renamed subordinate helper 都不得隐式重新成为产品 default owner。

## P-AIPS-001 — Authority Boundary

`factory AIProfile catalog` 是 Platform 拥有的、随 Nimi 平台一起发行的一组
portable `AIProfile`（`D-AIPC-002`、`D-AIPC-007`）模板。`AIProfile selection
policy` 是 Platform 拥有的 deterministic 策略：给定 Runtime 提供的 host
evidence 与 user posture inputs，从 catalog 中选择一行 factory `AIProfile`，
并返回 typed `AIProfile` reference + typed reason。

`MUST`:

- 选中行通过 `aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）进入
  `D-AIPC-005` 的原子覆盖路径，写入 scope-bound `AIConfig`。Live config
  intent 由该 `scopeRef` 的 scope / app owner 拥有；Runtime owns
  materialization、readiness、route feasibility 与 execution evidence slices；
  SDK owns typed projection。
- selection policy 的输入来自 Runtime evidence（`K-DEV-001..K-DEV-009`、
  `K-LENV-ACT-*`、`K-LENG-024`）与显式 user posture；输出仅是 typed
  `AIProfile` reference + reason。
- factory `AIProfile` row 的 portable fields 必须符合 `D-AIPC-002` 与
  `D-AIPC-007` 的可移植语义；non-portable 字段（local file path、install state、
  health 等）不得出现在 catalog row。
- selection policy 与 catalog 都仅表达"推荐选用哪种 AI 体验"的产品语义；
  执行权、安装权、materialization 与 readiness 全部归 Runtime，scope intent
  commit 通过 SDK projection 回到对应 scope / app owner。

`MUST NOT`:

- 不得在本契约或其 table 中拥有或持久化 live `AIConfig` truth、`AISnapshot`、
  install state、materialization job state、selected source record、host
  capability profile、local compute pack schema、local environment dependency
  schema、activation gate reason codes。
- 不得在 `AIProfile` / `AIConfig` / `AISnapshot` 之外新增第四种 AI live
  config 形态，包括但不限于 `home-experience-profile`、
  `first-run-profile-catalog`、`nimi-default-profile-catalog` 等 renamed
  subordinate helper。
- 不得让 Runtime 拥有 selection policy 的语义。Runtime 在 selection policy
  执行过程中只提供 evidence 输入。

## P-AIPS-002 — Factory AIProfile Catalog

每一行 factory `AIProfile` 是按下列四维矩阵 keyed 的 catalog row：

```
privacy_posture x compute_posture x capability_set x routing_policy
```

四维定义：

| 维度 | 封闭枚举 | Owner |
|---|---|---|
| `privacy_posture` | `cloud-ok` \| `local-preferred` \| `local-required` | Platform `P-AIPS-*` |
| `compute_posture` | `cpu-only` \| `metal-capable` \| `cuda-capable` \| `cloud-only` | Platform `P-AIPS-*`；约束 selection policy 的 host 选择面，host capability detection 仍由 Runtime `K-LENG-024` 拥有 |
| `capability_set` | `CanonicalCapabilityId` 列表 | Platform `P-AIPS-*` 引用；元素 owner 是 `P-CAPCAT-*` |
| `routing_policy` | `cloud-first` \| `local-first` \| `hybrid-explicit` | Platform `P-AIPS-*` |

可读名（例如 `cloud-first`、`local-standard`、`local-speech-ready`、
`local-gpu`、`hybrid-recommended`）是矩阵的 readable projection：

- `MUST` 在 `tables/ai-profile-factory-catalog.yaml` 中以 `alias` 字段表示。
- `MUST NOT` 成为 schema owner。
- `MUST NOT` 与具体 provider / connector / engine / model 字符串绑定。

每行 factory `AIProfile` 必须区分两组字段：

- **AIProfile portable fields**（按 `D-AIPC-002`、`D-AIPC-007` 可移植语义）：
  capability route intent / binding intent、generation params、companion
  model intent、policy / style metadata、profile-level UX metadata
  （`title`/`description`/`tags`）。本表为最小可识别的占位字段
  （`alias`、`capability_set`、`routing_policy`、`applicable_scopes`、
  `first_run_install_levels`、`source_rule`），不在本表内重复维护完整
  portable payload；真实 portable payload 由 generated
  catalog snapshot 与 Desktop AIProfile schema 校验共同保证。
- **Selection policy inputs**（仅供 Platform-owned selection policy 消费）：
  `privacy_posture`、`compute_posture`、`host_capability_profile_refs`、
  `local_compute_pack_refs`、`dependency_family_refs`、
  `materialization_confirmation_required`。这些字段表达"在何种 host /
  posture 下推荐选择该 AIProfile"，**不**是 `AIProfile` 本体的 portable
  payload，也**不**是 live `AIConfig` 的字段。selection policy 在评估时
  仅以这些字段为输入；它们不会被 `aiProfile.apply` 写入 `AIConfig`。

## P-AIPS-003 — Apply Chain

factory `AIProfile` 的 apply 链固定为：

```
selection policy (P-AIPS-004) over Runtime evidence + user posture
  -> typed factory AIProfile reference (alias / profileId)
  -> descriptor formation + Runtime prepare/readiness (S-AICONF-004, K-AIEXEC-008..009)
  -> aiProfile.apply(scopeRef, profileId)              (S-AICONF-001)
  -> atomic overwrite scope-bound AIConfig             (D-AIPC-005)
  -> execution freezes per-turn AISnapshot             (D-AIPC-004)
  -> Runtime execution consumes materialization evidence (K-LENV-MAT-*, K-LENV-ACT-*)
```

`MUST`:

- 写入的 `AIConfig` 必须是 full materialized config（`D-AIPC-003`），不允许
  partial overlay、scope-fallback chain（`P-AISC-003`）、or placeholder disabled
  capability.
- alias 接受不立即代表 execution readiness：UI / SDK / app 必须分别消费
  Runtime descriptor prepare/readiness and activation gate（`K-AIEXEC-009`,
  `K-LENV-ACT-004` / `K-LENV-ACT-005`）才能投影 execution readiness or apply
  eligibility.
- required slice readiness/apply eligibility must be proven before live AIConfig
  write. If required slices are unresolved, unsupported, missing credentials,
  missing manual association, or environment/materializer readiness is unmet,
  the result is setup-required/no-live-config and any existing valid AIConfig is
  preserved.
- 用户在 scope 内对 `AIConfig` 的后续微调（`D-AIPC-011` `Local
  customization`）不反向污染 `AIProfile`，更不修改 factory catalog row。

`MUST NOT`:

- 不得让 apply 路径绕过 `AIProfile` / `AIConfig` / `AISnapshot` 链条。
- 不得在 `AIConfig` apply 失败时静默降级到 partial config 或猜测的 cloud /
  local fallback；失败必须按 `D-AIPC-005` apply probe / failure 规则与
  `S-AICONF-002` typed error 上报。
- 不得 apply-first：未满足 required readiness 的 alias acceptance、preview、
  probe, or prepare cannot write a syntactically valid but non-executable
  AIConfig.
- 不得在 first-run、profile apply、或 first-party app hint 路径上直接产生
  selected source record，或绕过 `K-LENV-ACT-001..K-LENV-ACT-010` 的
  activation request/response 形状。

## P-AIPS-004 — Selection Policy Inputs And Outputs

Platform-owned `AIProfile selection policy` 是 deterministic 函数：

```
selection_policy(runtime_evidence, user_posture) -> AIProfileReference + reason
```

`MUST`:

- `runtime_evidence` 仅消费 Runtime admitted surfaces：`CollectDeviceProfile`
  / host capability profile（`K-DEV-001..K-DEV-009`、
  host-capability-profiles.yaml）、local compute pack readiness
  （local-compute-packs.yaml + `K-LENV-ACT-*`）、dependency plan readiness
  （local-environment-dependencies.yaml）。
- `user_posture` 仅消费显式 user-declared posture（例如用户在 first-run
  中表达的 privacy/compute preference）；不得隐式从 desktop chat selection、
  active app state、或其它 ambient state 提取。
- `host_capability_profile_refs`、`local_compute_pack_refs`、
  `dependency_family_refs` 字段中的每个值必须解析到 `.nimi/spec/runtime/
  kernel/tables/host-capability-profiles.yaml` / `local-compute-packs.yaml` /
  `local-environment-dependencies.yaml` 中已 admit 的 row；无法解析视为
  admission failure。
- 输出必须是 typed `AIProfile` reference（catalog row alias / profileId）
  与 typed reason；不得返回字符串错误或 generic enum。
- selection policy 评估在 Home / Desktop / SDK 侧执行；Runtime 在评估过程中
  只提供 evidence，不参与决策。

`MUST NOT`:

- 不得在 Runtime 包中部署 selection policy 的实现；Runtime 包不得拥有"如何
  选择产品 default profile"的语义。
- 不得发明新的 host capability axis、accelerator plane、local compute pack、
  dependency family；任何扩展发生在对应 Runtime 表内并经过 spec
  consistency check。
- 不得复用 alias schema 表达 host detection 或 pack arbitration 决策；这些
  决策仍由 Runtime activation 与 plan resolver 拥有
  （`K-LENV-ACT-001..K-LENV-ACT-008`、`K-LENG-026..K-LENG-027`）。

## P-AIPS-005 — Capability Binding

factory `AIProfile` 仅通过 `CanonicalCapabilityId` 表达能力意图。

`MUST`:

- `capability_set` 字段中的每个元素必须是
  `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml` 中
  已 admit 的 `capabilityId`，遵循 `P-CAPCAT-*` 的 cross-layer identity
  authority。
- 当目标 capability 属于 deferred 子条目时，alias 必须在
  `applicable_scopes` 中明确排除尚未 admit 的 scope，或显式声明 fail-closed
  Runtime fallback；不得静默引用 deferred capability。

`MUST NOT`:

- 不得在 alias、table row、UI 代码、SDK 代码、app 代码、first-party app
  绑定代码、或本契约的 prose 中，使用 provider id、connector id、engine
  id、model id 等具体 vendor / model 字符串作为默认体验事实源。
- 不得通过组合多个 capability ref 间接重建一份内嵌 provider/model 偏好的
  hidden defaulting 表；任何 vendor 偏好必须落在 Runtime model catalog 与
  Realm/Runtime connector authority。

## P-AIPS-006 — Cloud / Local / Hybrid / Privacy Posture Rules

factory `AIProfile` 必须在 `privacy_posture` 与 `routing_policy` 之间形成
稳定语义；不得隐含 fallback 替代。

`MUST`:

- `privacy_posture=cloud-ok`：alias 允许将能力绑定到 admitted cloud
  connector（受 spend / permission 规则约束）。该 posture 不得隐式要求
  超过 Runtime core readiness 的 local materialization。
- `privacy_posture=local-preferred`：alias 在 host capability 与 selected
  source record 满足时优先选用 local 路径；当 local readiness 缺失时，
  必须按 `K-LENV-ACT-005` 投影 `setup_required` / `repair_required` /
  `failed` / `unsupported` / `cancelled` / `setup_in_progress`。只有当
  alias 在该 capability slice 上显式声明 admitted hybrid binding（即
  同时绑定 local 与 cloud），才允许在 local 缺失时按
  `routing_policy=hybrid-explicit` 退化到 cloud 路径。
- `privacy_posture=local-required`：alias 禁止 cloud 路径承担其声明的
  capability slice；local readiness 缺失必须投影为 fail-closed
  `setup_required` / `repair_required` / `unsupported`，不得静默 fallback
  到 cloud。
- `routing_policy=cloud-first | local-first | hybrid-explicit` 是 typed
  authoritative 路由声明；运行时 routing decision 与 spend 计量必须按此
  evaluate。

`MUST NOT`:

- 不得在 UI / SDK / app / first-party app 代码中保留一份独立的 routing
  string 或 provider 偏好覆盖。
- 不得在缺少 hybrid binding 的情况下，把 local fail 隐式投影成 cloud
  success。
- 不得在 cloud-only alias 上请求 local environment dependency
  （`K-LENV-ACT-008`）。

## P-AIPS-007 — Materialization Projection State Machine

factory `AIProfile` alias 接受后，可通过 Runtime admitted command surface
请求 confirmation 与 materialization：

```
StartLocalEnvironmentDependencyJob       (K-LENG-027)
CancelLocalEnvironmentDependencyJob      (K-LENG-027)
RetryLocalEnvironmentDependencyJob       (K-LENG-027)
RepairLocalEnvironmentDependency         (K-LENG-027)
```

SDK 必须按 `S-RUNTIME-119` 投影 Runtime 状态，并保留 `K-LENV-ACT-005`
state mapping 的全部 non-ready 区分：

- `needs_confirmation`
- `queued`
- `downloading`
- `verifying`
- `installing`
- `repair_required`
- `failed`
- `unsupported`
- `cancelled`

`MUST`:

- Product-facing 文案可以重命名（例如 "正在下载模型…"），但必须保留状态
  区分；任何 `ready` 投影必须由 `K-LENV-ACT-004` 的 `ready_system` /
  `ready_managed` activation gate 答复支撑。
- partial materialization、unconfirmed source、failed job、repair-required
  dependency、unsupported host 都必须按 fail-closed 投影；任何 alias 的
  `ai-profile-active` 投影必须由完整 activation gate ready evidence 支撑。
- Runtime confirmation payload 必须显式声明 dependency family、known size、
  storage category，以及 no-system-mutation policy（`K-LENG-027`）。

`MUST NOT`:

- 不得从 file existence、endpoint reachability、transfer completion、
  package directory presence、PATH precedence、import success、import
  directory contents、script exit、process liveness、warmup success、或
  previous health success 推断 `ready`（`K-LENV-ACT-009`）。
- 不得把上述 non-ready 状态压缩为单一 `unavailable` 文案。
- 不得通过 probe（`aiConfig.probe(scopeRef)` / `aiConfig.probeFeasibility(
  scopeRef)`）替代 activation gate 投影；probe 是诊断面，不是 readiness
  authority。

## P-AIPS-008 — No Provider / Model Constants Guard

factory `AIProfile` 必须保持 provider/model agnostic。

`MUST`:

- 本契约、`tables/ai-profile-factory-catalog.yaml`、Nimi Home shell 代码、
  first-run 路径代码、SDK AIProfile/AIConfig 表面、first-party Nimi App
  AIProfile 绑定代码都不得内嵌 provider id、connector id、engine id、
  model id 等字符串常量作为默认体验事实源。
- 该 guard 由 mechanical script gate 注册并执行；必须保持无兼容别名的
  no-provider/no-model 结构化 gate，扫描所有 AIProfile
  consumer 路径，并附加 fourth-AI-truth 负面测试，禁止任何
  renamed 第四份 default owner surface 出现在 active spec / code 中。

`MUST NOT`:

- 不得通过文档常量、UI string table、generated catalog snapshot、placeholder
  fallback、bootstrap seed 等迂回路径，把具体 vendor / model 默认硬编码进
  factory `AIProfile` 表面。

## P-AIPS-009 — First-Party App AIProfile Hint Rule

Admitted first-party Nimi App（例如 Avatar）必须通过 typed
`AIProfile` reference 声明其默认体验 hint。

`MUST`:

- App registry row 或 app manifest 中的 AIProfile hint 必须引用本表中已 admit
  的 alias / profileId（typed reference，不是字符串 alias hint）。
- 用户安装该 app 并被其请求默认体验时，alias 通过 `S-AICONF-001`
  `aiProfile.apply(scopeRef, profileId)` 进入该 app 的 scope-bound
  `AIConfig`。
- hint 仅声明推荐体验；它不创建任何账户、数据、agent 身份、AI 消费、
  memory/cognition 访问授权。所有授权仍由 permission fabric 与 Nimi App
  registry 拥有。
- 用户在 app scope 内对 `AIConfig` 的进一步微调按 `D-AIPC-011` 处理。

`MUST NOT`:

- 不得通过 hint 绕过 permission fabric、registry admission、Runtime
  activation gate，或绕过本契约的 no-provider-model-constants 规则。
- 不得在 first-party app 内部维持一份与本表 alias 并行的默认体验 track；
  app 不得为同一 scope 同时投影两份不同 `AIConfig` truth。

## P-AIPS-010 — First-Run And Scope-Bound Apply State Machine

Nimi Home first-run 与任何 scope-bound apply 路径都必须以下列封闭状态
显式投影 alias 接受 + materialization 的产品语义，不得压缩为单一
`ready` / `unavailable`：

| 状态 | 含义 | 触发条件 |
|---|---|---|
| `ai-profile-pending` | 尚未接受任何 alias | first-run 进入；或之前的 alias 被显式撤销 |
| `ai-profile-accepted` | alias 已接受，但 required readiness/apply eligibility 仍在验证；live AIConfig 不一定已写入 | 用户接受 typed alias/profile ref |
| `ai-profile-setup-required` | required slice 尚未 ready；没有写入新的 live AIConfig | `K-AIEXEC-009` / `D-AIPC-005` 返回 setup-required/no-live-config |
| `ai-profile-applied` | `AIConfig` 已原子写入 | `aiProfile.apply` 成功（`D-AIPC-005`） |
| `ai-profile-materializing` | Runtime job 处于 `K-LENV-ACT-005` 中除 ready 与 hard-fail 之外的任一状态 | activation 答复显示 `queued`/`downloading`/`verifying`/`installing`/`needs_confirmation` |
| `ai-profile-active` | 所有 required dependency `ready_system` / `ready_managed` | `K-LENV-ACT-004` 完整 ready |
| `ai-profile-failed` | activation 答复显示 `failed` / `repair_required` / `unsupported` / `cancelled` | 必须显式区分 reason code 来源（`K-LENV-ACT-007`） |

UI 文案可以重命名上述状态，但必须保留状态区分与 reason source 可追溯性。
SDK 必须以 typed enum 暴露上述状态（`S-AICONF-002` no fallback rule）。

`MUST`:

- 任何"alias 已接受但 Runtime 尚未 ready"的情境必须显式投影
  `ai-profile-setup-required`、`ai-profile-materializing` 或
  `ai-profile-failed`；不得直接跳到
  `ai-profile-active`。
- 任何 `ai-profile-failed` 必须保留可恢复路径（cancel / retry / repair /
  切换 alias）。
- `ai-profile-setup-required` and `ai-profile-materializing` must preserve any
  existing valid AIConfig and must not write placeholder AIConfig.

`MUST NOT`:

- 不得在缺少 activation gate ready evidence 时投影 `ai-profile-active`。
- 不得让 first-run 在 `ai-profile-pending` 状态下隐式选用 cloud / local
  fallback。

## P-AIPS-011 — Cloud-Only Alias Constraint

声明 `compute_posture=cloud-only` 的 alias 必须：

- `local_compute_pack_refs` 为空。
- `dependency_family_refs` 为空。
- `materialization_confirmation_required` 为 `false`。
- `routing_policy` 必须为 `cloud-first` 或 `hybrid-explicit`。
- 不得请求 local environment activation；任何 local 依赖请求都视为
  admission failure（`K-LENV-ACT-008`）。

## P-AIPS-012 — Cross-Surface Applicability

factory `AIProfile` row 的 `applicable_scopes` 字段是封闭枚举：

- `first-run`
- `first-party-app`
- `scope-bound-apply`

`MUST`:

- 至少声明一种 applicable scope。
- `first-run` 的 alias 必须绑定 `first_run_install_levels` 中的
  `minimal`、`recommended` 或二者之一；没有 first-run 适用性的 alias
  必须把该字段设为空列表。
- `first-run` 的 alias 必须是 local baseline profile：不得声明
  `compute_posture=cloud-only`，不得声明 `routing_policy=cloud-first` 或
  `hybrid-explicit`，不得包含 `video.generate`，不得要求 cloud connector 或
  app-specific pack 才能达到 first-run readiness。
- `first_run_install_levels=minimal` 的 alias 必须至少覆盖本地 text/chat、
  basic STT、basic TTS 对应的 admitted local compute packs。`recommended`
  可以在 Runtime evidence 与用户确认支撑下增加 embedding、image、GPU
  support 等 admitted local packs，但不得静默加入 video、cloud connector、
  或 app-specific pack。
- `first-party-app` 的 alias 必须满足 P-AIPS-009 的 typed reference 形状。
- `scope-bound-apply` 的 alias 可用于任意 `AIScopeRef`（`P-AISC-001`）内的
  apply 操作。

`MUST NOT`:

- 不得通过 `applicable_scopes` 实现一种"未来才注入"的隐式扩展面；任何新
  scope 类型必须在本契约中显式 admit。
- 不得把 Cloud API、cloud-only、cloud-first、hybrid recommended、或
  connector setup 作为 first-run candidate；这些路径只能在
  post-initialization Runtime / app setup 中出现，除非未来产品 authority
  显式修订。

## P-AIPS-013 — Account Default Profile Local Library Evidence

Account Default Profile 是 account-scoped local AI profile library default，
固定路径为 `~/.nimi/accounts/<account-id>/profiles/default.json`。它由
first-run 按机器能力、install level、factory `AIProfile` selection policy、
catalog row、以及用户确认的 first-run plan seed 或 restore。Realm /
Runtime account session 只证明当前 authenticated `account_id`；不得作为
Account Default Profile content source。

`MUST`:

- `accountDefaultProfileRef` 必须解析到 durable account profile library
  record，并与 authenticated Runtime account binding 的 `account_id` 和
  selected `dataRootRef` 精确匹配。
- profile record 必须至少包含 `profileId=default`、profile version 或
  content hash、source policy ref、source catalog version、以及
  `createdAt` 或 `updatedAt`。
- source 必须是 Platform factory `AIProfile` policy / catalog seed、或显式
  restore flow；官方 factory update 不得静默覆盖已存在的 Account Default
  Profile。
- missing、stale、unhashable、wrong-account、wrong-data-root、
  caller-provided、string-only、或 source policy/catalog 不可解析的 ref
  must fail closed for product ready admission.

`MUST NOT`:

- RuntimeAccountService、Realm OAuth token、Realm profile projection、decoded
  token claims、`subject_user_id`、renderer profile state、SDK cache、或
  app-local cache 不得成为 Account Default Profile content evidence。
- Editing or replacing Account Default Profile must not mutate existing
  scope-bound `AIConfig`; applying it to scopes remains explicit and atomic.

## Fact Sources

- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
  canonical `AIScopeRef` identity contract
- `.nimi/spec/platform/kernel/capability-catalog-contract.md` —
  `P-CAPCAT-001..P-CAPCAT-003` canonical capability identity authority
- `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml` —
  admitted `CanonicalCapabilityId` rows
- `.nimi/spec/canonical/desktop/ai-consumption.authority.yaml` —
  `D-AIPC-001..D-AIPC-012` Desktop consumption rules for `AIProfile` /
  `AIConfig` / `AISnapshot`
- `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` —
  `K-AIEXEC-001..K-AIEXEC-006` runtime profile execution + probe contract
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` —
  `K-LENG-024..K-LENG-027` runtime local environment authority
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` —
  `K-LENG-028`, `K-RPC-025`, materializer registry/projection authority
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
  — `K-LENV-ACT-001..K-LENV-ACT-010` activation gate authority
- `.nimi/spec/runtime/kernel/tables/host-capability-profiles.yaml`
- `config/runtime-local-compute-packs.yaml`
- `config/runtime-local-environment-dependencies.yaml`
- `config/runtime-local-environment-materializers.yaml`
- `.nimi/spec/runtime/kernel/tables/activation-gate-reason-codes.yaml`
- `.nimi/spec/sdks/kernel/ai-config-surface-contract.md` —
  `S-AICONF-001..S-AICONF-006` SDK AI config typed surface
- `.nimi/spec/sdks/kernel/local-environment-projection-contract.md` —
  `S-RUNTIME-119` SDK local environment projection
- `.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml` —
  admitted factory `AIProfile` rows
