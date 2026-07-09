# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `speech`：本地语音引擎族；baseline `Qwen3` family line 与 workflow 边界由 `local-engine-speech-contract.md` 的 `Speech Engine Family Line` 拥有。
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`media.diffusers` 仅允许作为 `media` 的 runtime 内部 backend driver；不是
public engine target。For descriptor-backed profile workflows, diffusers is
addressed through public `execution.backend=diffusers` plus `model.family`
validation (`K-AIEXEC-008`, `K-AIEXEC-012`) and mapped by Runtime registries to
runtime-private `backend_class=python_pipeline` / `backend_family=diffusers`.
It must not be silently selected as fallback when a profile declares another
backend/family. 若要把 `media.diffusers` 升格为 matrix-supported canonical
backend family，必须在同一轮 cutover 中同步修订 `K-LENG-004`、
`K-MMPROV-010`、`K-PROV-002` 的对应规则。
`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。
Runtime code that consumes the engine taxonomy, including local routing helper
tables such as `knownProviders()`, must be generated from or mechanically
checked against this table. Adding, removing, or renaming an engine without
updating the generator/checker is a spec drift violation, not a Desktop
hard-cut target.

`engine=media` 可承载多个 `backend_class`：

- `native_binary`：原生二进制受管 backend（当前：`stablediffusion-ggml`）
- `python_pipeline`：受管 Python pipeline backend（候选：`diffusers`）

`backend_class` 与 public `engine` 正交；`backend_class` 不是 public engine target，也不是 provider alias。

## K-LENG-002 运行模式

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`
- `SUPERVISED`

`sidecar` 当前只允许 `ATTACHED_ENDPOINT`；`llama`、`media` 与 `speech` 允许 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。

Speech product posture 由 `local-engine-speech-contract.md` 的 `Speech Runtime Mode Product Posture` 拥有；本文件只保留 engine runtime mode 的通用枚举与 cross-engine 约束。

## K-LENG-003 ATTACHED_ENDPOINT 约束

当 `engine_runtime_mode=ATTACHED_ENDPOINT` 时：

- `endpoint` 必须显式提供且合法；runtime 不得偷偷补回 loopback 默认值。
- runtime 不负责启动、停止或重启外部进程。
- `llama` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical API。
- `media` 的 attached endpoint 必须暴露 `GET /healthz` 与 `GET /v1/catalog`。
- `speech` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical speech API。
- `speech + ATTACHED_ENDPOINT` 不得被 runtime 或 app-facing consume 面投影成 ordinary-user 默认本地语音路径。
- 当 runtime 不能证明 attached endpoint 可执行当前 logical model 时，必须 fail-close。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec、监控与回收引擎进程。
- Dependency materialization and repair run as Runtime-owned jobs; Desktop and renderer surfaces may request Runtime job orchestration through admitted SDK Runtime local clients, but must not mint local dependency readiness or repair truth.
- 信号处理：`SIGTERM` 优雅关闭，超时后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 二进制/运行时目录：受管引擎二进制与运行时环境必须落地在 K-CFG-018 数据面
  `environments` root（`<dataRootRef>/environments` 或 `managedRoots.environments`）
  下的 `{engine}/{version}/...`。不得使用 `~/.nimi/engines/` 等 home 目录硬编码
  根作为并行事实源。
- 注册表：`<environments-root>/registry.json`，必须原子写入。
- 当 Runtime config 未携带 `dataRootRef`（产品安装尚未记录 `nimi_data`）时，受管
  引擎物化必须 fail-close，不得回退到 home 目录根。`environments` root 对应
  `local-environment-dependencies.yaml` 中 `native-engine-package.*` /
  `python.*` 家族的 `managed_root` 绑定。
- stale pid 清理只能在 runtime 能证明该 pid 仍属于当前 supervised engine binary 时执行；缺少身份元数据或无法完成身份校验时，runtime 必须只清理跟踪文件，不得终止该进程。
- supervised engine bootstrap 下载只允许 `https -> https` redirect；同 host redirect 允许，`github.com` release 资产仅允许跳到显式 GitHub release-chain host（`github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`），其它 redirect 一律 fail-close。
- `llama` supervised bootstrap 必须使用官方 `ggml-org/llama.cpp` release pack，并落地 `llama-server` 二进制。

受管引擎职责：

- `llama`：管理 `llama.cpp` / `llama-server`、GPU layers、context/batch policy、warmup。
- `media`：管理 image/video 执行 backend。`engine=media` 不能按引擎名整体决定 host support；必须结合 `asset_family`、`backend_class`、`backend_family` 与 `tables/local-image-supervised-backend-matrix.yaml` v2 matrix resolver 输出判断真实受管 backend。
- `speech`：baseline supervised families、ordinary-user readiness layers、capability materialization 懒加载与 local speech bundle download/init flow 由 `local-engine-speech-contract.md` 的 `Speech Supervised Baseline` 拥有。
- `media.diffusers`：在 descriptor-backed profile workflows 中只能作为
  runtime-private implementation selected by validated public
  `execution.backend=diffusers` / `model.family` constraints. It is not a
  replaceable fallback target for profile-declared `stablediffusion-ggml` or any
  other authored backend/family. 当前 kernel 基线仍规定 `media.diffusers` 不得作为
  public engine target，不得在未完成规范修订前直接升格为 matrix-supported
  canonical path。

