# Local Asset Storage Manifest Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-025 资产存储布局

- 资产根目录: `~/.nimi/models/`
- 结构化目录固定为：
  - `objects/`
  - `sources/`
  - `recipes/`
  - `resolved/<local-asset-id>/asset.manifest.json`
  - `cache/{llama,media,diffusers}`
- **保留原始文件名**（非 content-addressable hash），理由：调试可读、生态工具兼容（vLLM/SGLang 等可直接引用）。
- `resolved/` 下的 `asset.manifest.json` 是本地 bundle 的统一规范入口（schema 见 `K-LOCAL-026`），适用于所有 asset kind（chat、image、video、tts、stt、vae、clip、lora、controlnet、auxiliary）。
- 嵌套目录保留原始结构（如 `speech_tokenizer/model.safetensors`）。
- `local-import/*` 是本地导入 asset id 命名空间，不是 `source.repo`、Hugging Face repo slug、`logical_model_id` 或 resolved path namespace。实现必须拒绝把 `local-import/*` source repo 当成文件位置；需要导入/重绑时必须使用 `file://.../asset.manifest.json`。

`~/.nimi/` 统一数据根布局：

```
~/.nimi/
├── runtime/
│   └── local-state.json
└── models/
    ├── objects/
    ├── sources/
    ├── recipes/
    ├── resolved/
    │   └── <local-asset-id>/
    │       └── asset.manifest.json
    └── cache/
        ├── llama/
        ├── media/
        └── diffusers/
```

Desktop/Tauri 面向用户与 App 的统一资产 manifest public contract 固定为 `resolved/<local-asset-id>/asset.manifest.json`。旧 `manifest.json`、`model.manifest.json`、`artifact.manifest.json` 不再是合法 public import/install 入口，实现必须 reject。

`resolved/` 是统一资产管理根目录；裸文件 intake 不得将 `resolved/` 视作 orphan/unregistered 候选。

## K-LOCAL-026 模型 Manifest Schema

`resolved/<local-asset-id>/asset.manifest.json` 结构定义；passive asset 与 runnable asset 共用该入口，但 `capabilities` 对 passive asset 必须为空，`logical_model_id` 对 passive asset 可省略：

```yaml
schema_version: "1.0.0"      # 必填
model_id: "org/model-name"    # 必填
capabilities: ["chat"]        # 必填，1+ 有效值
engine: "llama"               # 必填
entry: "model.safetensors"    # 必填，须在 files 中存在
files: [...]                  # 必填，entry 在首位
license: "apache-2.0"         # 必填
source:
  repo: "org/model-name"      # 必填
  revision: "main"            # 必填
hashes:                        # 必填，所有文件须有对应 hash
  "model.safetensors": "sha256:abc..."
```

校验规则：

- 所有必填字段非空。
- `entry` 须存在于 `files` 列表中。
- runnable asset 的 `capabilities` 每项须为有效值（`chat` | `image` | `video` | `tts` | `stt` | `embedding`）；passive asset 的 `capabilities` 必须为空，其 workflow 用途由 profile entry 的 `engineSlot` 决定。
- `hashes` 的所有 key 须指向存在的文件，value 非空。
- 文件路径规范化：拒绝绝对路径、拒绝 `..` 遍历、反斜杠转正斜杠。
- 导入态 manifest 的 `source.repo` 必须是当前 `asset.manifest.json` 的 `file://` URL。任何 `local-import/*` source repo 必须 fail-close；不得通过 slug、symlink、复制或 fallback 目录修复。

## K-LOCAL-027 格式支持策略

- **GGUF**: 量化格式，llama 引擎首选。
- **SafeTensors**: 全精度 / 多文件格式，未来主方向。
- 不锁定单一格式：新架构模型可能仅有 SafeTensors 版本。
- Entry 选择优先级（llama 引擎）：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

## K-LOCAL-028 Runtime 获取与执行所有权

