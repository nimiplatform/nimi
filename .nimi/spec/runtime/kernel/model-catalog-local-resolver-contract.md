# Runtime Model Catalog Local Resolver Contract

> Owner Domain: `K-MCAT-*`

Local-plane rows, curated presets, deterministic resolver, variant selection, slot omission, and resolver fail-close authority.

This file is a semantic split from `model-catalog-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-MCAT-032 Local-Plane Row Block

每个 `runtime.runtime_plane: local` provider 的 `models[]` row 必须携带一个
local-plane block。它是 `K-MCAT-002` capability-conditional 字段模式的 plane-
conditional 延伸（与 `video_generation` / `voice` block 同类），不是 schema fork。

local-plane block 的固定结构为：

- `install`（必填）：可安装事实
  - `repo`：HuggingFace repo
  - `revision`：pinned revision
  - `install_kind`：值域固定为 `binary` / `weights` / `verified-hf-multi-file`
  - `entry`：引擎入口 artifact，相对路径
  - `artifact_roles`：bundle 角色集合
  - `preferred_engine`：值域固定为 `llama` / `media` / `speech` / `sidecar`
- `variants`（必填，1+）：量化变体列表，每个变体为一个独立可安装资产
  - `variant_id`：稳定 per-`(model, quant)` 标识；它是 **installable identity**
  - `quant`：量化标识（如 `Q4_K_M` / `Q8_0` / `F16`）
  - `files`：组成文件列表
  - `hashes`：`{<file>: "sha256:<hex>"}`，每个文件必须有对应 hash
  - `entry`（可选）：该变体的引擎入口 artifact，相对路径。每个量化变体可有不同
    的入口文件（如 per-quant GGUF），因此 `entry` 在 variant 级可选。省略时变体
    入口默认收敛为：单文件变体取该唯一文件；多文件 bundle 取 `install.entry`。
  - `total_size_bytes`：预计总下载字节数（进度计算与磁盘预检）
  - `host_requirement`：该变体的精确 host fitness 输入
    - `accelerator`：值域固定为 `cpu` / `metal` / `cuda`
    - `min_ram_bytes`
    - `min_vram_bytes`：仅当 `accelerator != cpu` 时必填
- `fitness`（必填）：主模型 fitness 元数据
  - `param_count`
  - `context_length`
- `companions`（可选，0+）：被动伴随资产列表。仅出现在引擎确实需要它的 row 上
  （image / video workflow 模型）；core text/speech row 不携带 `companions`。
  每个 companion 是一个 **parent-bound passive asset**——它所嵌套的 row 即其
  parent。companion 的固定结构为：
  - `companion_kind`：被动资产种类，值域固定为 `K-LOCAL-007` passive-kind 枚举
    （`vae` / `clip` / `lora` / `controlnet` / `auxiliary`）。companion 是被动
    资产，不携带 `capabilities`、不携带 `fitness`。
  - `engine_slot`：引擎定义的 workflow injection role（`K-LOCAL-031`，典型值如
    `vae_path` / `llm_path` / `clip_path`）。It is not occurrence identity.
    Descriptor-backed workflows may repeat the same `engine_slot` only through
    distinct ordered companion occurrences.
  - `occurrence_policy`（可选）：当一个 catalog row advertises repeatable
    companion use, this field declares whether the backend admits
    `single`, `repeatable_ordered`, or `forbidden` use for that companion role.
  - `install`（必填）：与主模型同构的可安装事实（`repo` / `revision` /
    `install_kind` / `entry` / `artifact_roles` / `preferred_engine`）。
  - `variants`（必填，1+）：与主模型同构的量化变体列表。每个 companion variant
    携带 `variant_id` / `quant` / `files` / `hashes` / `total_size_bytes` /
    `host_requirement`，其约束与主模型 variant 完全一致。

不变量：

- `capabilities` 必须是 `K-MCAT-024` canonical token；local legacy token
  （`chat` / `embedding` / `tts` / `stt`）不得作为 local-plane row capability。
- 解析后用于 `model.asset` dependency env key 与 `InstallVerifiedAsset` 的
  `asset_id` 是 variant 级标识（`variant_id`）；两个量化变体是两个不同的可安装
  资产，因此 `tables/local-environment-dependencies.yaml` 的 `model.asset`
  env key `[asset_id, model_family, runtime_data_root]` 无需新增字段。`variant_id`
  是 installable identity；当一个 model/companion 的变体身份跨 accelerator
  （例如同一 quant 的 `cuda` 与 `metal` 变体）时，accelerator-specific 变体行
  仍是各自独立的 `variant_id`——这是同一 schema 下增加的独立 variant 行，不是
  schema 结构变更。
- verified row 的 host fitness 必须以每个变体的 `host_requirement` 为精确输入；
  verified row 不得使用 filename/size 推断（该保守路径仅保留给 `K-LOCAL-021d`
  live HuggingFace search）。
- 每个 variant（主模型与 companion 同等）必须携带 `hashes`；缺失完整性材料必须
  fail-close。
- companion 是 parent-bound 的被动资产：它解析出的 `variant_id` 成为一条
  `model.companion-asset` dependency 的 `asset_id`，其 `parent_asset_id` 是
  parent row 已解析变体的 `asset_id`。即使物理上是共享文件，companion 仍按
  parent 各自建模为独立 dependency（`model.companion-asset` env key 以
  `parent_asset_id` 为键）。companion 因此 inline 建模在所属 model row 下，而不是
  作为独立共享 row。
- catalog companion rows may constrain admitted roles and default occurrence
  policy, but ordered occurrence identity is owned by profile descriptors
  (`K-LOCAL-031`, `K-AIEXEC-008`). Catalog rows must not collapse repeated
  companion use into an unordered `engine_slot -> asset` map.
- local-plane block 覆盖所有 first-run capability tier：`text.generate` /
  `audio.transcribe` / `audio.synthesize` / `image.generate` / `video.generate`。
  schema 不按 tier 分叉；缺失某一 tier 的 row 不影响 schema 完整性。
- `text.embed` row 可以存在于 local catalog，但 embedding 不是 first-run local
  baseline slot（见 `K-MCAT-033`）。

## K-MCAT-033 Curated Presets Section

`runtime_plane: local` provider source 必须携带一个 `presets` section，把 factory
AIProfile install level 绑定到具体 model slot。这是人工 curation 的"选哪些模型"
决策面——不可自动化、必须保持可更新。

`presets` 的固定结构为：

```
presets:
  minimal:
    factory_aiprofile_alias: local-speech-ready
    slots:
      - slot: <slot id>  capability: <canonical token>  model_ref: <model_id>  required: <bool>  host_conditional: <bool, optional>
  recommended:
    factory_aiprofile_alias: local-gpu
    slots:
      - ...
