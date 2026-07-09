# Local Engine Resolver Contract

> Owner Domain: `K-LENG-*`

## K-LENG-012 Resolver 唯一匹配规则

v2 matrix resolver 必须满足以下不变式：

- 每个 image asset 在当前 host 上最多命中一个 canonical topology selection。
- canonical resolution 的匹配顺序固定为：
  1. `host_match` 精确约束命中
  2. `asset_family`
  3. `profile_kind`
  4. `artifact_formats`
  5. `supported_capabilities` / capability support
  6. `topology_state` 过滤
  7. `product_state` 过滤
  8. `admission_gate` 判定

过滤规则：

- `topology_state=removed` 不参与 canonical resolution。
- `topology_state=deprecated` 仅在无 `defined` 命中时参与 legacy migration / repair 判定，不得成为新安装默认路径。
- `product_state=supported` 才允许进入 install recommendation、activation、ready health success。
- `product_state=proposed` 命中后必须返回 recognized-but-not-admitted 的 fail-close 语义。
- `product_state=unsupported` 命中后必须返回 recognized-but-unsupported-on-current-product-surface 的 fail-close 语义。

冲突规则：

- 若多个 entry 在 canonical resolution 后仍同时命中，runtime 必须返回配置/规范冲突错误。
- runtime 不得自行任选其一。
- 该冲突必须进入 audit detail，并阻断 install / start / health success。

Resolver 输入分为两层：

- canonical inputs（驱动 canonical resolution）：host platform、asset manifest / runtime-native facts、`kind`、`capabilities`、`asset_family`、`artifact_formats`、`profile_kind`、bundle completeness、slot / materialization truth
- legacy hints（仅用于 migration normalization，不得主导 canonical resolution）：`engine_config.backend`、`preferred_engine`
- descriptor-authored constraints（仅用于 profile workflow validation, never
  as resolver fallback）：public `execution.backend` and `model.family` from
  `K-AIEXEC-008`. Runtime maps them to admitted backend/profile/model-lineage
  registry rows before resolution. If authored constraints conflict with matrix
  resolver output, dependency family, or asset topology, Runtime must fail
  closed; it must not overwrite the authored constraint with inferred
  `backend_family`, `asset_family`, or derived `Family`.

Resolver 输出至少包含：`entry_id`、`product_state`、`backend_class`、`backend_family`、`control_plane`、`execution_plane`、`supported_capabilities`、catalog comparable identity、compatibility detail。

约束：

- canonical topology resolution 必须由 runtime-native asset facts 驱动，不得由 legacy routing hints 决定。
- `preferred_engine` 是公开摘要/展示字段，不是 topology fact。
- `engine_config.backend` 仅允许作为导入旧资产时的过渡线索；一旦 family / profile / materialization 已归一化，就必须失效。
- `execution.backend` and `model.family` are the only admitted public authored
  local backend/model-lineage inputs for profile-owned workflows. Bare public
  `family`, `asset_family`, `backend_family`, `dependency_family`, or
  `preferred_engine` fields must not be accepted as substitute authoring
  fields.
- 若 canonical facts 缺失，resolver 必须 fail-close 或进入 migration-needed / repair-required 语义；不得把 legacy hint 直接提升为 truth。

Admission gate contract 注册：

- `admission_gate` 只允许出现在 `product_state=proposed` 的 entry。
- `admission_gate` token 的值域必须来自 kernel prose 的显式注册；table comment 或单独 table entry 不得成为唯一注册源。
- 本轮唯一注册的 admission contract 是 `apple-mps-image-poc`：
  - 仅用于 `workflow_safetensors_image -> diffusers -> python_pipeline` 的 Apple Silicon PoC admission。
  - 证据必须写入 local execution report route patterns（如 `.local/report/**`）。
  - gate 通过后，必须在同一 spec cutover 中把对应 entry 提升为 `product_state=supported` 并移除 `admission_gate`。
  - 历史证据保留在 local-only execution reports / audit（如 `.local/report/**`）；稳定 kernel table 不保留“已通过 gate 但仍挂着 gate token”的状态。

## K-LENG-013 单机单 Canonical Mode 仲裁

v1 每个 runtime state root（默认 `~/.nimi`）同时只能有一个 canonical `local-media` supervised active selection。

规则：

- 允许多个 image asset 安装存在，但只允许一个 selection 拥有 activation 权。
- 仲裁优先级固定为：`supported` active selection 优先；若无 `supported`，不得自动激活 `proposed` 或 `unsupported`。
- 当已存在 active `gguf_image` selection 时导入 `workflow_safetensors_image` 或 `safetensors_native_image`：可安装，不可自动接管 `local-media`，必须保持 inert / non-active。
- 当 active selection 被 remove 或 become unhealthy：runtime 可重新仲裁，但只能在 `supported` 集合内重选。
- repair 不得改变 active ownership，除非显式满足重新仲裁条件。
- v1 不支持同一 host 同时运行 GGUF `proxy_execution` 与 safetensors `pipeline_supervised` 两个 media 实例并共用 canonical product path。