- local asset（含所有 kind：chat、image、video、tts、stt、vae、clip、lora、controlnet、auxiliary）的搜索、下载、安装、导入、orphan scaffold/adopt、health/readiness、audit 与 transfer/progress 全部由 runtime 执行并持久化。
- desktop 不得再持有并回写第二套本地资产状态，不得通过 host-local state 推断安装成功、下载完成或资产可启动。
- desktop / web / apps 对本地资产的产品访问必须经 `RuntimeLocalService` typed surface；desktop host 仅保留 picker、reveal、notification 与等价 shell-native/helper 能力。
- future CLI / Web 路径扩展时必须继续复用 runtime 作为统一本地资产控制面，不得复制第二套执行面。
- passive asset 的生命周期（install / remove / transfer）与 runnable asset 共享同一执行管道与状态机（`K-LOCAL-005`），但 passive asset 不参与 Service 绑定与 Node 生成。
- `ListLocalAssets` 是 runtime-owned local inventory 的快照视图；它不得触发 endpoint probe、engine bootstrap、warm execution、recovery accounting、状态迁移或持久化写入。
- local asset health probe 的执行权只属于 `CheckLocalAssetHealth`、`StartLocalAsset`、`WarmLocalAsset`、真实 consume 前的 runtime-owned readiness 路径，以及 runtime-owned background health maintainer。SDK、Desktop、Web 与 apps 不得以 poll list、host cache、renderer-local probe 或 app-local retry state 形成第二套 health truth。
- runtime-owned background health maintainer 可以维护 supervised asset 的 health/readiness projection，但必须遵循 per-asset due gating、recovery interval 与 in-flight 合并；不得因多个 list/poll caller 放大为 N callers × M assets 的 endpoint probe。

## K-LOCAL-029 LocalAuditEvent 扩展字段契约

`LocalAuditEvent` 在 V1 扩展如下字段，并要求关键路径可观测：

- `trace_id`: 请求链路追踪 ID（优先取入站 metadata；缺失时服务端生成）。
- `app_id`: 调用方应用 ID（优先取入站 metadata；缺失可为空）。
- `domain`: 审计域（默认 `runtime.local_runtime`）。
- `operation`: 操作名（RPC 操作或事件类型，禁止空值）。
- `subject_user_id`: 调用主体（优先取认证身份；缺失可为空）。

`ListLocalAudits` 的过滤参数 `app_id` 与 `subject_user_id` 必须作用于上述字段，不得仅用于 token 摘要。

## K-LOCAL-030 Local Runtime 列表/搜索分页边界

以下 RPC 的分页边界遵循统一规则（与 `K-PAGE-005` 对齐）：

- `ListLocalAssets`（统一取代 `ListLocalAssets` 与 `ListLocalAssets`；支持 `kind` 过滤参数按 asset kind 筛选）
- `ListVerifiedAssets`（统一取代 `ListVerifiedAssets` 与 `ListVerifiedAssets`；支持 `kind` 过滤）
- `SearchCatalogModels`
- `ListLocalTransfers`
- `ListLocalServices`
- `ListNodeCatalog`
- `ListLocalAudits`

统一约束：

- 默认 `page_size=50`；
- 最大 `page_size=200`；
- `page_size>200` 必须裁剪为 `200`，不得回退为默认值；
- `page_token` 为空表示首页；
- 非法 `page_token` 返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。
- 所有 list/search RPC 必须保持 read-snapshot 语义。特别是 `ListLocalAssets` 只能读取 runtime 已持久化或内存中已承认的 local asset inventory projection；它不得为了“normalize”或“freshen”结果同步执行 health probe、engine bootstrap、warm、status mutation 或 persistence side effect。
- 需要 fresh health truth 的 caller 必须使用显式 health/warm/start RPC 或等待 runtime-owned background health maintainer 的投影更新；不得把 `ListLocalAssets` 作为隐式 health refresh API。
