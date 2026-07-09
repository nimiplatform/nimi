# Local Category & Capability Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-000 Runtime Target Identity v2 Hard Cut

Local connector identity is retired by `K-RTARGET-006`. Local authorization and
execution target identity are owned by local asset/profile readiness and v2
local durable refs. Any older local connector category enum or raw local
`model_id` execution routing text in this file is retired as durable target
identity.

## K-LOCAL-001 固定 category（Phase 1）

Retired local connector capability families are historical vocabulary only.
They may describe imported local assets, but they are not connector kinds,
connector records, or durable execution target identity:

1. `LLM`
2. `VISION`
3. `IMAGE`
4. `TTS`
5. `STT`
6. `CUSTOM`

## K-LOCAL-002 capability 映射（Phase 1）

- `LLM` 承载 `CHAT` 与 `EMBEDDING`。
- `VISION` 表示“可接受视觉输入”的能力标记，不是独立执行模态。
- `IMAGE/TTS/STT` 与同名执行模态映射。
- `CUSTOM` 的 capability 来自模型元数据声明。
- `TTS` / `STT` 只映射 plain speech capability；不得把 `voice_workflow.voice_clone`、`voice_workflow.voice_design` 视为由 `TTS` category 自动隐含。
- baseline local `Qwen3-TTS` workflow line 不改变上述规则；即使 `Qwen3-TTS`
  同时承担 plain synth / clone / design，workflow capability 仍必须显式声明为
  `voice_workflow.*`，不得通过 `TTS` category 自动推导。

local category / local manifest token 到 canonical capability token 的正式映射以 `tables/capability-vocabulary-mapping.yaml` 为唯一事实源；本规则只定义语义边界，不复制第二套映射表。

## K-LOCAL-003 CUSTOM 可用性门槛

`local_invoke_profile_id` 是 `LocalAssetRecord` 的可选 string 字段，由 `InstallLocalAsset` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

## K-LOCAL-004 category 与路由解耦

connector 层是薄描述，不承载用户路由策略。具体执行路由由模型级元数据与执行模块决定。

Phase 1 的 6 个 system local connector 仅作为固定 category 的目录 / probe facade：

- 可用于 `ListConnectors`、`TestConnector`、`ListConnectorModels` 等能力发现与聚合探测场景
- 不得作为 AI consume 的 `connector_id` 执行入口
- 本地执行必须走 local 模型路由（见 `K-LOCAL-020`），而不是 local connector

## K-LOCAL-005 Local 生命周期状态机锚点

`local_model_lifecycle` 与 `local_service_lifecycle` 的状态与迁移来源由 `tables/state-transitions.yaml` 固定：

- 状态集合：`INSTALLED` `ACTIVE` `UNHEALTHY` `REMOVED`
- 对 `local_model_lifecycle`，语义固定为“可用性状态”而不是“用户手动运行态”：
  - `INSTALLED`：导入/安装后的短暂待验证态，不应作为长期产品展示目标
  - `ACTIVE`：runtime 已验证 bundle/registration/host 前置条件满足，可被路由选择；不要求进程常驻
  - `UNHEALTHY`：bundle、registration、warm/start 或真实运行探测失败，当前不可选
  - `REMOVED`：已移除
- `ACTIVE` 明确不等于“当前已加载到 worker / engine process 中”。
- `LocalWarmState` 是 public residency / warmth truth 的首要承载层：
  - `COLD`：当前未驻留/未加载，但仍可处于 `ACTIVE`
  - `WARMING`：正在加载、切换或建立 ready 证明
  - `READY`：当前已有可服务 residency
  - `FAILED`：最近一次加载/驻留尝试失败
- `local_model_lifecycle` 与 `warm_state` 必须并行表达，不得互相覆盖：
  - `ACTIVE + COLD` 是合法且稳定的 public 组合，表示“可路由但当前未驻留”
  - 不得仅因 `/v1/models` 未出现目标模型，就把该 asset 从 `ACTIVE/INSTALLED` 直接压成 `UNHEALTHY`