## K-LENG-014 Image Supervised Mode 语义

`media_server.py` 必须区分两类 mode，由 `NIMI_MEDIA_MODE` 环境变量驱动：

1. `proxy_execution`：服务于 runtime-owned `native_binary` image 路径，health / catalog 暴露 runtime-owned proxy execution truth；稳定产品路径上不得再承担 image generation control-plane。
2. `pipeline_supervised`：服务于 runtime-owned `python_pipeline` image 路径，health / catalog 暴露真实 pipeline truth。

Mode 与 resolver 的映射固定：

| resolver output | `NIMI_MEDIA_MODE` 目标值 |
|---|---|
| `control_plane=runtime`, `execution_plane=media`, `backend_class=native_binary` | `proxy_execution` |
| `control_plane=runtime`, `execution_plane=media`, `backend_class=python_pipeline` | `pipeline_supervised` |

HTTP contract：

- `proxy_execution` 与 `pipeline_supervised` 共享同一 canonical HTTP surface：`GET /healthz`、`GET /v1/catalog`、`POST /v1/media/image/generate`。
- request body 与 artifact response envelope 在两种 mode 下保持同形；mode 差异只允许体现在 runtime-private detail / checks / catalog metadata。
- `proxy_execution` 下的 `POST /v1/media/image/generate` 若未连接到 runtime-owned direct execution contract，必须 fail-close；不得再通过 llama route、llama management route 或其它 legacy control-plane 伪造成功。
- `/models/import` 不属于 canonical image supervised contract；runtime-owned image path 不得依赖 llama model import API。

## K-LENG-015 Internal Lifecycle 状态机

无论是 runtime-owned native-binary path 还是 runtime-owned python-pipeline path，都必须复用同一 internal lifecycle：

1. `resolved` → 2. `materialized` → 3. `installed` → 4. `control_plane_ready` → 5. `execution_plane_ready` → 6. `active`

退化路径：`degraded`、`repair_required`。

重要约束：

- 以上状态机是 runtime-private internal lifecycle，不直接替换现有 public lifecycle。
- 对 app / sdk 的稳定投影仍必须继续落在：`INSTALLED`、`ACTIVE`、`UNHEALTHY`、`REMOVED`。

状态 owner：

| internal lifecycle | owner |
|---|---|
| `resolved` | resolver |
| `materialized` | materializer |
| `installed` | local state |
| `control_plane_ready` | engine supervisor |
| `execution_plane_ready` | execution health aggregator |
| `active` / `degraded` / `repair_required` | runtime aggregator |

持久化边界：

- 持久化：`installed`、`repair_required`、active selection ownership
- 仅运行时聚合：`control_plane_ready`、`execution_plane_ready`、`degraded`
- 仅可审计 runtime-private detail：`resolved`、`materialized`

Internal lifecycle 到 public lifecycle 的投影：

| internal lifecycle | public lifecycle |
|---|---|
| `resolved` / `materialized` | 不得单独对外提升状态 |
| `installed` | `INSTALLED` |
| `control_plane_ready` 但 `execution_plane_ready=false` | `UNHEALTHY` |
| `execution_plane_ready` 但 control plane 未满足 | `UNHEALTHY` |
| `active` | `ACTIVE` |
| `degraded` | `UNHEALTHY` |
| `repair_required` | `UNHEALTHY` |

合法迁移路径（禁止跳过中间状态）：

- `resolved -> materialized -> installed -> control_plane_ready -> execution_plane_ready -> active`
- `active -> degraded`（任一平面失去 ready）
- `active -> repair_required`（完整性失真）
- `degraded -> active`（双平面重新同时满足 ready）
- `degraded -> repair_required`（降级原因被判定为完整性问题）
- `repair_required -> resolved`（topology truth 失配，必须重新进入 resolver）
- `repair_required -> materialized`（repair / rematerialization 成功）
- `repair_required -> installed`（仅需重建安装态）
- 不得从 `active` 直接跳回 `resolved`
- 不得从 `resolved` 直接跳到 `active`

双平面聚合规则（`llama/media`）：

| control plane | execution plane | internal lifecycle | execute/generate |
|---|---|---|---|
| ready | ready | `active` | 允许执行 |
| ready | not ready | `degraded` | fail-close |
| not ready | ready | `degraded` | fail-close |
| starting/restarting | any | `degraded` | fail-close |
| failed | any | `repair_required` 或 `degraded` | fail-close |

