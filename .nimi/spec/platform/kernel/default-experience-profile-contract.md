# Default Experience Profile Contract

> Owner Domain: `P-DXP-*`

## Scope

定义 `Default Experience Profile` — Nimi 平台的产品级 ordinary-user 默认 AI 体验
recommendation/catalog authority。本契约为 Nimi Home first-run、scope-bound
profile apply、以及 admitted first-party Nimi App 的默认 AI 体验提供唯一的
authority surface。本契约不创建第四份 AI live config truth，不替代
`AIProfile` / `AIConfig` / `AISnapshot` 三段式 authority，不拥有 install state、
selected source records、host detection、materializer execution、provider/model
identity，也不绕过 Wave 4 permission fabric 与 Wave 3 Nimi App registry。

## P-DXP-001 — Authority Boundary

`Default Experience Profile` 是 Platform 拥有的 product
recommendation/catalog 单位。

`MUST`:

- 本 authority 只表达"推荐选用哪种 AI 体验"的产品语义。
- 必须通过 `aiProfile.apply(scopeRef, profileId)`（S-AICONF-001）进入
  `D-AIPC-005` 的原子覆盖路径，写入 scope-bound `AIConfig`，并由 Desktop host
  的 `D-AIPC-003` / `D-AIPC-004` 拥有 live config 与 snapshot truth。
- 当 alias 被用户接受、被 first-party app 通过 hint 引用、或被 scope-bound
  apply 引用时，仅产生 `AIProfile` 模板派生与可选的 Runtime materialization
  confirmation 请求；本 authority 不持有任何执行权或安装权。

`MUST NOT`:

- 不得直接执行 AI 推理。
- 不得拥有或持久化 live `AIConfig` truth。
- 不得拥有或持久化 install state、materialization job state、selected source
  record（K-LENV-MAT-*、K-LENV-ACT-*、K-LENG-024..K-LENG-028）。
- 不得拥有 host capability profile（runtime/kernel/tables/
  host-capability-profiles.yaml）、local compute pack
  （runtime/kernel/tables/local-compute-packs.yaml）、local environment
  dependencies（runtime/kernel/tables/local-environment-dependencies.yaml）、
  或 activation gate reason codes（runtime/kernel/tables/
  activation-gate-reason-codes.yaml）的 schema 或 row owner。
- 不得新增 `AIProfile` / `AIConfig` / `AISnapshot` 之外的第四种 AI live
  config 形态。

## P-DXP-002 — Dimensioned Aliases

每个 `Default Experience Profile` 在 schema 层是按下列四维矩阵 keyed 的
catalog row：

```
privacy_posture x compute_posture x capability_set x routing_policy
```

四维定义：

| 维度 | 封闭枚举 | Owner |
|---|---|---|
| `privacy_posture` | `cloud-ok` \| `local-preferred` \| `local-required` | Platform `P-DXP-*` |
| `compute_posture` | `cpu-only` \| `metal-capable` \| `cuda-capable` \| `cloud-only` | Platform `P-DXP-*`；约束 host 选择面，但 host capability detection 由 Runtime `K-LENG-024` 拥有 |
| `capability_set` | `CanonicalCapabilityId` 列表 | Platform `P-DXP-*` 引用；元素 owner 是 `P-CAPCAT-*` |
| `routing_policy` | `cloud-first` \| `local-first` \| `hybrid-explicit` | Platform `P-DXP-*` |

可读名（例如 `cloud-first`、`local-standard`、`local-speech-ready`、
`local-gpu`、`hybrid-recommended`）是矩阵的 readable projection。它们：

- `MUST` 在 `tables/default-experience-profiles.yaml` 中以 `alias` 字段表示。
- `MUST NOT` 成为 schema owner。
- `MUST NOT` 与具体 provider / connector / engine / model 字符串绑定。

## P-DXP-003 — Apply Chain

`Default Experience Profile` 的 apply 链固定为：

```
Default Experience Profile alias
  -> derive AIProfile template(s)
  -> aiProfile.apply(scopeRef, profileId)           (S-AICONF-001)
  -> atomic overwrite scope-bound AIConfig          (D-AIPC-005)
  -> execution freezes per-turn AISnapshot          (D-AIPC-004)
  -> Runtime materializes local dependency plan     (K-LENV-MAT-*, K-LENV-ACT-*)
```