```

不变量：

- `presets` 的固定 install level key 为 `minimal` 与 `recommended`，与
  `ai-profile-factory-catalog.yaml` 的 `first_run_install_levels` 枚举对齐。
- 每个 preset 是 **单一固定** 的具体模型集合。`recommended` 只有一个 preset；
  跨机器伸缩由 variant 选择（`K-MCAT-035`）实现，不得通过增设 preset 实现。
- `slot.model_ref` 必须解析到同 provider 下一个已 admitted 的 catalog row，且该
  row 的 `capabilities` 必须包含 `slot.capability`。
- 每个 preset 声明的 capability 集合必须是其绑定 factory AIProfile（
  `factory_aiprofile_alias`）`capability_set` 的子集，并与之一致。
- `required: true` slot 进入 readiness gate；`host_conditional: true` slot 在
  无变体可适配的 host 上允许被省略（`K-MCAT-036` host-conditional 省略规则）。
  无变体可适配的 `required` slot 使该 preset 在该 host 上 fail-close；resolver
  不替换为另一个 preset。
- `text.embed` 不得作为任何 install level 的 preset slot。本地专用 embedding
  模型是常驻资源成本，cloud embedding 成本低或免费；embedding 是
  post-initialization / cloud-default 能力，不属于 first-run local baseline。
  `minimal` 与 `recommended` 都不得 curate 本地 embedding 模型。
- preset section 只存在于 Runtime model catalog source；不得出现在
  `ai-profile-factory-catalog.yaml`——factory AIProfile 保持 model-agnostic
  （`P-AIPS-002`）。preset 绑定是 Runtime catalog truth，满足 `P-AIPS-005`
  指名的"Runtime model catalog"。
- `K-MCAT-022` activation guardrail 同样约束 preset：runtime adapter 尚未接入的
  capability/variant 对应的 slot 不得被 preset 标记为可激活 required slot。

## K-MCAT-034 Deterministic Local Model Resolver

Runtime 必须提供一个确定性 resolver，将抽象的 factory AIProfile install level 与
host posture 解析为具体的 per-slot 可安装资产绑定。它关闭 first-run Phase 3
materialization 缺失 `asset_id` 的 blocking gap。

resolver contract 固定为：

```
resolve(install_level, host_posture) -> ResolvedModelSet | FailClose
```

- `install_level` ∈ `{minimal, recommended}`，来自用户 first-run 选择。
- `host_posture` 是 Runtime `CollectDeviceProfile`（`K-DEV-*`）产出的
  `LocalDeviceProfile`。resolver 只消费 Runtime host evidence，不得重新探测硬件。
- `ResolvedModelSet` 的每个 slot 投影为 `{slot, capability, asset_id,
  variant_id}`；`asset_id` 是 variant 级标识（`K-MCAT-032`）。

resolver 必须 **确定性**：相同 `(install_level, host_posture, catalog_version)`
必须产出相同输出。

resolver 是 profile-scoped 而非 first-run-private：`P-AIPS-012` 把 factory
AIProfile 同时 admitted 给 `first-run` / `first-party-app` / `scope-bound-apply`，
因此同一个 `resolve()` 服务这三类 caller；first-run seam 只是其中一个 caller。

resolver algorithm 固定为：

1. **Preset lookup**：从 catalog 解析 `presets[install_level]`。未知 install
   level 必须 fail-close，reason code `local_model_resolve_install_level_invalid`。
2. **Per-slot variant selection**：对每个 slot，按 `K-MCAT-035` 选择变体。
3. **Outcome**：按 `K-MCAT-036` 判定 `ResolvedModelSet` / `FailClose`。

curation 选模型、resolver 选 bits：模型身份是 `presets` 中的 curated 决策
（`K-MCAT-033`），resolver 的唯一自由度是 variant 选择——一个确定性阈值检查。
resolver 不在 preset 之间做替换：用户选定的 preset 在该 host 上要么完整解析，
要么 fail-close。

同一个确定性 resolver 同时服务两条 first-run 路径：`MintRuntimeBaselineReadiness`
的 readiness-evidence activation 路径（`K-LENV-ACT-011`），以及
`ResolveLocalEnvironmentPlan` 的 desktop 首启 materialization 路径
（`K-RPC-025`，install-level plan resolution）。两条路径都调用这同一个
`resolve()`，都不自行决策。因此对相同 `(install_level, host_posture,
catalog_version)`，两条 seam 必须解析出**完全相同**的 per-slot 资产——一致性由
resolver 的确定性（本节）保证，不是由两套并行逻辑各自维持。materialization 路径
按 `pack -> hosted capabilities` 关系把 `ResolvedModelSet` 的 slot 投影为 plan 的
`model.asset` / `model.companion-asset` 依赖；activation 路径按 engine-consumer
到 slot 的映射投影为 baseline consumer binding。投影方式不同，被投影的
`ResolvedModelSet` 必须相同。

## K-MCAT-035 Resolver Variant Selection

resolver 对每个 preset slot 的变体选择固定为：

1. 加载 catalog model row `slot.model_ref`。
2. 对每个 `variants[]` 变体计算其相对 `host_posture` 的 eligibility：
   - `host_requirement.accelerator` 必须在 host 上可用。
   - 估算 footprint 相对 host budget，复用 `K-LOCAL-021c` 的固定 tier 阈值：
     `recommended`（`estimated_mem <= 70% budget`）、`runnable`（`<= 85%`）、
     `tight`（`<= 100%`）、`not_recommended`（`> budget`）。
3. 在达到至少 `runnable` tier 的变体中，选择 **最高 quant rank**。quant rank 是
   catalog-defined 的固定全序（`F16 > Q8_0 > Q6_K > Q5_K_M > Q4_K_M > Q4_0 >
   Q3 > Q2`），并带稳定 catalog-defined tie-break。
4. `tight` 或 `not_recommended` 变体不得被自动选择。
5. 若没有变体达到 `runnable`：
   - `host_conditional: true` slot → 标记 slot **omitted**，附 typed note。
   - `required: true` slot → 标记 slot **unsatisfiable**。

`llmfit` / `media-fit`（`K-LOCAL-021c` / `K-LOCAL-021d`）在此被复用为 **variant
selector**，不是 model selector；不得新增第二套 fitness 机制。LLM 主模型复用
`K-LOCAL-021d` 的 `fit_level -> tier` 映射，media 主模型复用 `K-LOCAL-021c` 的
头寸阈值。当 metadata 或设备画像不完整时，resolver 必须降低 confidence 并附
reason/note，不得静默按高置信度结果选择变体。

当 slot 的 model row 携带 `companions`（`K-MCAT-032`）时，resolver 对 **每个
companion** 也运行同一套 variant 选择算法（步骤 1-5），输入同一 `host_posture`。
companion 的变体选择与主模型变体选择完全同构——没有第二套 companion-specific
选择机制。slot 的解析结果因此从 `{slot, capability, asset_id, variant_id}` 扩展为
携带 `companions: [{companion_kind, engine_slot, asset_id, variant_id}]`，每个
companion binding 的 `asset_id` 是该 companion 选中变体的 `variant_id`。

## K-MCAT-036 Host-Conditional Slot Omission

resolver outcome 固定为：

- 所有 `required` slot 满足 → 返回 `ResolvedModelSet`。被省略的
  `host_conditional` slot 不进入 `ResolvedModelSet`，每个附 typed reason
  `local_model_resolve_slot_omitted`。
- 某个 `required` slot unsatisfiable（无论 `install_level` 是 `minimal` 还是
  `recommended`）→ 返回 `FailClose`，reason code
  `local_model_resolve_host_unsupported`。

resolver 不在 preset 之间做替换。用户选定的 install level 在该 host 上要么完整
解析，要么 fail-close——fail-close 是"该 host tier 当前未被 catalog 覆盖"的诚实
信号，不是对用户所选 preset 的静默替换。`host_conditional` optional slot 的
host-conditional 省略与此不同：它仍交付每一个 `required` slot，因此是 preset
内的适配而非替换，实现产品手册的 "image slot 可在弱机省略" 行为，且不引入
device-class-keyed presets。当用户选定的 preset 在该 host 上 fail-close 时，
用户可改选另一个 install level；catalog 对更多 host tier 的覆盖由后续 curation
扩展。

一个 slot 的 **主模型或其任意 companion**（`K-MCAT-032`）无法在该 host 上选出
至少 `runnable` 变体时，该 slot 视为 unsatisfiable，并沿用上述同一规则——
`required` slot → `FailClose`（`local_model_resolve_host_unsupported`）；
`host_conditional` slot → 省略（`local_model_resolve_slot_omitted`）。companion
的不可满足不引入新的 resolver outcome 类型，也不引入新的 reason code；它折叠进
既有 `K-MCAT-035` 变体选择与 `K-MCAT-037` fail-close 纪律。

## K-MCAT-037 Resolver Fail-Close Discipline

resolver 必须严格 fail-close：

- 任何 slot 都不得被 `tight` / `not_recommended` 变体静默满足。
- 任何 `required` slot unsatisfiable——无论 `install_level` 是 `minimal` 还是
  `recommended`——都必须 fail-close，reason code
  `local_model_resolve_host_unsupported`；resolver 不得替换为另一个 preset。
- `FailClose` outcome 必须携带 typed reason code；first-run state machine 将其
  投影为 `blocked` / `repair_required` / `unsupported`，不得产出 placeholder
  `asset_id`，不得 pseudo-success。
- resolver reason code 是 Runtime-owned activation projection；消费者不得发明。
  resolver reason code 与现有 dependency-family activation reason code
  （`model_asset_missing` 等）属于同一 activation gate 投影面，固定为：
  - `local_model_resolve_install_level_invalid`
  - `local_model_resolve_slot_omitted`
  - `local_model_resolve_host_unsupported`
  这些 reason code 注册在 `tables/activation-gate-reason-codes.yaml`。
- resolver 解析出的 `asset_id` 是 variant 级标识；它被填入 first-run baseline
  consumer binding，使下游 `model.asset` dependency env key
  `[asset_id, model_family, runtime_data_root]` 取到非空值，从而 `model.asset`
  缺失 `asset_id` 的 fail-close 不再在 baseline path 上误触发。
- resolver 不得跨 preset 静默换模型，也不得在 `ResolvedModelSet` 之外伪造
  ready 状态。

## Local Resolver Verification Anchors

- `K-MCAT-032` / `K-MCAT-033`：`pnpm check:runtime-catalog-drift`
- `K-MCAT-034` / `K-MCAT-035` / `K-MCAT-036` / `K-MCAT-037`：`runtime` Go
  resolver 单元测试 + `go run ./cmd/runtime-compliance --gate`（resolver
  implementation and compliance evidence must exist before production
  readiness is claimed）