单平面聚合规则（`media/media`）：internal lifecycle 仍保持同一套状态字面量，不单独发明压缩版状态机。`installed -> control_plane_ready` 表示进程 bootstrap 完成；`control_plane_ready -> execution_plane_ready` 表示 `/healthz` ready + `/v1/catalog` ready + target catalog identity 可比较。

启动预算：

- `native_binary` image execution plane：180s（沿用当前 media supervised 基线）
- `python_pipeline` supervised：300s（pipeline load / warmup / 首次编译）
- Python 依赖准备与 venv 安装是独立 bootstrap 预算，不计入 300s pipeline ready 窗口
- 超过启动预算仍未形成 ready 证明，必须结束 starting / restarting，不得无限等待

## K-LENG-016 Python Runtime Management Contract

`python_pipeline` backend class 的 Python runtime 管理约束：

- v1 mandates `uv` 作为唯一 Python bootstrap 管道。不允许并存第二套 Python bootstrap 实现。
- v1 受管 Python 版本固定为 `3.12`。
- Python runtime 以 `engine=media` 的 supervised engine version 为作用域共享，不按 model 单独创建 venv。
- venv 路径固定在 K-CFG-018 数据面 `environments` root 下的
  `media/{version}/python/`（`python.venv` 家族 `managed_root: environments`）。不得使用 home 目录硬编码根。
- venv 必须绑定：engine version、Python version、package set / lock hash、host platform tuple、`backend_class=python_pipeline`。任一绑定因子变化都必须触发重建。
- 创建策略：staging dir -> verify -> atomic promote。校验失败必须进入重建或 fail-close。
- Python runtime 创建预算：120s。dependency install 预算：600s。pipeline warmup / ready 预算：300s。
- retry 只允许用于瞬时网络传输失败；不得把 ABI 不兼容、wheel 不存在、import 错误当作可重试成功路径。
- 不存在隐式离线 fallback；wheel source 必须由 engine bootstrap config 显式声明。
- venv 的 owner 是 runtime engine supervisor，不是单个 asset。清理只允许发生在 engine version 升级淘汰、显式 repair / maintenance、原子回收流程。

## K-LENG-017 错误归因模型

错误优先级链：compatibility > startup > health > execution。

v1 固定 internal reason key 集合（audit / health / structured error detail 共享同一组命名）：

| internal_reason_key | 场景 |
|---|---|
| `manifest_completeness_failure` | manifest schema invalid / required file-hash completeness failure / model_index.json 引用子模型缺失 |
| `bootstrap_failure` | bootstrap failed |
| `plane_not_ready` | control plane / execution plane not ready |
| `execution_failure` | runtime resolved but execution failed / pipeline 首次冷启动超时 |
| `python_version_incompatible` | Python version 不兼容 |
| `python_runtime_broken` | Python venv 损坏 / interpreter 不可用 |
| `python_dependency_install_failed` | torch wheel 安装失败 / ABI 不兼容 |
| `pipeline_load_timeout` | diffusers pipeline load 超时 |
| `catalog_identity_mismatch` | catalog ready 但 target identity 不可比较 |
| `profile_backend_mismatch` | descriptor-authored execution.backend conflicts with runtime registry/resolver |
| `profile_model_family_mismatch` | descriptor-authored model.family conflicts with runtime registry/resolver |
| `workflow_required_component_missing` | required workflow component or companion occurrence is absent/unready |
| `workflow_backend_unsupported` | profile workflow shape is recognized but product/runtime support is unsupported/proposed |

入口级失败映射：

| 阶段 | 失败类型 | primary_reason_code |
|---|---|---|
| install | host unsupported | `AI_LOCAL_MODEL_UNAVAILABLE` |
| install | topology recognized but `product_state=unsupported` | `AI_LOCAL_MODEL_UNAVAILABLE` |
| install | topology recognized but `product_state=proposed` 且 admission 未通过 | `AI_LOCAL_MODEL_UNAVAILABLE` |
| profile/slot resolve | required slot 缺失或 slot asset UNHEALTHY | `AI_INPUT_INVALID` |
| import | manifest schema invalid | `AI_LOCAL_MANIFEST_SCHEMA_INVALID` |

强约束：

- canonical image path 永不返回 `AI_LOCAL_ENDPOINT_REQUIRED`。
- slot 缺失不得降级为"忽略该 slot"。
- catalog 静态列表不得当成 ready 证明。
- `local-import/*` 不得进入 Hugging Face catalog details 解析，也不得作为 runtime storage repo/path truth；本地导入与 slot 依赖必须通过 manifest-owned `file://.../asset.manifest.json` 解析。
- 双平面失败时只允许一个稳定主错误码；次级平面信息只能进入 `secondary_detail`。
- `repair_required -> resolved` 每次发生时，必须写入 audit event（至少包含 `old_entry_id`、重新解析原因、触发入口与时间戳）。