- 对 `local_service_lifecycle`，仍表示底层执行实例的运行/探测状态；它不等价于 Local Model Center 的用户可见 readiness badge。
- `local_model_lifecycle` 的典型迁移触发为 `install/register`、`background_validation`、`warm_or_runtime_failure`、`maintenance_stop`、`remove`；细粒度迁移表仍以 `tables/state-transitions.yaml` 为准。

任何 local 生命周期文档必须引用本 Rule ID，不得使用章节号样式来源（例如 `local-model_5.1`）。

## K-LOCAL-006 Local 不可用错误映射

当 local category 无可用模型（例如探活失败或无可执行实例）时：

- 探测路径：`ok=false` + `AI_LOCAL_MODEL_UNAVAILABLE`
- 执行路径：`FAILED_PRECONDITION` + `AI_LOCAL_MODEL_UNAVAILABLE`
- service 生命周期与探测路径必须使用 service 专属 sibling codes：`AI_LOCAL_SERVICE_UNAVAILABLE`、`AI_LOCAL_SERVICE_ALREADY_INSTALLED`、`AI_LOCAL_SERVICE_INVALID_TRANSITION`

## K-LOCAL-007 资产三层抽象

本地资产系统采用三层抽象：

- **Asset**（`LocalAssetRecord`）：用户与 App 可见的统一资产抽象。每条记录携带 `local_asset_id`（ULID）、`kind`（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`）、`logical_model_id`、`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements` 。passive asset（如 `vae`、`clip`、`lora`、`controlnet`）不需要独立 Service 或 Node；其 workflow 槽位由 profile entry 的 `engineSlot` 声明，不属于 asset record 自身。
- 本地导入资产的文件路径真相只来自 `source.repo=file://.../asset.manifest.json` 所在目录加 `entry`；`asset_id`、`logical_model_id`、`local-import/*` 字符串不得作为 resolved 目录真相或二次路径推导输入。passive asset 的 `logical_model_id` 可为空；即使存在，也只是语义元数据，不得覆盖 manifest parent 路径。
- **Service**（`LocalServiceDescriptor`）：某个 runnable asset 当前绑定的执行实例。一个 Service 代表一个可访问 endpoint，可以是 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。仅 runnable asset（chat/image/video/tts/stt）需要 Service 绑定。
- **Node**（`LocalNodeDescriptor`）：能力投影视图。从 Service × capabilities 生成，携带 adapter/engine/policy_gate 等运行时路由信息。Node 是能力发现入口，不是规范真相源。passive asset 不参与 Node 生成。

## K-LOCAL-008 Phase 1 绑定约束

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。
- Step A（request-routed single-worker switch）在当前约束下是合法的：
  - 请求必须显式绑定目标 model / local asset
  - 同一 runtime state root 下，supervised llama 可在一次请求前把唯一 resident worker 切换到目标 Model
  - 该切换不放宽 `Model:Service = 1:1`；它只改变当前 resident worker 绑定到哪一个 Model
- Step B（bounded multi-worker residency）当前不在本规则许可范围内：
  - 若同一 runtime state root 允许多个 supervised llama worker 并存，必须先完成新的 spec cutover，明确 Service 拓扑、Engine truth、residency budget 与 eviction 语义
  - 在完成 cutover 前，runtime 不得把“多 worker 并驻”当作默认合法能力启用

## K-LOCAL-008a Ordinary-user Local Speech Bundle Projection

ordinary-user desktop local speech 可以投影为 canonical product object `Local Speech`，但该投影边界固定如下：

- 它是 runtime-owned speech asset truth + service truth 上的 product projection，不是第二套 asset registry、service registry 或 catalog owner。
- `bootstrap/env`、`host readiness`、`capability materialization` 必须保持分层：
  - `bootstrap/env`：`qwen3_tts` / `qwen3_asr` env roots、cache root、launcher prerequisites
  - `host readiness`：managed speech endpoint 已有受管 health/catalog proof
  - `capability materialization`：仅当前被请求的 `audio.transcribe`、`audio.synthesize` 或 future-admitted `voice_workflow.*` slice 已 materialize