资产级 supervised 规则：

- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised backend matrix 的唯一事实源。
- canonical local image product path 固定为：
  - `kind=image`
  - `engine=media`
  - `engine_runtime_mode=SUPERVISED`
  - app-facing consume endpoint 为 `local-media`
  - `ATTACHED_ENDPOINT` 不作为 canonical local image product path 的合法 fallback
- v2 matrix 当前定义三类 image asset family topology：
  - `gguf_image`：GGUF 单文件主模型，`artifact_formats=[gguf]`，`profile_kind=single_binary_model`，`backend_family=stablediffusion-ggml`
  - `safetensors_native_image`：单文件 safetensors 主模型（不含 `model_index.json` 或 workflow bundle marker），`artifact_formats=[safetensors]`，`profile_kind=single_binary_model`，`backend_family=stablediffusion-ggml`
  - `workflow_safetensors_image`：由 `model_index.json` / workflow bundle 驱动的
    pipeline bundle，`artifact_formats=[safetensors, json_config]`，
    `profile_kind=workflow_pipeline`，`backend_family=diffusers`。This topology
    is a workflow contract shape, not a product-ready label by itself; required
    profile slices still fail closed when product_state is proposed/unsupported
    or environment/materializer readiness is missing.
- `safetensors_native_image` 与 `workflow_safetensors_image` 的边界判据：`model_index.json` 存在或 workflow bundle completeness 满足时归入 `workflow_safetensors_image`；仅有单文件 `.safetensors` 且不满足 workflow bundle 判据时归入 `safetensors_native_image`。仅因 `artifact_roles` 非空不得自动升级为 workflow topology。
- v2 matrix 按 `entry_id` 索引，每个 entry 以 `platform + asset_family + backend_family + profile_kind` 组合标识一个 topology 槽位。
- `topology_state` 与 `product_state` 分离：
  - `topology_state=defined`：runtime 可解析该 topology
  - `topology_state=deprecated`：仍可识别，不再建议新安装
  - `topology_state=removed`：仅迁移/repair/audit，不参与 canonical resolution
  - `product_state=supported`：允许进入 install recommendation、activation、ready health success
  - `product_state=proposed`：命中后必须返回 recognized-but-not-admitted fail-close
  - `product_state=unsupported`：命中后必须返回 recognized-but-unsupported fail-close
- `engine=media` 且 runnable capability 为 `image.generate` / `image.edit` 时，`SUPERVISED` host support 必须由 v2 matrix resolver 输出的 `backend_class` / `backend_family` / `control_plane` / `execution_plane` 驱动，而不是复用整个 `media` 引擎的粗粒度 host 分类。
- 对 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` + `control_plane=runtime` 的 entry：
  - image orchestration、profile/slot 解析、activation/health、错误投影全部由 runtime 自身负责。
  - `LocalAssetRecord.endpoint` 与本地 consume route 的真实执行 endpoint 仍必须指向 `media` canonical loopback（`local-media`）；runtime 不得额外暴露独立 image control-plane endpoint。
  - runtime 启动/探测时只要求满足 execution plane（`local-media`）与 daemon-managed image backend 的 supervised 生命周期；不得再要求 `llama` 作为 image control plane 参与启动。
- 对 `backend_class=python_pipeline` + `backend_family=diffusers` + `control_plane=runtime` 的 entry：
  - `control_plane` 仍由 runtime 承载，`execution_plane` 由 `media` 进程承载。
  - internal lifecycle 仍保持与双平面模型同一套状态字面量（见 K-LENG-013）。
  - Python runtime bootstrap、venv 管理、依赖安装必须统一走 `uv` 管道（见 K-LENG-016）。
- 对 daemon-managed `stablediffusion-ggml` backend：
  - `darwin/arm64` 属于正式支持的 canonical `gguf_image` supervised host tuple。
  - `windows/amd64 + nvidia driver/gpu visible` 也属于正式支持的 canonical `gguf_image` supervised host tuple；CUDA user-space runtime readiness 是 runtime shared accelerator dependency readiness，不是 host topology prerequisite。
  - runtime 不得再附加独立于 v2 matrix 之外的 Apple 代际门槛；install plan / import / registration / health 统一以 canonical matrix selection 为准，不得额外要求 `M5+` / `A19+`。
- `engine=media` 的 `video.generate` / `i2v` 等其它能力仍可继续沿用 `media` 自身的 host support 规则，直到对应 supervised backend 明确实现。
- 同一规则必须统一驱动 install plan、runtime mode 解析、startup warnings、health warnings 与 attached-endpoint-required 判定；不得在不同入口各自重新推断。

禁止事项：

- 不得以 `LocalAI / Nexa` 作为 supervised 代理层。
- 不得把 `media.diffusers` 伪装成主引擎。
- 不得把 `backend_class`、`backend_family` 暴露给 app 作为 public routing knob。
- 不得把 canonical local image path 降级为 `ATTACHED_ENDPOINT`。
- 不得把 `media.diffusers`、`stablediffusion-ggml` 等 backend 名称提升为 public engine target。
