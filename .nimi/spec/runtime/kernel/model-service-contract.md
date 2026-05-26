# Model Service Contract

> Owner Domain: `K-MODEL-*`

## K-MODEL-001 ModelDescriptor 结构

`ModelDescriptor` 表示 runtime 级模型注册信息。除基础字段外，runtime 必须暴露 runtime-native 本地模型元数据：

| 字段 | 类型 | 说明 |
|---|---|---|
| `model_id` | string | 模型唯一标识 |
| `version` | string | 版本 |
| `status` | `ModelStatus` | 模型状态 |
| `capabilities` | repeated string | 能力列表 |
| `last_health_at` | `Timestamp` | 最近健康检查时间 |
| `capability_profile` | `ModelCapabilityProfile` | 结构化能力画像 |
| `logical_model_id` | string | 逻辑模型 ID；passive asset 可为空，且不得作为 passive asset 文件路径真相 |
| `family` | string | 模型家族 |
| `artifact_roles` | repeated string | 解析后的 artifact 角色集合 |
| `preferred_engine` | string | 首选执行引擎，值域固定为 `llama` / `media` / `speech` / `sidecar` |
| `fallback_engines` | repeated string | 允许的 public fallback 引擎集合；不得暴露 `media.diffusers` 之类的 runtime 内部 driver |
| `bundle_state` | `LocalBundleState` | resolved bundle 状态 |
| `warm_state` | `LocalWarmState` | 预热状态 |
| `host_requirements` | `LocalHostRequirements` | 主机侧硬要求 |

## K-MODEL-002 Model 状态枚举

| 状态 | 值 | 含义 |
|---|---|---|
| `INSTALLED` | 1 | 已安装/已注册 |
| `PULLING` | 2 | 下载或解析中 |
| `FAILED` | 3 | 失败 |
| `REMOVED` | 4 | 已移除 |

## K-MODEL-003 ModelCapabilityProfile

`ModelCapabilityProfile` 继续作为能力摘要：

- `supports_text_generate`
- `supports_text_stream`
- `supports_embedding`
- `supports_image_generation`
- `supports_video_generation`
- `supports_speech_synthesis`
- `supports_speech_transcription`
- `supports_async_media_job`
- `supports_streaming`

该 profile 是摘要视图；runnable asset 的本地执行真相由 `logical_model_id + artifact_roles + preferred_engine + bundle_state + warm_state` 组合给出。passive asset 的路径真相由已安装 manifest (`source.repo=file://.../asset.manifest.json`) 与 `entry` 给出，`logical_model_id` 不参与路径解析。

## K-MODEL-004 RuntimeModelService 方法集合

`RuntimeModelService` 方法固定为：

1. `ListModels`
2. `PullModel`
3. `RemoveModel`
4. `CheckModelHealth`

## K-MODEL-005 PullModel 约束

- `app_id` 必填。
- `model_ref` 必填。
- `source` 可选。
- `digest` 可选。
- 返回 `task_id` + `accepted` + `reason_code`。
- 当目标为 runnable 本地 native model 时，runtime 在进入 `INSTALLED` 前必须完成最小的 logical model 元数据推导，至少写出 `logical_model_id`、`preferred_engine`、`bundle_state` 与 `warm_state`。passive asset 必须写出 `preferred_engine`、`bundle_state` 与 `warm_state`；不得从 `asset_id` 自动合成 `logical_model_id`。

## K-MODEL-006 CheckModelHealth 响应

- `healthy`：布尔健康状态。
- `reason_code`：失败原因。
- `action_hint`：建议操作。

对本地 native model，健康判断至少需要同时考虑：

- `bundle_state`
- `warm_state`
- 目标 engine 的真实 probe

仅凭“模型条目存在”或“进程可达”不得视为 healthy。

对本地 native model，`warm_state` 的投影规则还必须满足：

- `COLD` 表示“当前未加载/未预热”，属于 not-ready，不等于 unavailable
- `WARMING` 表示正在建立 ready 证明，属于 not-ready，不等于 unavailable
- `FAILED` 才表示最近一次 warm/load 失败
- 仅当 `warm_state=FAILED`、`bundle_state` 非 ready、或目标 engine / target probe 证明真实失败时，才允许投影为 unavailable / unhealthy

## K-MODEL-007 与 RuntimeLocalService 的关系

`RuntimeModelService` 提供统一视图，`RuntimeLocalService` 提供本地执行细节：

| 维度 | RuntimeModelService | RuntimeLocalService |
|---|---|---|
| 抽象层次 | 统一模型视图 | 本地执行/安装/生命周期细节 |
| 管理对象 | local + remote 模型 | 仅本地 logical model、artifact、service |
| 关注点 | capability 与 runtime-native 模型元数据 | install、bundle、health、warm、service |

数据流关系：

- `InstallVerifiedAsset` 成功后，本地模型必须同步反映到 `RuntimeModelService` 统一视图。
- `RuntimeModelService.ListModels` 是 Desktop/SDK 的统一模型目录入口。
- local model center、artifact intake、transfer/lifecycle 等本地模型管理 UI 可以并且应当直接依赖 `RuntimeLocalService`，而不是经 desktop host 维护第二套本地状态。
- `ListLocalAssets` / `ListLocalTransfers` 是本地控制面权威细节视图，不再被视为 desktop 专属降级镜像。
- `ListLocalAssets` 是权威细节视图的 inventory snapshot，不是 health orchestration surface。它不得同步触发本地 endpoint probe、engine bootstrap、warm execution、recovery accounting、状态迁移或持久化写入。
- 本地模型健康新鲜度由显式 `CheckLocalAssetHealth` / `WarmLocalAsset` / `StartLocalAsset` 与 runtime-owned background health maintainer 维护；Desktop/SDK 不得通过 list polling 或 renderer cache 建立第二套 health truth。