`MUST`:

- 用户接受 alias 写入的 `AIConfig` 必须是 full materialized config（D-AIPC-003），
  不允许 partial overlay 或 scope-fallback chain（P-AISC-003）。
- alias 接受不立即代表 execution readiness：UI / SDK / app 必须分别消费
  Runtime activation gate（K-LENV-ACT-004 / K-LENV-ACT-005）才能投影
  execution readiness。
- 用户在 scope 内对 `AIConfig` 的后续微调（D-AIPC-011 `Local customization`）
  不反向污染 `AIProfile`，更不修改 `Default Experience Profile` row。

`MUST NOT`:

- 不得让 apply 路径绕过 `AIProfile` / `AIConfig` / `AISnapshot` 链条。
- 不得在 `AIConfig` apply 失败时静默降级到 partial config 或猜测的 cloud /
  local fallback；失败必须按 `D-AIPC-005` apply probe / failure 规则与
  S-AICONF-002 typed error 上报。
- 不得在 first-run、profile apply、或 first-party app hint 路径上直接产生
  selected source record，或绕过 `K-LENV-ACT-001..K-LENV-ACT-010` 的
  activation request/response 形状。

## P-DXP-004 — Host And Profile Selection Matrix

`Default Experience Profile` 的 host / compute / dependency 选择面只能引用
Runtime 已 admit 的 row：

`MUST`:

- `host_capability_profile_refs` 字段中的每个值必须是
  `.nimi/spec/runtime/kernel/tables/host-capability-profiles.yaml` 中已 admit
  的 `profile_id`。
- `local_compute_pack_refs` 字段中的每个值必须是
  `.nimi/spec/runtime/kernel/tables/local-compute-packs.yaml` 中已 admit 的
  `pack_id`。
- `dependency_family_refs` 字段中的每个值必须是
  `.nimi/spec/runtime/kernel/tables/local-environment-dependencies.yaml` 中
  已 admit 的 `family_id`。
- 表中每一行 commit 前必须保证全部 ref 都能解析到 admitted row；任何无法
  解析的 ref 都是 admission failure。

`MUST NOT`:

- 不得发明新的 host capability axis、accelerator plane、local compute pack、
  dependency family。任何扩展必须发生在对应 Runtime 表内并经过 spec
  consistency check。
- 不得复用 alias schema 表达 host detection 或 pack arbitration 决策；这些
  决策仍由 Runtime activation 与 plan resolver 拥有
  （K-LENV-ACT-001..K-LENV-ACT-008、K-LENG-026..K-LENG-027）。

## P-DXP-005 — Capability Binding

`Default Experience Profile` 仅通过 `CanonicalCapabilityId` 表达能力意图。

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

## P-DXP-006 — Cloud / Local / Hybrid / Privacy Posture Rules

`Default Experience Profile` 必须在 `privacy_posture` 与 `routing_policy`
之间形成稳定语义；不得隐含 fallback 替代。

`MUST`:

- `privacy_posture=cloud-ok`：alias 允许将能力绑定到 admitted cloud
  connector（受 Wave 4 spend / permission 规则约束）。该 posture 不得隐式
  要求超过 Runtime core readiness 的 local materialization。
- `privacy_posture=local-preferred`：alias 在 host capability 与 selected
  source record 满足时优先选用 local 路径；当 local readiness 缺失时，必须
  按 `K-LENV-ACT-005` 投影 `setup_required` / `repair_required` / `failed` /
  `unsupported` / `cancelled` / `setup_in_progress`。只有当 alias 在该
  capability slice 上显式声明 admitted hybrid binding（即同时绑定 local
  与 cloud），才允许在 local 缺失时按 `routing_policy=hybrid-explicit`
  退化到 cloud 路径。
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
- 不得在缺少 hybrid binding 的情况下，把 local fail 隐式投影成 cloud success。
- 不得在 cloud-only alias 上请求 local environment dependency
  （`K-LENV-ACT-008`）。

