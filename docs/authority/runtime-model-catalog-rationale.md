# Runtime Model Catalog - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/runtime/model-catalog.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/model-catalog-contract.md -->

# Runtime Model Catalog Contract

> Owner Domain: `K-MCAT-*`

Split authority map:

- `model-catalog-voice-workflow-contract.md`: K-MCAT-007, K-MCAT-010, K-MCAT-012..019, K-MCAT-023..024, K-MCAT-026, and K-MCAT-028..031
- `model-catalog-provider-metadata-contract.md`: K-MCAT-011, K-MCAT-020..022, K-MCAT-025, and K-MCAT-027
- `model-catalog-local-resolver-contract.md`: K-MCAT-032..037
## K-MCAT-000 Runtime Target Identity v2 Hard Cut

`K-RTARGET-*` defines durable target identity. Provider/catalog `model_id`
fields in this document are catalog/provider facts only. Runtime cloud target
identity is `remote_model_catalog_id`; provider model ids cannot mint durable
target refs without Runtime-owned catalog snapshot resolution.

## K-MCAT-001 SSOT Location

Runtime model/voice schema and behavior rules are defined in this contract (`K-MCAT-*`).
Runtime default data MUST be loaded from `runtime/catalog/providers/*.yaml` (provider-scoped files), not from `.nimi/spec/runtime/kernel/tables/*`.
Source-provider entries under `runtime/catalog/source/providers/` are the authoring SSOT for source-provider metadata, including endpoint/runtime facts that are later projected into snapshot / registry / spec tables. A provider entry MAY be either `<provider>.source.yaml` or a `<provider>/` directory of YAML fragments merged by source tooling.
`tables/provider-catalog.yaml` is the projected remote-endpoint table for remote providers and therefore intentionally excludes `local`.

## K-MCAT-002 Field Schema

Each provider file in `runtime/catalog/providers/*.yaml` MUST include:

- `version`
- `provider`
- `catalog_version`
- `inventory_mode`
- `default_text_model` (optional; remote text-capable providers only)
- `selection_profiles` (optional; reviewed provider-level recommendations)
- `models` (optional only when `inventory_mode=dynamic_endpoint`)
- `voices` (optional; required only when TTS-capable models exist)

`inventory_mode` MUST be one of:

- `static_source`
- `dynamic_endpoint`

When `inventory_mode=dynamic_endpoint`, provider snapshot MAY omit static
`models` rows and instead MUST include provider-level dynamic inventory metadata.

`models[]` entries MUST include:

- `provider`
- `model_id`
- `model_type`
- `updated_at`
- `capabilities`
- `pricing`
- `source_ref`

`models[]` capability-conditional fields:

- remote `static_source` row 的 capability 包含 `text.generate` 时，
  `context_window_tokens` MUST 是正整数；其值必须来自 source model override 或
  source provider 的 reviewed conservative floor。非 `text.generate` row MUST NOT
  携带该字段。`local` text row 继续以 `fitness.context_length` 为 catalog authority。
- when capability includes `audio.synthesize`: `voice_set_id` MUST be present.
- when capability includes `audio.synthesize` and speech route-describe metadata is admitted: `voice_request_options` MAY be present.
- when capability includes `audio.transcribe` and speech route-describe metadata is admitted: `transcription` MAY be present.
- when capability includes `image.generate` and image route-describe metadata is admitted: `image_request_options` MUST be present.
- when capability includes `video.generate`: `video_generation` MUST be present.
- when capability includes `text.embed` and the model has a single admitted output dimension: `embedding` MAY be present. `embedding.dimension` MUST be a positive integer and is the catalog authority for the runtime memory embedding profile dimension (`K-MEM-004`, `K-AIEXEC-006`). The `embedding` field MUST NOT appear on a model that does not declare `text.embed`. A `text.embed` model with variable or preview-only output dimension MAY omit `embedding`; runtime then fails closed when asked to resolve an embedding profile for that model rather than fabricating a dimension.

`voices[]` entries MUST include:

- `voice_set_id`
- `provider`
- `voice_id`
- `name`
- `langs`
- `model_ids`
- `source_ref`

## K-MCAT-003 Pricing Normalization

`pricing` MUST use normalized metering units: `token|char|second|request`. Each entry MUST include `input`, `output`, `currency`, `as_of`, and `notes`. Unknown pricing values are allowed only as literal `"unknown"`.

Value semantics for `input` and `output` fields:

- `unit: token` — price in `currency` **per 1,000,000 tokens**
- `unit: char` — price in `currency` **per 1,000,000 characters**
- `unit: second` — price in `currency` **per 60 seconds** of compute/audio
- `unit: request` — price in `currency` **per single request**

When `currency: "none"` (local models), `input` and `output` MUST be set to `"0"` (not `"unknown"`) to indicate zero provider-side cost.

## K-MCAT-004 Source Traceability

Every model and voice entry MUST include `source_ref` with authoritative provider documentation URL and `retrieved_at` date.

## K-MCAT-005 Runtime Resolution Order

Runtime catalog resolution order MUST be:

1. Built-in snapshot (required)
2. Local custom provider directory (`modelCatalogCustomDir`) (optional)

Remote metadata cache / refresh MUST NOT exist as a non-scenario catalog source.
Dynamic connector model discovery cache MAY exist as runtime execution cache only
for `inventory_mode=dynamic_endpoint`; it MUST NOT become a second catalog truth
source.

## K-MCAT-006 Local Custom Override Safety

Custom catalog override is local-file only and MUST NOT fetch provider metadata from remote discovery endpoints.
Any custom provider YAML ingestion MUST enforce:

- parse validation before activation
- last-known-good built-in snapshot fallback
- no startup dependency on mutable external metadata

## K-MCAT-006a User Overlay Merge Semantics

Custom catalog overlays MUST be stored as provider-scoped local fragments and merged at model granularity, not as full effective provider snapshots.

- built-in provider documents continue to load from `runtime/catalog/providers/*.yaml`
- custom overlay documents MAY exist in shared custom catalog roots and in user-scoped overlay roots
- effective provider state = built-in provider document + overlay upserts
- overlay entries with the same `model_id` MUST override the built-in model entry
- built-in models that are not mentioned by overlay fragments MUST remain visible and continue to receive built-in catalog upgrades
- user-created models and user-created overrides MUST be isolated to the requesting subject user and MUST NOT mutate other users' effective catalogs

## K-MCAT-006b Desktop Catalog Truth Source

Desktop catalog browsing and editing MUST use runtime model catalog truth resolved from `runtime/catalog/providers/*.yaml` plus overlay merge semantics.
`tables/provider-catalog.yaml` remains the projected remote-provider table and MUST NOT be treated as the desktop catalog page truth source.
Desktop catalog UX therefore MUST include providers that exist only in runtime model catalog truth, including `local`.

## K-MCAT-008 Fail-Close Semantics

When catalog lookup fails:

- unknown model -> `AI_MODEL_NOT_FOUND`
- unsupported voice -> `AI_MEDIA_OPTION_UNSUPPORTED`

Runtime MUST fail-close and MUST NOT silently fallback to legacy hardcoded voice lists for DashScope.