## K-MODEL-008 ModelStatus 状态机

`ModelStatus` 状态转换定义于 `tables/state-transitions.yaml` 的 `model_status` 机。合法转换：

| 源状态 | 目标状态 | 触发条件 |
|---|---|---|
| `INSTALLED` | `PULLING` | 拉取模型更新 |
| `PULLING` | `INSTALLED` | 拉取成功 |
| `PULLING` | `FAILED` | 拉取失败 |
| `INSTALLED` | `REMOVED` | 移除模型 |
| `FAILED` | `PULLING` | 重试拉取 |
| `FAILED` | `REMOVED` | 移除失败模型 |

不在此表中的转换为非法，实现必须拒绝。

## K-MODEL-009 Local Embedding Binding Reference Legality

当 Desktop-host-owned memory embedding live config 选择 `local` source 时，
binding reference 的合法性由 runtime local/model authority 冻结。

固定规则：

- admitted local binding 必须使用 typed local target reference，指向 runtime
  authoritative local inventory 中的 embedding-capable target；不得退化成 raw
  filesystem path、engine 名称、或 renderer-local asset heuristic
- 该 local target reference 必须能被 `RuntimeLocalService` /
  `RuntimeModelService` 的 authoritative inventory 解析
- 被引用 target 必须证明具备 embedding capability；不具备 embedding capability
  的 local model / asset 不构成 legal binding
- binding legality 与 readiness 必须分离：引用合法不等于当前 healthy /
  warm / ready；resolved availability 仍由 runtime health / warm / bundle truth
  决定
- Desktop/SDK 不得通过“有某个本地文件/asset 存在”来推断 legal local memory
  embedding binding；合法性必须来自 admitted runtime local/model authority

## K-MODEL-010 Runtime-Local Algorithm Authority

Runtime owns the local model recommendation, install, registry, and download
algorithms. Desktop, Web, and Kit consume these decisions through SDK / Runtime
projection only.

Runtime-owned algorithm surfaces:

- device profile matching and engine support classification
- recommendation memory budget and tier allocation
- dependency resolver stage ordering
- local model registry identity resolution
- artifact download staging, verification, commit, resume, and progress truth

Cross-owner split:

- `device-profile-contract.md` owns `LocalDeviceProfile` collection and host
  capability evidence.
- `local-engine-contract.md` owns public engine taxonomy, supervised/attached
  runtime modes, and engine/host compatibility rules.
- `local-environment-materializers-contract.md` owns dependency materialization,
  verification, activation, and repair evidence.
- `model-catalog-contract.md` owns catalog identity and provider/source
  metadata.
- this `model-service-contract.md` owns model registry identity, health, model
  status, and local/remote model projection.

## K-MODEL-011 Recommendation Budget And Fit Projection

Runtime recommendation may expose fit tiers such as recommended/runnable/tight
or not-recommended, but the calculation is Runtime-owned.

`MUST`:

- use `LocalDeviceProfile` and runtime local engine/catalog evidence as inputs
- keep confidence, memory budget, context/window, quantization, file metadata,
  and capability fit as typed Runtime evidence
- fail closed when required metadata is absent instead of silently accepting an
  unsupported install path

`MUST NOT`:

- let Desktop provider/model defaults, renderer cache, or Tauri host state
  substitute for Runtime fit evidence
- let a recommendation result become install success or readiness truth

## K-MODEL-012 Dependency Resolver Ordering

Runtime dependency resolution owns required/optional/alternative stage ordering
for local model and profile materialization.

Fixed semantics:

- required dependencies must be satisfied or the plan fails closed
- optional dependencies may be skipped without creating pseudo-success
- alternatives choose one admitted match and record why other choices were not
  selected
- resolver output must be stable for the same catalog, host evidence, and user
  posture inputs

Desktop may display the selected plan and warnings; it must not run a parallel
dependency resolver.

## K-MODEL-013 Registry Identity Resolution

Runtime owns local model registry identity.

`MUST`:

- resolve existing entries before inserting new records
- prevent duplicate identities across normalized model id, engine, logical
  model id, and local asset identity where the relevant fields exist
- rebuild capability indexes from Runtime registry truth, excluding removed
  records
- preserve file metadata and manifest evidence as part of recommendation and
  health confidence

Desktop may not create, merge, or repair registry rows through a Desktop-owned
identity heuristic.

## K-MODEL-014 Artifact Download Atomicity

Runtime owns artifact transfer atomicity for local model/materialized asset
downloads.

`MUST`:

- stage downloads outside committed resolved storage
- verify required hashes/manifests before commit
- commit atomically or roll back without leaving partial committed artifacts
- expose durable transfer/progress state that survives renderer reload
- resume only when Runtime can prove the staged bytes belong to the same
  transfer identity

`MUST NOT`:

- let Desktop/Tauri download progress events be the only terminal evidence
- mark an install ready before Runtime registry, manifest, and health evidence
  agree