- `bootstrap/env` 与 `host readiness` 不是独立 ordinary-user install object；它们属于同一 bundle download/init flow 的内部层。
- 缺失 speech bundle slice 时，desktop 必须先要求显式 `Download` 用户确认；在确认前，desktop/Tauri 不得因 capability 选择、route 尝试或被动探测而静默触发 env/bootstrap、host init 或 capability download。
- runtime 可以复用既有 env/cache/materialized slice；除非 repair/remove 明确要求，否则不得默认重下载或重 bootstrap。
- capability materialization 必须保持按 capability 懒加载；满足一个 speech capability 不得自动预取全部 speech slices。
- bundle projection 可以暴露 `awaiting_download_confirmation`、`initialized_but_incomplete`、`ready_partial`、`degraded` 等产品态，但这些都只是 projection label；canonical persistent lifecycle owner 仍固定为 `K-LOCAL-005`、`K-LOCAL-009`、`K-LOCAL-016` 下的 runtime truth。

## K-LOCAL-009 Install 语义

`InstallVerifiedAsset`、`InstallModelFromPlan` 与 `ImportLocalAsset` 的语义是注册 + 状态持久化（统一取代旧 `InstallVerifiedModel` / `InstallVerifiedArtifact` 与 `ImportLocalModel` / `ImportLocalArtifact`）：

- 将 asset_id/kind/capabilities/engine/source/endpoint 等字段写入本地状态存储。
- runtime 必须同时写出 runtime-native 本地资产元数据：`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements`、`kind`；runnable asset 必须写出 `logical_model_id`，passive asset 不得从 `asset_id` 自动合成 `logical_model_id`。
- runtime 内部必须同时持久化 asset 的 `engine_runtime_mode`，用于区分显式 `ATTACHED_ENDPOINT` 与自动选择的 `SUPERVISED` 生命周期语义；该内部状态当前不要求经现有 RPC 直接暴露。
- 生成唯一 `local_asset_id`（ULID 格式）。
- 初始状态为 `INSTALLED`（`K-LOCAL-005` 状态机锚点）。
- runtime 既是注册真源，也是本地资产获取、导入、orphan scaffold/adopt、transfer/progress 与生命周期的唯一执行面；desktop 仅负责 shell-native/helper 能力。
- ordinary-user speech bundle flow 若调用这些安装/注册 primitive，也只能作为 runtime-owned bundle projection 的底层执行步骤；desktop 不得把 primitive 调用面直接投影成第二套 speech install owner。
- User file imports always mint a new installed `local_asset_id`, even when
  filename, digest, `asset_id`, `engine`, and `kind` match an existing record.
  Verified catalog/template install may still fail closed on exact catalog
  duplicate only when the requested operation is explicitly catalog install,
  not user file import.

## K-LOCAL-010 Verified 资产目录结构

verified 资产元数据的 SSOT 是 K-MCAT `local` provider catalog（`K-MCAT-032`
local-plane row block：`install` / `variants` / `host_requirement` / `fitness`）。
verified 资产没有独立的 catalog 真相源。

`LocalVerifiedAssetDescriptor` 是该 catalog truth 的 **投影**，不是平行 catalog：

- `LocalVerifiedAssetDescriptor` 的每个字段必须从 K-MCAT `local` catalog row
  与其 `K-MCAT-032` local-plane block 派生：
  - `asset_id` ← variant 级 `variants[].variant_id`（`K-MCAT-032` installable
    identity）
  - `logical_model_id` ← catalog row `model_id`；不得退化成 provider alias
  - `kind` ← catalog row `model_type` / capability-to-asset-kind 映射
  - `capabilities` ← catalog row `capabilities`（必须是 `K-MCAT-024` canonical
    token）
  - `repo` / `revision` / `entry` / `install_kind` / `artifact_roles` /
    `preferred_engine` ← `install` block
  - `files` / `hashes` / `total_size_bytes` ← 选定 `variants[]` 变体