## K-MCAT-009 Compatibility Scope

`ListPresetVoices` gRPC surface remains unchanged in this phase. `catalog_source` is an internal/runtime diagnostic behavior and does not require proto breaking change.


---

<!-- source: .nimi/spec/runtime/kernel/model-catalog-local-resolver-contract.md -->

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


---

<!-- source: .nimi/spec/runtime/kernel/model-catalog-provider-metadata-contract.md -->

# Runtime Model Catalog Provider Metadata Contract

> Owner Domain: `K-MCAT-*`

Source schema, provider onboarding, activation, source/infra boundary, and runtime metadata projection authority.

This file is a semantic split from `model-catalog-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-MCAT-011 Source Schema v3

Source-provider entries under `runtime/catalog/source/providers/` 必须在合并后使用 schema v3。核心结构固定为：

- `runtime`
- `models`
- `language_profiles`
- `sources`
- `voice_sets`（可选）
- `voice_workflow_models`（可选）
- `model_workflow_bindings`（可选）

其中：

- `runtime.inventory_mode` 必填，值域为 `static_source|dynamic_endpoint`
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`runtime.dynamic_inventory`
  必填
- 当 `runtime.inventory_mode=dynamic_endpoint` 时，`models`、`selection_profiles`
  与 `defaults.default_text_model` 都可以省略
- 当 `runtime.inventory_mode=static_source`、`runtime.runtime_plane=remote` 且
  任一 `models[]` row 声明 `text.generate` 时，source 必须以正整数声明
  `defaults.context_window_tokens`，或在每个 text row 上声明正整数
  `models[].context_window_tokens`。该值是 catalog review 明确接纳的保守
  request-capacity floor，不是 Runtime/provider/app 推测的通用默认值；model
  row override 优先于 provider source default，alias expansion 必须继承 canonical
  model 的同一值。

## K-MCAT-020 Single Catalog Layout

Catalog source 与 snapshot 采用单一目录布局：

- source：`runtime/catalog/source/providers/` source-provider entries
- snapshot：`runtime/catalog/providers/*.yaml`

Runtime 仅允许加载 `runtime/catalog/providers/*.yaml`。

## K-MCAT-021 Layered Provider Onboarding

Provider 纳入必须分层：

- `audio.synthesize` 是纳入基础门槛；
- `voice_workflow.voice_clone` / `voice_workflow.voice_design` 属于可选能力增量；
- 仅支持 synthesize 的 provider 不得被强制声明 `voice_workflow_models`；
- 云厂训练型 Custom Voice（长周期训练）在未形成跨 provider 强类型抽象前，必须标记为 deferred/provider extension。

## K-MCAT-022 Activation Guardrail

Catalog source 不得将未接入 runtime adapter 的 capability 或 workflow binding 标记为 active。
Runtime 实际可用性必须与 source/snapshot 激活面一致；未接入实现的 provider/capability/workflow 不得被 source 声明，也不得被路由执行。

## K-MCAT-025 Source Provider / Infra Provider Boundary

Source-provider entries under `runtime/catalog/source/providers/` 仅定义 source provider SSOT。
`nimillm`、`openai_compatible`、`volcengine_openspeech` 属于 runtime 基础设施 provider，只能在 runtime registry / routing 层存在，不得伪装成 source provider 能力声明。

## K-MCAT-027 Provider Runtime Metadata Projection

source provider 的非 scenario 元数据必须通过 source-provider entry 合并后的顶层 `runtime` 块维护，最少包括：

- `runtime_plane`
- `managed_connector_supported`
- `inline_supported`
- `default_endpoint`
- `requires_explicit_endpoint`
- `inventory_mode`

当 `inventory_mode=dynamic_endpoint` 时，source 还必须声明
`runtime.dynamic_inventory`，至少包括：

- `discovery_transport`
- `cache_ttl_sec`
- `selection_mode`
- `failure_policy`

provider 默认文本模型元数据只对 `inventory_mode=static_source` provider
继续由同一份 source provider SSOT 的 `defaults.default_text_model` 维护。

`runtime/internal/providerregistry/generated.go`、`tables/provider-catalog.yaml`、`tables/provider-capabilities.yaml` 都必须由该 source metadata 投影生成，禁止 spec 表反向充当 runtime endpoint/default endpoint/default text model 真相。

当 `inventory_mode=static_source` 且 source 已声明 `selection_profiles[text.general]` 时：

- reviewed text default truth 属于 `selection_profiles[text.general]`
- snapshot / registry `default_text_model` 只是 compatibility projection
- 过渡期允许 `defaults.default_text_model` 作为同值兼容字段保留
- 若 `selection_profiles[text.general]` 与 `defaults.default_text_model` 不一致，generator 与 freshness gate 都必须 fail-close

当 `inventory_mode=dynamic_endpoint` 时：

- snapshot / registry 仍必须投影 provider-level runtime metadata
- snapshot 可以不包含静态 `models`
- runtime `ListConnectorModels` 真相来自 live connector discovery，经
  source-authored dynamic inventory policy 过滤后返回
- `default_text_model` 与 `selection_profiles` 不再是 machine-default fallback
  truth
- 若 config `provider.defaultModel` 与 UI/route-selected live model 都缺失，
  runtime 必须 fail-close，并返回可执行 action hint

## Verification Anchors

- `K-MCAT-005` / `K-MCAT-006` / `K-MCAT-007`：`pnpm check:runtime-catalog-drift`、`pnpm check:runtime-provider-yaml-first-hardcut`
- `K-MCAT-018`：`pnpm check:runtime-video-capability-block-enforcement`
- `K-MCAT-022`：`pnpm check:runtime-provider-activation-alignment`
- `K-MCAT-024`：`pnpm check:runtime-provider-capability-token-canonicalization`
- `K-MCAT-027`：`pnpm check:runtime-provider-endpoint-ssot`
- `K-MCAT-030`：`pnpm check:runtime-selection-freshness`


---

<!-- source: .nimi/spec/runtime/kernel/model-catalog-voice-workflow-contract.md -->

# Runtime Model Catalog Voice And Workflow Contract

> Owner Domain: `K-MCAT-*`

Voice, speech, workflow, binding matrix, video, and capability vocabulary authority for Runtime model catalog.

This file is a semantic split from `model-catalog-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-MCAT-007 DashScope Voice Path

For DashScope TTS models, `ListPresetVoices` and TTS voice validation MUST be catalog-driven. OpenAI-compatible voice discovery endpoint probing MUST NOT be the primary resolution path.

## K-MCAT-010 DashScope First Rollout

Phase-1 mandatory coverage:

- `qwen3-tts-instruct-flash`
- `qwen3-tts-instruct-flash-2026-01-26`
- `qwen3-tts-flash` family entries

DashScope published voices for these models MUST be represented in `runtime/catalog/providers/dashscope.yaml`.

## K-MCAT-012 Synthesis Model Anchor

`models` 仅描述“可合成模型”能力。`audio.synthesize` 模型必须显式声明 `voice` 能力块：

- `discovery_mode`（`static_catalog|dynamic_user_scoped|mixed`）
- `supports_voice_ref_kinds`
- `voice_set_ref`（当 discovery 包含 `static_catalog` 通道时）
- `langs_ref`

## K-MCAT-013 Workflow Model Contract

`voice_workflow_models` 必须显式声明创建音色模型能力：

- `workflow_model_id`
- `workflow_type`（`voice_clone|voice_design`）
- `input_contract_ref`
- `output_persistence`
- `target_model_refs`
- `langs_ref`

若 `request_options.provider_extensions` 被声明，它只承载 extension
namespace/schema identity，用于 route describe / consumer-facing metadata
identity 投影。workflow extension 的具体 transport override key allowlist
（例如 endpoint/header/path 覆写键）不得在 source catalog 中升格为
canonical truth；若未来需要 source-authored key truth，必须另起 authority
cut。

## K-MCAT-014 Binding Matrix Contract

`model_workflow_bindings` 必须声明创建模型与合成模型兼容矩阵，禁止 provider 端隐式兼容关系。

`model_workflow_bindings` 也是 workflow -> target synthesis compatibility 的 authority home：

- workflow family 是否需要 target synthesis binding，必须由 binding truth 显式表达
- 若 binding truth 要求 target synthesis model，则 runtime `resolve / describe / checkHealth` 都必须显式消费该矩阵
- local/cloud 跨 plane 复用默认不成立；若要 admitted，必须由 authority 显式声明，而不是由 runtime/SDK/Desktop 猜测
- 当 local workflow execution 进入 first-family admission 时，binding truth 仍必须保持 family-scoped，而不是 generic `local speech` scoped：
  - baseline admitted family 当前固定为 `qwen3_tts`
  - 其 workflow binding 固定收敛到 admitted `Qwen3-TTS` synth/workflow line，而不是 generic `speech`
  - 其它 local workflow family（包括 `voxcpm`、`omnivoice`）不得因为共享 `speech` engine 或共享 workflow object truth 而被隐式视为 admitted

## K-MCAT-014a Desktop Local Speech Bundle Consumption

runtime catalog / local admission truth for baseline local speech 必须继续保持 family-scoped 与 row-scoped：

- `Qwen3-ASR` 仍是 admitted local `STT` family line
- `Qwen3-TTS` synth / workflow rows 仍是 admitted local `qwen3_tts` family line
- workflow binding truth 继续锚定在 admitted `Qwen3-TTS` synth/workflow line，而不是 generic `speech`

desktop 可以把这些 admitted rows 消费为 ordinary-user `Local Speech` bundle projection，但必须满足：

- bundle projection 只能读取/组合 runtime catalog truth 与 runtime-owned asset/service truth；不得新增第二套 bundle catalog、bundle row 或 generic local speech marketplace truth。
- `qwen3_asr` 与 `qwen3_tts` 不得因为 desktop bundle 语义而被压扁成单一 canonical install row。
- 显式 `Download`、env/bootstrap、host readiness、capability materialization 的 ordinary-user 产品语义必须服从 `K-LENG-*` 与 `K-LOCAL-*`；catalog 不得被 Desktop/Tauri helper 反向改写成 install truth owner。
- bundle projection 的 admitted scope 仍固定为 baseline local speech；不得借此把其它 speech family 或 generic speech marketplace 扩写为 canonical truth。

## K-MCAT-015 Dual Language Profile

source schema 必须支持双轨语言配置：

- 区域码（如 `zh-cn`）
- 短码（如 `zh`）

两者并存时不得自动映射，映射策略必须显式声明。

## K-MCAT-016 ElevenLabs Source Profile

ElevenLabs provider source 必须使用 schema v3，并满足以下最小结构：

- `models`：仅列出可用于 `audio.synthesize` 的模型，provider-global preset voices 必须以 `static_catalog` + `voice_set_ref` 方式枚举。
- `voice_workflow_models`：至少包含
  - `elevenlabs-voice-clone`（`workflow_type=voice_clone`，映射 `/v1/voices/add`）
  - `elevenlabs-voice-design`（`workflow_type=voice_design`，映射 `create-previews + create-voice-from-preview`）
- `model_workflow_bindings`：显式声明 workflow -> synthesis model 兼容矩阵。
- `voice_handle_policies`：默认 `provider_persistent + user_scoped`。

## K-MCAT-017 Dynamic User Voice Snapshot Minimality

当 `voice.discovery_mode` 为 `dynamic_user_scoped` 时，flattened snapshot 不得枚举 provider 全量动态用户音色。
生成产物仅允许输出最小占位 voice（如 `user-custom`），真实 custom voice 通过 runtime `ListVoiceAssets` 在线发现。

## K-MCAT-018 Video Capability Block Contract

当 model 声明 `video.generate` 能力时，`video_generation` 能力块必须包含：

- `modes`
- `input_roles`
- `limits`
- `options`
- `outputs`

其中 `modes` 最小支持集合为：

- `t2v`
- `i2v_first_frame`
- `i2v_first_last`
- `i2v_reference`

`input_roles` 是按 mode 建模的“允许角色集合” authority；它用于声明该 model 在对应 mode 下可接受的 canonical role token。
runtime 校验必须同时满足：

- mode 级最小必需角色约束（见 `K-MMPROV-024`）
- 请求中的每个实际 role 都属于该 mode 的 `input_roles` 允许集合
- provider/model 特定的数量上限由 `limits` 约束，而不是由 `input_roles` 的存在性隐式推断

`outputs` 必须显式声明 `video_url` 与 `last_frame_url` 可用性，不得依赖隐式 provider 文档推断。

## K-MCAT-019 Voice Optional for Video-Only Provider

对于仅提供视频能力（不含 `audio.synthesize`）的 provider：

- 不要求定义 `voice_set_id`
- 不要求定义 `voices[]`
- Runtime loader 与 consistency gate 不得因缺失 voice 映射而拒绝 catalog

## K-MCAT-023 TTS Provider Capability Matrix SSOT

`tables/tts-provider-capability-matrix.yaml` 是主流 TTS provider 运行平面（remote/local）与能力分层（synthesize/voice_clone/voice_design/timing/discovery mode）的结构化事实源。

## K-MCAT-024 Canonical Capability Vocabulary

source、snapshot、registry、resolver、scenario guard、live-provider checks 必须只使用以下 canonical capability token：

- `text.generate`
- `text.generate.vision`
- `text.generate.audio`
- `text.generate.video`
- `text.embed`
- `image.generate`
- `image.edit`
- `video.generate`
- `world.generate`
- `audio.synthesize`
- `audio.transcribe`
- `music.generate`
- `music.generate.iteration`
- `voice_workflow.voice_clone`
- `voice_workflow.voice_design`

`chat`、`embedding`、`image`、`tts`、`stt`、`video_generation`、`speech.synthesize`、`tts.synthesize`、`voice.clone`、`voice.design`、`llm.text.generate`、`llm.embed`、`llm.image.generate`、`llm.video.generate`、`llm.speech.synthesize`、`llm.speech.transcribe` 不得作为有效 capability 声明值继续存在于 source、snapshot、fixture、registry、resolver、scenario guard 或 live-provider checks 中。

local runtime 若仍使用 `chat` / `embedding` / `tts` 等本地 token，必须先通过 `tables/capability-vocabulary-mapping.yaml` 做 local → canonical 转换，再进入 source/snapshot/resolver/guard 语义面。

## K-MCAT-026 STT Modeling And Local Workflow Exclusion

`audio.transcribe` 只允许在已经完成 runtime 审核并具备真实执行路径的 source provider 上声明。
未完成审核的 source provider 必须 fail-close，不得通过 infra provider 语义隐式承接为“已支持”。

`local` 在 generic 本地 voice workflow execution plane 尚未 admitted 前，不得把 local workflow 声明成 generic green state。

例外：

- 当 authority 已通过独立规则显式 admitted first local workflow family 时，`local` 可以仅按该 family-scoped boundary 声明对应的：
  - `voice_workflow_models`
  - `model_workflow_bindings`
  - `voice_handle_policies`
  - 对应 workflow capability truth

约束：

- 该声明必须严格受 admitted family boundary 限定，不得被扩写成 generic local workflow success。
- 当前 first admitted local workflow family boundary 以 `K-VOICE-017` 为准。

对 local speech catalog row，`ready=true` 只允许在 admitted plain-speech proof 成立后出现；row capability 必须与 admitted capability truth 一致，non-ready row 或 placeholder row 不得被 route/model health 提升为 capability success。

## K-MCAT-028 Voice Handle Policy Contract

当 source provider 声明 `voice_workflow_models` 时，若该 workflow 可产出可复用 handle / asset truth，则 source 必须显式声明 `voice_handle_policies`。

`voice_handle_policies` 至少回答：

- `persistence`
- `scope`
- `default_ttl`
- `delete_semantics`
- `runtime_reconciliation_required`

未声明 `voice_handle_policies` 的 workflow-capable provider/family 不得被 source/snapshot 标记为 active。

## K-MCAT-029 Workflow Family Validation Discipline

workflow-capable speech family 的 source/catalog admission与验收必须保持 family-level discipline：

- workflow-capable TTS family 可同时覆盖 `audio.synthesize` 与 `voice_workflow.*`
- 但不得因此被当成 `audio.transcribe` 的替代验收对象

如果某一 speech family 不提供真实 STT execution path，则 source/snapshot/runtime validation 不得把该 family 的成功结果提升为 speech 全链路成功。

## K-MCAT-030 Reviewed Selection Profiles And Speech Option Metadata

source provider SSOT 可以声明两类受控扩展 truth：

1. provider-level `selection_profiles`
2. model-level `voice.request_options` / `transcription` / `embedding`
   / `image_request_options`

约束如下：

- `selection_profiles` 必须 source-authored、reviewed、并声明 `reviewed_at + freshness_sla_days`
- `selection_profiles` 只能引用同 provider 下已存在、且 capability 匹配的 model
- `voice.request_options` 只能出现在 `audio.synthesize` model 上
- `transcription` 只能出现在 `audio.transcribe` model 上
- `embedding` 只能出现在 `text.embed` model 上；`embedding.dimension` 是该 model 输出维度的 catalog 权威，供 runtime memory embedding profile 解析消费（`K-MEM-004`、`K-AIEXEC-006`）。它必须 source-authored，且只承载 model-inherent 的维度事实；distance_metric / migration_policy 属于 runtime memory-bank policy，不是 model catalog 事实，不在此声明。
- `image_request_options` 只能出现在 `image.generate` model 上，且必须表达 runtime canonical `ImageGenerateScenarioSpec` 的请求支持面：`response_formats`、`max_images_per_request`、`supports_negative_prompt`、`supports_reference_images`、`supports_mask`、`supports_seed`、`supports_size`、`supports_aspect_ratio`、`supports_quality`、`supports_style`。这些字段是 route describe producer 的唯一 image request metadata 来源；adapter raw payload、provider name、model label、Desktop 参数 UI 不得反向补造。
- runtime route describe metadata 只能单向派生自这些 source-authored fields，不得由 Desktop/SDK/provider live probing 生成第二份语义真相

## K-MCAT-031 Baseline Local Qwen Speech Freeze

baseline local live chat voice bundle 的 source/catalog freeze 固定如下：

- default local `STT` lane:
  - `Qwen3-ASR-0.6B`
- optional premium `STT` candidate:
  - `Qwen3-ASR-1.7B`
  - 但在独立 premium admission 前继续保持 deferred，不得自动视为已 admitted
- default local plain synth lane:
  - `Qwen3-TTS-12Hz-0.6B-CustomVoice`
- default local clone workflow lane:
  - `Qwen3-TTS-12Hz-0.6B-Base`
- default local design workflow lane:
  - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`

约束：

- 上述 freeze 是 baseline admitted default mapping，而不是 generic `Qwen3`
  family 自动覆盖规则
- local source/snapshot/binding truth 必须显式表达 plain synth / clone /
  design 三者的 subrole，不得只写成一个模糊的 `qwen3-tts` bucket
- baseline local install/bootstrap truth 必须显式允许 split env topology：
  `Qwen3-TTS` synth/workflow line 与 `Qwen3-ASR` line 不得被隐式压成一个 shared
  canonical Python env
- cloud plain `TTS` 是否同步迁移到 `qwen3-tts-*` 不属于本规则自动推出的结果；
  若要调整，必须由独立 reviewed source/default truth 显式声明


---

<!-- source: .nimi/spec/runtime/kernel/voice-contract.md -->

# Voice Contract

> Owner Domain: `K-VOICE-*`

## K-VOICE-000 Runtime Target Identity v2 Hard Cut

Voice execution consumes v2 target refs or resolved binding inputs. Raw
`model_id` and `target_model_id` may remain only as post-resolve provider or
voice asset compatibility facts and must not mint durable target refs.

## K-VOICE-001 Scope

Voice 是 Runtime 一等能力，负责 Voice 创建场景与 voice 资产生命周期：

- `voice_clone`（voice/audio -> voice）
- `voice_design`（text -> voice）

Voice 创建必须通过 Scenario 抽象统一执行：

- `SubmitScenarioJob` + `scenario_type=VOICE_CLONE`
- `SubmitScenarioJob` + `scenario_type=VOICE_DESIGN`

provider 私有参数不得自由透传；必须走 namespaced `ScenarioExtension` 并受 extension registry 约束。

## K-VOICE-002 Workflow Type Registry

Voice 工作流类型以 `tables/voice-enums.yaml` `workflow_types` 为唯一事实源。

## K-VOICE-003 VoiceReference Contract

语音合成入口必须通过 `VoiceReference` 表达，且仅允许三种引用来源：

- `preset_voice_id`
- `voice_asset_id`
- `provider_voice_ref`

引用类型以 `tables/voice-enums.yaml` `reference_kinds` 为事实源。

公共绑定面（ordinary profile binding / SDK input / app-facing surface）只允许
`preset_voice_id` 或 `voice_asset_id`。`provider_voice_ref` 仅限 Runtime 内部、
明确 privileged、或 debug 面消费，不得作为 ordinary assistant 语音的公共绑定输入。
ordinary profile/SDK input 若收到裸 `provider_voice_ref` 或未显式判别的自由字符串
音色引用，必须 fail-close，不得静默升格为公共 provider handle 绑定。此限制与
`K-VOICE-014`（runtime-owned asset truth vs provider-owned handle truth）同源。

`VoiceReference` may be embedded by runtime-owned `AgentPresentationProfile` as a default voice binding. That reuse does not transfer voice workflow, discovery, or asset ownership out of `K-VOICE-*`.

## K-VOICE-004 VoiceAsset Contract

`VoiceAsset` 是 runtime-managed voice resource object，最小必填字段：

- `voice_asset_id`
- `app_id`
- `subject_user_id`
- `workflow_type`
- `provider`
- `target_ref`
- `voice_asset_target_ref`
- `provider_voice_ref`
- `persistence`
- `status`

`persistence` 取值以 `tables/voice-enums.yaml` `persistence_types` 为事实源。
`status` 取值以 `tables/voice-enums.yaml` `asset_statuses` 为事实源。

`target_ref` 与 `voice_asset_target_ref` 是 durable v2 target identity，取 `K-RTARGET-002`
/ `K-RTARGET-008` grammar。`VoiceAsset` 的 durable identity 由 `voice_asset_id` +
`voice_asset_target_ref` 承担，不得由 `model_id` / `target_model_id` 充当。若
`model_id` / `target_model_id` 出现，只能是 post-resolve provider / catalog / audit /
voice asset compatibility 的 `allowed_non_identity_fact`，并必须受守卫，不得 mint 或
persist durable target ref（见 `K-VOICE-000`）。

`VoiceAsset` 的 `persistence` 只表达逻辑生命周期与 handle policy，不自动承诺 runtime 已拥有 durable local substrate。
在 durable local substrate 被单独 admitted 前，local-generated `VoiceAsset` 允许保持 session-local orchestration object 语义。

Durability boundary（profile binding 前置条件）：

- 被 assistant profile 通过 `VoiceReference(voice_asset_id)` 绑定的 `VoiceAsset`
  必须具备 durable persistence class，且必须能在其创建来源 voice-workflow
  `ScenarioJob` 的终态 retention 被 prune 后继续存活（`VoiceAsset` 生命周期与
  voice workflow job retention 解耦）。
- 未 admitted durable local substrate 前，`persistence = session_ephemeral` 的
  local-generated `VoiceAsset` 不是 profile-bindable durable identity；把它作为
  ordinary assistant profile 的持久绑定必须 fail-close，而不是伪装成 durable。
- 具体 persistence class 的 cross-restart 行为、delete 语义与 provider handle
  cleanup 由 `K-VOICE-015` `voice_handle_policy` 与 `K-RPC-022` `DeleteVoiceAsset`
  边界共同约束。

## K-VOICE-005 Voice ScenarioJob Lifecycle

Voice 创建必须使用异步 `ScenarioJob` 语义。状态机与事件流对齐规则以 `K-JOB-002` 为唯一事实源；Voice 不在本合同重复定义一份并行 job 状态表。

## K-VOICE-006 Tenant Isolation

VoiceAsset 默认 user-scoped。跨 `app_id` 或跨 `subject_user_id` 访问必须 fail-close，禁止跨租户泄露。

## K-VOICE-007 Target Model Binding

VoiceAsset 在创建时必须绑定 `voice_asset_target_ref`。

`tts_synthesize` 阶段若请求 target ref 与已绑定 `voice_asset_target_ref` 不一致，必须返回 `AI_VOICE_TARGET_MODEL_MISMATCH`。

## K-VOICE-008 AIService Voice Surface

Voice 对外 RPC 面已收归 `AIService`（proto `RuntimeAiService`），方法集合固定为：

1. `SubmitScenarioJob`（`VOICE_CLONE` / `VOICE_DESIGN`）
2. `GetScenarioJob`
3. `CancelScenarioJob`
4. `SubscribeScenarioJobEvents`
5. `GetVoiceAsset`
6. `ListVoiceAssets`
7. `DeleteVoiceAsset`
8. `ListPresetVoices`

`RuntimeVoiceService` 不是公共契约面，不得在 spec 中定义为独立服务。

## K-VOICE-009 Dual Discovery Channel

Voice 发现必须分离两条通道：

- 系统预置音色：`ListPresetVoices`
- 用户自定义音色：`ListVoiceAssets`

调用方不得依赖单一接口混合系统音色与用户音色。

## K-VOICE-010 Fail-Close Error Model

Voice 相关输入、工作流、资产状态、权限与作业状态错误必须映射到 `AI_VOICE_*` ReasonCode 族，并遵循 fail-close。

## K-VOICE-011 Provider Native Multi-Step Workflow Encapsulation

provider 原生两段式创建流程（例如 `preview -> create`）必须封装在单一 `ScenarioJob` 生命周期中对外暴露。

调用方只感知统一状态机与统一结果：

- 输入：`SubmitScenarioJob`（`scenario_type=VOICE_CLONE|VOICE_DESIGN`）
- 事件：`SubscribeScenarioJobEvents`
- 输出：`VoiceAsset` + `VoiceReference`

不得将 provider 内部步骤泄露为额外公共 RPC。

## K-VOICE-012 Preset Voice Metadata Compatibility

`ListPresetVoices` 结果应支持跨 provider 的可选元数据扩展（如标签、分类、试听地址）。  
缺失元数据时必须保持字段可省略，不得因 provider 无该字段而拒绝返回预置音色列表。

## K-VOICE-013 Discovery Mode Responsibility Boundary

Catalog `voice.discovery_mode` 与发现接口职责必须严格对应：

- `static_catalog`：预置音色发现由 `ListPresetVoices` 承担，返回值来自 YAML catalog snapshot 或显式本地 custom YAML。
- `dynamic_user_scoped`：用户资产发现由 `ListVoiceAssets` 承担。
- `mixed`：provider 同时暴露预置音色与用户资产，两条发现通道都必须可用，但仍由调用方分别调用 `ListPresetVoices` 与 `ListVoiceAssets`。

provider 同时支持全局预置与用户资产时，允许同时暴露两条通道，但不得混流返回。

## K-VOICE-014 Runtime-Owned Asset Truth vs Provider-Owned Handle Truth

`VoiceAsset` 与 `provider_voice_ref` 必须严格分离：

- `VoiceAsset`：runtime-owned object truth
- `provider_voice_ref`：provider-owned native handle truth

二者不得互相替代：

- runtime 不得把 `provider_voice_ref` 升格成公共主键或公共资产真相
- provider 也不得绕过 `VoiceAsset` 直接成为 runtime 用户资产主对象

当 provider 返回 native custom voice handle 时，runtime 必须将其收敛到 `VoiceAsset + VoiceReference` 公共契约中对外暴露。

## K-VOICE-015 Voice Handle Policy Minimum Contract

workflow-capable voice family 一旦 admitted，必须显式声明 `voice_handle_policy`。

`voice_handle_policy` 最小字段固定为：

- `persistence`
- `scope`
- `default_ttl`
- `delete_semantics`
- `runtime_reconciliation_required`

其中：

- `persistence` 继续取值于 `tables/voice-enums.yaml` `persistence_types`
- `scope` 取值于 `tables/voice-enums.yaml` `handle_scopes`
- `delete_semantics` 取值于 `tables/voice-enums.yaml` `delete_semantics`

未声明 `voice_handle_policy` 的 workflow-capable family 不得被 admitted。

## K-VOICE-016 Family-Level Workflow Validation Boundary

workflow-capable speech family 的验收必须保持 family-level 边界，不得把不同 family 的 truth 混为一次“模型全绿”：

- workflow-capable local speech family（例如当前 baseline 规划线的
  `qwen3_tts`，或后续可能 admitted 的其它 family）可用于验证：
  - `audio.synthesize`
  - `voice_workflow.voice_design`
  - `voice_workflow.voice_clone`
- 但它们不得被当作 `audio.transcribe` 的替代验收对象

`audio.transcribe` 必须继续通过独立 STT family 的 admitted truth 验证，禁止以 workflow-capable TTS family 的成功结果隐式覆盖 STT readiness。

## K-VOICE-017 First Admitted Local Workflow Family Boundary

当 local workflow execution plane 首次进入 admitted 状态时，必须保持 family-scoped admission，而不是 generic local workflow green-light。

当前 first admitted local workflow family 边界固定为：

- `workflow_family = qwen3_tts`
- baseline local admitted synth / workflow line 固定收敛到同一
  `Qwen3-TTS` family，而不是 generic `local speech`
- admitted local checkpoint mapping 固定为：
  - plain synth default lane:
    - `Qwen3-TTS-12Hz-0.6B-CustomVoice`
  - clone workflow default lane:
    - `Qwen3-TTS-12Hz-0.6B-Base`
  - design workflow default lane:
    - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- admitted workflow types 仅限：
  - `voice_clone`
  - `voice_design`

边界要求：

- `qwen3_tts` 的 admitted success 不得被解释为 generic `local` workflow success
- 其它 local workflow family（包括历史讨论过的 `voxcpm`、`omnivoice`）不在 baseline admitted 范围内，必须继续 fail-close，直到后续独立 admission
- local generated workflow handle 在 baseline admission 中继续保持：
  - `persistence = session_ephemeral`
  - `delete_semantics = runtime_authoritative_delete`
  - `runtime_reconciliation_required = false`
- baseline admission 不承诺 durable local `VoiceAsset` substrate，不得把 local generated handle 升格为跨重启 durable truth
- `audio.transcribe` 继续由独立 `STT` family 负责；当前 baseline default `STT`
  family 固定为 `Qwen3-ASR`，不得由 `qwen3_tts` workflow success 隐式覆盖

## K-VOICE-018 Agent Voice Output Policy

Agent voice output is Runtime-owned presentation policy whose AI consume intent
comes from Runtime Agent AI Config and whose stream/artifact execution belongs
to Runtime voice. Desktop, Zhiyu, and Avatar may render controls and consume
projections, but they must not decide provider route, model binding, voice
workflow choice, or whether a committed assistant message has voice semantics.

Minimum policy fields:

- `avatar_autoplay`: per-agent boolean persisted only on Runtime
  `AgentPresentationProfile`. When false, Avatar must remain text / expression /
  activity only for ordinary assistant turns.
- `desktop_autoplay`: fixed false for Desktop Agent Chat unless a later Desktop
  authority admits a user-facing setting. Desktop manual play is an explicit user
  request, not autoplay.
- `default_voice_reference`: agent-owned `VoiceReference` used by ordinary speech
  synthesis.
- `audio.synthesize` intent: Runtime Agent AI Config-owned TTS model route.
- `speech_route_policy`: local/cloud/unspecified route intent projected from
  Runtime Agent AI Config.
- `voice_artifact_retention`: durable local retention with user cleanup for
  generated turn audio.

Fixed rules:

- Runtime must not emit playable voice projection for an ordinary assistant
  message unless the effective playback target is admitted by policy and the
  speech route resolves to playable audio.
- Missing TTS model, missing/default voice reference, unhealthy route, provider
  failure, or unavailable voice workflow must complete the agent turn as normal
  text-only output unless another hard turn error exists.
- Text-only fallback must not emit fake `voice_playback_requested` success and
  must not materialize synthetic non-audio bytes under an audio artifact id.
- Runtime Agent AI Config owns `voice_workflow.voice_clone` /
  `voice_workflow.voice_design` intent. Runtime voice may create or update a
  `VoiceAsset` / `VoiceReference`, but ordinary assistant speech uses
  `audio.synthesize` with the effective `VoiceReference` unless a future runtime
  authority admits a provider-specific combined workflow.
- Voice identity follows the agent profile. Avatar asset, Avatar instance, and
  Desktop chat surface are projection layers and must not own voice identity.
- Agent Center hosts must not persist or mutate `voice.avatar_autoplay` in
  app-local or Kit-local config; controls write `AgentPresentationProfile`
  through the Runtime mutation surface.

## K-VOICE-019 Agent Voice Streaming And Interruption

Runtime owns voice stream lifecycle for active agent turns.

### Three-axis truth model

Agent voice must be described by three orthogonal axes. No axis may absorb
another.

- `execution_mode` (`ai.proto` `ExecutionMode`): `sync | stream | async_job`.
  This is transport/execution shape only.
- `voice_output_mode` (`tables/voice-enums.yaml` `output_modes`):
  `native_stream | simulated_stream | batch_final_artifact | text_only`. This is
  the positive, authoritative selected output-truth. A consumer must read this
  field, not infer realtime from event shape.
- `voice_playback_state` (`tables/voice-enums.yaml` `playback_states`):
  `active | completed | failed | interrupted | canceled`. This is the playback
  lifecycle axis.

Fixed rules:

- `voice_output_mode` is the single authoritative output-mode field. `failed`,
  `interrupted`, and `canceled` are `voice_playback_state` values and must never
  be encoded as `voice_output_mode`.
- Realtime acceptance requires positive `voice_output_mode = native_stream`.
  Absence of a boolean, or `stream_simulated = false` alone, is insufficient.
- `native_stream` means the provider/route emits playable non-final audio before
  full synthesis completion. Slicing a completed payload into chunks is
  `simulated_stream`, not native.
- `simulated_stream` must be positively marked as `voice_output_mode =
  simulated_stream`. Where the underlying scenario stream sets the compatibility
  boolean `stream_simulated = true` (`ai.proto` `ScenarioStreamCompleted`) or the
  local-engine audit tag `stream_fallback_simulated` (`K-LENG-011`), those remain
  compatibility metadata / audit tags only and must never be the primary realtime
  acceptance truth.
- `batch_final_artifact` and `text_only` are non-stream output modes.
  `text_only` must not emit a playable voice request or synthesize fake audio
  bytes (see `K-VOICE-018`).

### Identity and data plane

- Voice stream identity must stay tied to the same `agent_id`,
  `conversation_anchor_id`, `turn_id`, `stream_id`, and committed `message_id` as
  the text turn.
- Native realtime chunks use an admitted typed SDK voice-stream transport for
  transient non-final audio chunks. The current admitted Runtime data-plane is
  `RuntimeAgentService.SubscribeAgentVoiceStream`, surfaced by SDK as a typed
  agent voice stream consumer. Raw audio bytes must not be embedded directly in
  Runtime Agent app messages or presentation projection events; consumers read
  chunk bytes through that admitted streaming transport or Runtime artifact.
- Voice playback interruption uses
  `RuntimeAgentService.InterruptAgentVoicePlayback`. The command targets an
  active `voice_stream_id` and must cancel the provider stream / transient
  broker, then emit `runtime.agent.presentation.voice_playback_terminal` with
  `voice_playback_state = interrupted` while preserving
  `voice_output_mode = native_stream`. It must not be represented by local
  playback stop alone or by `runtime.agent.turn.interrupted`.
- Exactly one final durable audio artifact is persisted for replay/export when a
  voice stream completes successfully; it is owned by `RuntimeArtifactService`
  (`K-AGCORE-053`). Per-chunk durable artifact ids are NOT the default and require
  a separately admitted retention / cleanup / retrieval authority before use;
  until then Runtime must not mint one durable artifact per chunk.
- The final replay artifact must be `audio/*` with non-empty bytes and must obey
  the `ReadArtifactBytes` 32 MiB inline retrieval cap; oversized replay fails
  closed with `ARTIFACT_TOO_LARGE` unless chunked retrieval is separately admitted
  (`K-AGCORE-053`).

### Realtime-session boundary

- Ordinary agent custom-voice speech output is a scenario-layer `audio.synthesize`
  streaming path. It must not be produced by driving `RuntimeAiRealtimeService`
  directly as agent voice output. `RealtimeAudioChunk` (`ai_realtime.proto`) is a
  realtime-session field only and is not the agent voice stream chunk field or the
  scenario-stream delta field (`K-MMPROV-031`, `K-STREAM-004`).

### Interruption

- Runtime cancellation of an active turn must cancel the LLM stream, the TTS
  stream, queued voice chunks, and terminal playback projection as one accepted
  interruption truth, projected as `voice_playback_state = interrupted` while
  preserving the selected `voice_output_mode`.
- Voice-playback interruption is distinct from chat-turn interruption
  (`runtime.agent.turn.interrupted`); the latter alone does not prove voice
  playback was interrupted.
- Avatar interrupt is a request to Runtime. Avatar must not locally synthesize
  successful interruption; it may only stop local playback in response to
  Runtime terminal projection or an accepted Runtime cancellation response.

## K-VOICE-020 Durable Agent Voice Artifacts

Generated assistant voice audio is a Runtime artifact retained on the user's
local disk until explicit user cleanup or a future admitted quota policy removes
it.

Required metadata for generated agent voice artifacts:

- `agent_id`
- `conversation_anchor_id`
- `turn_id`
- `message_id`
- `voice_reference`
- `speech_model_id`
- `route_policy`
- `mime_type`
- `byte_digest`
- `created_at`
- `retention_scope`

Cleanup must be Runtime-owned and must support at least:

- delete generated voice artifacts by `agent_id`
- delete generated voice artifacts by `conversation_anchor_id`

Avatar must not own durable voice cache state. Desktop may expose cleanup UI, but
the cleanup action must call the Runtime-owned artifact/voice cleanup surface.

## K-VOICE-021 Reserved Third-Party Voice Boundary

No Runtime Agent voice operation is admitted on the third-party
`local_app_host` transport. `agents.interact` is a reserved public permission,
so a local-app session, manifest declaration, agent identifier, or app-owned
command cannot authorize transcription, voice-stream subscription, generic AI
execution, route selection, or provider selection.

The retired local-app-only transcription RPC is absent. The existing
`SubscribeAgentVoiceStream` RPC remains available only to its protected or
scoped first-party consumers. A future third-party voice slice must atomically
admit the public permission, typed SDK operation, Runtime owner policy, bounded
selector rules, shell carrier projection, revocation behavior, and product UX
under P-PERM-017; it must not restore fine-grained `runtime.agent.voice.*`
permission strings or a generic Runtime proxy.


---

<!-- source: .nimi/spec/runtime/kernel/workflow-contract.md -->

# Workflow Contract

> Owner Domain: `K-WF-*`

## K-WF-000 Runtime Target Identity v2 Hard Cut

AI workflow node configs consume v2 durable target refs or resolved binding
inputs. Raw `model_id`, `target_model_id`, and `connector_id + model_id` are
not durable workflow target identity. Any retained provider/model fields are
post-resolve non-identity facts.

## K-WF-001 WorkflowDefinition 结构

工作流定义为有向无环图（DAG）：

- `workflow_type`：工作流类型标识。
- `nodes`：节点列表（`repeated WorkflowNode`）。
- `edges`：边列表（`repeated WorkflowEdge`），定义节点间数据流。

`WorkflowEdge` 字段：`from_node_id`、`from_output`、`to_node_id`、`to_input`。

节点通过 `depends_on`（repeated string）声明前置依赖，执行引擎据此进行拓扑排序。

## K-WF-002 WorkflowNode 类型（事实源：`tables/workflow-node-types.yaml`）

节点类型固定 15 种，分三类：

**AI 节点（执行 AI 推理）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `AI_GENERATE` | 1 | `AiGenerateNodeConfig` | target_ref, modal, system_prompt, tools, temperature, top_p, max_tokens, route_policy, fallback, timeout_ms, prompt |
| `AI_STREAM` | 2 | `AiStreamNodeConfig` | 同 AI_GENERATE |
| `AI_EMBED` | 3 | `AiEmbedNodeConfig` | target_ref, route_policy, fallback, timeout_ms, inputs |
| `AI_IMAGE` | 4 | `AiImageNodeConfig` | target_ref, route_policy, fallback, timeout_ms, prompt |
| `AI_VIDEO` | 5 | `AiVideoNodeConfig` | target_ref, route_policy, fallback, timeout_ms, prompt |
| `AI_TTS` | 6 | `AiTtsNodeConfig` | target_ref, route_policy, fallback, timeout_ms, text |
| `AI_STT` | 7 | `AiSttNodeConfig` | target_ref, mime_type, route_policy, fallback, timeout_ms, audio_bytes |
| `AI_TTS_CREATE_VOICE` | 8 | `AiTtsCreateVoiceNodeConfig` | target_ref, voice_asset_target_ref, workflow_type, timeout_ms, input(source text/audio) |
| `AI_TTS_SYNTHESIZE` | 9 | `AiTtsSynthesizeNodeConfig` | target_ref, voice_asset_target_ref, text, voice_ref, timeout_ms, audio options |

**Transform 节点（数据变换）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `TRANSFORM_EXTRACT` | 20 | `ExtractNodeConfig` | json_path, source_input |
| `TRANSFORM_TEMPLATE` | 21 | `TemplateNodeConfig` | template, output_mime_type |
| `TRANSFORM_SCRIPT` | 22 | `ScriptNodeConfig` | runtime, code, timeout_ms, memory_limit_bytes |

**Control 节点（流程控制）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `CONTROL_BRANCH` | 40 | `BranchNodeConfig` | condition, true_target, false_target |
| `CONTROL_MERGE` | 41 | `MergeNodeConfig` | strategy, min_completed |
| `CONTROL_NOOP` | 42 | `NoopNodeConfig` | （空） |

节点类型通过 `oneof type_config` 承载，运行时必须校验 `node_type` 与 `type_config` 分支的一致性。

AI 节点执行面必须通过 Scenario 调度统一落地（实现可封装在兼容层，但对外语义必须保持 Scenario 一致）：

- `AI_GENERATE`/`AI_STREAM` -> `TEXT_GENERATE`
- `AI_EMBED` -> `TEXT_EMBED`
- `AI_IMAGE` -> `IMAGE_GENERATE`
- `AI_VIDEO` -> `VIDEO_GENERATE`
- `AI_TTS` -> `SPEECH_SYNTHESIZE`
- `AI_STT` -> `SPEECH_TRANSCRIBE`
- `AI_TTS_CREATE_VOICE` -> `VOICE_CLONE`/`VOICE_DESIGN`（由 `workflow_type` 判定）

## K-WF-003 Workflow 状态机（事实源：`tables/workflow-states.yaml`）

| 状态 | 值 | 含义 |
|---|---|---|
| `ACCEPTED` | 1 | 已接受 |
| `QUEUED` | 2 | 排队中 |
| `RUNNING` | 3 | 执行中 |
| `COMPLETED` | 4 | 成功完成 |
| `FAILED` | 5 | 失败 |
| `CANCELED` | 6 | 已取消 |
| `SKIPPED` | 7 | 已跳过 |

终态：`COMPLETED`、`FAILED`、`CANCELED`、`SKIPPED`。

## K-WF-004 事件流协议

`SubscribeWorkflowEvents` 返回 `stream WorkflowEvent`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_type` | WorkflowEventType | 事件类型 |
| `sequence` | uint64 | 单调递增序号 |
| `task_id` | string | 工作流任务 ID |
| `trace_id` | string | 追踪 ID |
| `timestamp` | Timestamp | 事件时间 |
| `node_id` | string | 节点 ID（节点级事件） |
| `progress_percent` | int32 | 进度百分比（0-100） |
| `reason_code` | ReasonCode | 结果码（失败/完成事件） |
| `payload` | Struct | 扩展数据 |

WorkflowEventType 枚举（12 种）：

1. `STARTED` — 工作流启动
2. `NODE_STARTED` — 节点开始执行
3. `NODE_PROGRESS` — 节点进度更新
4. `NODE_COMPLETED` — 节点完成
5. `NODE_SKIPPED` — 节点跳过
6. `COMPLETED` — 工作流完成
7. `FAILED` — 工作流失败
8. `CANCELED` — 工作流取消
9. `NODE_EXTERNAL_SUBMITTED` — 外部节点已提交
10. `NODE_EXTERNAL_RUNNING` — 外部节点执行中
11. `NODE_EXTERNAL_COMPLETED` — 外部节点完成
12. `NODE_EXTERNAL_FAILED` — 外部节点失败

终态事件后 server 正常关闭流（K-STREAM-008 模式 B）。
若节点为 `AI_TTS_CREATE_VOICE`，`NODE_COMPLETED` payload 必须可携带 `voice_asset_id` 供后续节点消费。

## K-WF-005 执行模式

| 模式 | 值 | 含义 |
|---|---|---|
| `INLINE` | 1 | 节点在 workflow 进程内同步执行 |
| `EXTERNAL_ASYNC` | 2 | 节点委托给外部系统异步执行，通过 `callback_ref` 回调。`callback_ref` 协议（URL 格式、认证、重试、幂等性）在 Phase 2 后期定义，初始实现仅需支持 `INLINE` 模式 |

## K-WF-006 节点级状态追踪

`WorkflowNodeStatus` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `node_id` | string | 节点 ID |
| `status` | WorkflowStatus | 节点状态（复用 workflow 状态枚举） |
| `attempt` | int32 | 当前尝试次数 |
| `reason` | string | 状态原因 |
| `provider_job_id` | string | 外部 Provider 作业 ID |
| `next_poll_at` | Timestamp | 下次轮询时间（外部异步） |
| `retry_count` | int32 | 已重试次数 |
| `last_error` | string | 最近错误 |

## K-WF-007 取消语义

`CancelWorkflow` 为异步请求：

- 请求成功返回 `Ack{ok=true}` 仅表示取消请求已接受。
- 实际取消在执行引擎下一个检查点生效。
- 已进入终态的节点不可取消。
- 取消完成后触发 `CANCELED` 事件。

## K-WF-008 重试配置

节点级重试通过 `WorkflowNode` 字段配置：

- `retry_max_attempts`：最大重试次数（0 = 不重试）。
- `retry_backoff`：退避策略字符串（如 `2s`、`exponential`）。

## K-WF-009 MergeStrategy

`MergeNodeConfig.strategy` 控制汇聚行为：

| 策略 | 含义 |
|---|---|
| `ALL` | 所有上游节点完成后触发 |
| `ANY` | 任一上游节点完成即触发 |
| `N_OF_M` | `min_completed` 个上游完成即触发 |

## K-WF-010 SubmitWorkflow 约束

- `app_id` 必填。
- `definition` 必须包含至少一个节点。
- 节点 DAG 不得有环。
- `timeout_ms` 为整个工作流的总超时。
- 返回 `task_id`（ULID）和 `accepted` 标记。

## K-WF-011 ResumeStrategy

节点恢复策略（外部异步模式适用）：

| 策略 | 含义 |
|---|---|
| `AUTO` | 外部完成后自动继续后续节点 |
| `MANUAL` | 外部完成后等待手动触发继续 |

## K-WF-012 消费契约要求

### Cross-Domain Dependencies

- SDK 方法投影缺口由 `.nimi/spec/sdks/kernel/runtime-contract.md` 的 `S-RUNTIME-023` 记录。
- Desktop 侧当前没有对应 Workflow consumer surface。DataSync facade is non-admitted by `D-DSYNC-000~013`; Workflow 消费面必须通过 SDK 方法投影、Desktop UI spec、以及 admitted Runtime bridge/streaming contracts 定义，不得创建 Desktop DataSync flow。

Workflow 服务的跨域消费契约状态：

| 消费层 | 当前状态 | Phase 2 启动前必须 |
|---|---|---|
| **SDK 方法投影** | Phase 2 deferred（S-RUNTIME-023） | 创建 SDK 方法投影（SubmitWorkflow、GetWorkflow、CancelWorkflow、SubscribeWorkflowEvents），定义 gRPC→SDK 参数映射和错误投影 |
| **Desktop UI Spec** | 完全缺失 | 创建 Workflow UI spec，至少定义：(1) 工作流执行状态面板（K-WF-003 状态机映射到 UI 状态）；(2) 节点级进度显示（K-WF-004 NODE_PROGRESS 事件消费）；(3) 取消操作 UI（K-WF-007 异步取消的用户反馈） |
| **Desktop Workflow Consumer** | 无 Workflow 消费面 | 创建 Desktop Workflow UI/runtime bridge consumer contract，定义事件订阅、状态投影和取消交互；不得创建 Desktop DataSync flow |

> **设计完整性注意**：K-WF-001~011 共 11 条规则已定义完整的执行模型，但无任何消费方。Runtime 实现完成后，功能不可交付直到 SDK 和 Desktop 消费契约就绪。