## P-DXP-007 — Materialization Projection State Machine

`Default Experience Profile` alias 接受后，可通过 Runtime admitted command
surface 请求 confirmation 与 materialization：

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
  `default-experience-profile-active` 投影必须由完整 activation gate ready
  evidence 支撑。
- Runtime confirmation payload 必须显式声明 dependency family、known size、
  storage category，以及 no-system-mutation policy（K-LENG-027）。

`MUST NOT`:

- 不得从 file existence、endpoint reachability、transfer completion、
  package directory presence、PATH precedence、import success、import
  directory contents、script exit、process liveness、warmup success、或
  previous health success 推断 `ready`（K-LENV-ACT-009）。
- 不得把上述 non-ready 状态压缩为单一 `unavailable` 文案。
- 不得通过 probe（`aiConfig.probe(scopeRef)` / `aiConfig.probeFeasibility(
  scopeRef)`）替代 activation gate 投影；probe 是诊断面，不是 readiness
  authority。

## P-DXP-008 — No Provider / Model Constants Guard

`Default Experience Profile` 必须保持 provider/model agnostic。

`MUST`:

- 本契约、`tables/default-experience-profiles.yaml`、Nimi Home shell 代码、
  first-run 路径代码、SDK default-experience 表面、first-party Nimi App
  default-experience 绑定代码都不得内嵌 provider id、connector id、engine
  id、model id 等字符串常量作为默认体验事实源。
- 该 guard 由 `enforcement-gates-required.md` 中
  `check:no-default-experience-provider-model-constants` 注册为 mechanical
  guard plan，由 Wave 1 与 Wave 5 在其实现 close 前 land。

`MUST NOT`:

- 不得通过文档常量、UI string table、generated catalog snapshot、placeholder
  fallback、bootstrap seed 等迂回路径，把具体 vendor / model 默认硬编码进
  Default Experience Profile 表面。

## P-DXP-009 — First-Party App Default Profile Hint Rule

Admitted first-party Nimi App（Wave 5 hardcut 目标包括 Avatar 与 ParentOS）
必须通过 typed alias reference 声明其 `Default Experience Profile` hint。

`MUST`:

- App registry row（Wave 3 frozen）或 app manifest 中的 default-experience
  hint 必须引用本表中已 admit 的 alias。
- 用户安装该 app 并被其请求默认体验时，alias 通过 `S-AICONF-001`
  `aiProfile.apply(scopeRef, profileId)` 进入该 app 的 scope-bound
  `AIConfig`。
- hint 仅声明推荐体验；它不创建任何账户、数据、agent 身份、AI 消费、
  memory/cognition 访问授权。所有授权仍由 Wave 4 permission fabric 与
  Wave 3 Nimi App registry 拥有。
- 用户在 app scope 内对 `AIConfig` 的进一步微调按 `D-AIPC-011` 处理。

`MUST NOT`:

- 不得通过 hint 绕过 Wave 4 permission fabric、Wave 3 registry admission、
  Runtime activation gate，或绕过本契约的 no-provider-model-constants
  规则。
- 不得在 first-party app 内部维持一份与本表 alias 并行的默认体验 track；
  app 不得为同一 scope 同时投影两份不同 `AIConfig` truth。

## P-DXP-010 — First-Run And Scope-Bound Apply State Machine

Nimi Home first-run 与任何 scope-bound apply 路径都必须以下列封闭状态
显式投影 alias 接受 + materialization 的产品语义，不得压缩为单一
`ready` / `unavailable`：

| 状态 | 含义 | 触发条件 |
|---|---|---|
| `default-experience-profile-pending` | 尚未接受任何 alias | first-run 进入；或之前的 alias 被显式撤销 |
| `default-experience-profile-accepted` | alias 已接受，`AIConfig` 已原子写入 | `aiProfile.apply` 成功（D-AIPC-005） |
| `default-experience-profile-materializing` | Runtime job 处于 `K-LENV-ACT-005` 中除 ready 与 hard-fail 之外的任一状态 | activation 答复显示 `queued`/`downloading`/`verifying`/`installing`/`needs_confirmation` |
| `default-experience-profile-active` | 所有 required dependency `ready_system` / `ready_managed` | `K-LENV-ACT-004` 完整 ready |
| `default-experience-profile-failed` | activation 答复显示 `failed` / `repair_required` / `unsupported` / `cancelled` | 必须显式区分 reason code 来源（K-LENV-ACT-007） |