- runtime 不得维护进程内硬编码的 verified 资产元数据字面量；任何这种平行真相
  必须删除。
- 缺失完整性材料（`hashes`）的投影必须 fail-close，不得产出 placeholder
  descriptor。

descriptor 是 catalog projection 这一点不放宽 `K-LOCAL-009` 的安装语义：
`InstallVerifiedAsset` 仍以 variant 级 `asset_id` 注册并持久化资产记录。

## K-LOCAL-010a Public Manifest Intake

稳定 public local asset intake 仅接受 `asset.manifest.json` 与统一 asset schema：

- 文件名必须是 `asset.manifest.json`
- manifest 顶层稳定字段必须使用 `asset_id` / `kind`；不得接受 `model_id`、`artifact_id` 或旧 dual manifest shape
- runnable asset 使用同一 schema 扩展 `logical_model_id`、`capabilities`、`artifact_roles`、`preferred_engine`、`fallback_engines`
- passive asset 也必须走同一 schema；区别仅在 `kind`、空 `capabilities`、可省略的 `logical_model_id` 与可选 runtime-native 扩展字段，而不是另一套 manifest 类型
- Desktop / renderer / bridge / runtime 的稳定输入输出面都必须 fail-close，不得继续兼容旧 manifest 名称或旧字段别名

## K-LOCAL-011 模型目录来源

模型目录来源：

- **Verified list**：K-MCAT `local` provider catalog（`K-MCAT-032` /
  `K-MCAT-033`）。`ListVerifiedAssets` 返回的是该 catalog truth 的投影
  （`K-LOCAL-010`），不是进程内硬编码列表。runtime 不得保留第二套硬编码
  verified 模型列表；任何这种平行真相必须删除。
- **HuggingFace Catalog**：通过 HF REST API 搜索社区模型（`K-LOCAL-023`）：
  - API: `https://huggingface.co/api/models`（REST GET）
  - 搜索参数: `search`（query）+ `pipeline_tag` + `library` 过滤
  - 超时: 20s
  - 结果数限制: 1–80（由 `limit` 参数控制）
  - 能力推断: 从 `pipeline_tag` + `tags` 推导 capability（映射规则见 `K-LOCAL-023`）
- **Catalog search** 结果排序: verified 置顶 + HF results（`K-LOCAL-021`）

verified list 与 HF catalog 是两个不同来源，但 verified 真相只有一个 SSOT：
K-MCAT `local` catalog。两者不得形成第二套 verified catalog。

未来扩展方向：

- 自有 registry
- 本地文件系统扫描
- 用户自定义 catalog endpoint

## K-LOCAL-012 安装计划解析

`ResolveModelInstallPlan` 在安装前执行预检：

1. 采集设备画像（`K-DEV-001`）。
2. 按 `K-DEV-007` 执行硬件-引擎兼容性检查，生成 warnings。
3. 判定 `install_available`：
   - `engine_runtime_mode=ATTACHED_ENDPOINT` 且 endpoint 显式提供且合法 → `true`。
   - `engine_runtime_mode=SUPERVISED` 且引擎二进制可达 → `true`。
   - 否则 → `false`，`reason_code` 说明原因。
4. 填充 `LocalProviderHints`（引擎特定适配信息）。
5. 返回 `LocalInstallPlanDescriptor`（含 warnings 和 reason_code）。

`InstallModelFromPlan` 只能消费 `ResolveModelInstallPlan` 产出的 `LocalInstallPlanDescriptor` 形态；`install_available=false` 必须 fail-closed。Desktop/Web/Kit 不得绕过该 RPC 自行执行 catalog/manual install。