UI 文案可以重命名上述状态，但必须保留状态区分与 reason source 可追溯性。
SDK 必须以 typed enum 暴露上述状态（S-AICONF-002 no fallback rule）。

`MUST`:

- 任何"alias 已接受但 Runtime 尚未 ready"的情境必须显式投影
  `default-experience-profile-materializing` 或 `default-experience-profile-failed`；
  不得直接跳到 `default-experience-profile-active`。
- 任何 `default-experience-profile-failed` 必须保留可恢复路径（cancel /
  retry / repair / 切换 alias）。

`MUST NOT`:

- 不得在缺少 activation gate ready evidence 时投影
  `default-experience-profile-active`。
- 不得让 first-run 在 `default-experience-profile-pending` 状态下隐式选用
  cloud / local fallback。

## P-DXP-011 — Cloud-Only Alias Constraint

声明 `compute_posture=cloud-only` 的 alias 必须：

- `local_compute_pack_refs` 为空。
- `dependency_family_refs` 为空。
- `materialization_confirmation_required` 为 `false`。
- `routing_policy` 必须为 `cloud-first` 或 `hybrid-explicit`。
- 不得请求 local environment activation；任何 local 依赖请求都视为
  admission failure（K-LENV-ACT-008）。

## P-DXP-012 — Cross-Surface Applicability

`Default Experience Profile` row 的 `applicable_scopes` 字段是封闭枚举：

- `first-run`
- `first-party-app`
- `scope-bound-apply`

`MUST`:

- 至少声明一种 applicable scope。
- `first-run` 的 alias 必须能在没有任何额外用户输入的情况下安全接受
  （未 ready 时仍按 P-DXP-010 投影状态）。
- `first-party-app` 的 alias 必须满足 P-DXP-009 的 typed reference 形状。
- `scope-bound-apply` 的 alias 可用于任意 `AIScopeRef` (P-AISC-001) 内的
  apply 操作。

`MUST NOT`:

- 不得通过 `applicable_scopes` 实现一种"未来才注入"的隐式扩展面；任何新
  scope 类型必须在本契约中显式 admit。

## Fact Sources

- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
  canonical `AIScopeRef` identity contract
- `.nimi/spec/platform/kernel/capability-catalog-contract.md` —
  `P-CAPCAT-001..P-CAPCAT-003` canonical capability identity authority
- `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml` —
  admitted `CanonicalCapabilityId` rows
- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` —
  `D-AIPC-001..D-AIPC-012` `AIProfile` / `AIConfig` / `AISnapshot` authority
- `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` —
  `K-AIEXEC-001..K-AIEXEC-006` runtime profile execution + probe contract
- `.nimi/spec/runtime/kernel/local-engine-contract.md` —
  `K-LENG-024..K-LENG-028` runtime local environment authority
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` —
  `K-LENG-028`, `K-RPC-025`, materializer registry/projection authority
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
  — `K-LENV-ACT-001..K-LENV-ACT-010` activation gate authority
- `.nimi/spec/runtime/kernel/tables/host-capability-profiles.yaml`
- `.nimi/spec/runtime/kernel/tables/local-compute-packs.yaml`
- `.nimi/spec/runtime/kernel/tables/local-environment-dependencies.yaml`
- `.nimi/spec/runtime/kernel/tables/local-environment-materializers.yaml`
- `.nimi/spec/runtime/kernel/tables/activation-gate-reason-codes.yaml`
- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` —
  `S-AICONF-001..S-AICONF-006` SDK AI config typed surface
- `.nimi/spec/sdk/kernel/local-environment-projection-contract.md` —
  `S-RUNTIME-119` SDK local environment projection
- `.nimi/spec/platform/kernel/tables/default-experience-profiles.yaml` —
  admitted Default Experience Profile rows
