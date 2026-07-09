# Local Engine Runtime Environment Contract

> Owner Domain: `K-LENG-*`

## K-LENG-018 Llama Engine Config 参数空间

`engine_config.llama` 命名空间定义 typed 参数，由 runtime 投影到受管 `llama-server` CLI。所有 key 均为可选。已知 key 的非法值必须在 registration 阶段 fail-close，不得静默丢弃。

| Key | 类型 | 约束 | CLI flag |
|---|---|---|---|
| `ctx_size` | integer | 512..1048576 | `--ctx-size` |
| `cache_type_k` | enum | f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1 | `--cache-type-k` |
| `cache_type_v` | enum | f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1 | `--cache-type-v` |
| `flash_attn` | tri-state | on/off/auto | `--flash-attn` |
| `mmproj` | string | 相对路径，.gguf，必须存在 | `--mmproj` |
| `n_gpu_layers` | integer | ≥0 | `--n-gpu-layers` |

语义规则：

- 已知 key + 非法值：fail-close，阻断 registration。
- `engine_config.llama` 内的未知 key：忽略（forward compat），但进入 audit detail。
- `ctx_size` 未设置时，runtime 不主动放大上下文窗口；`llama-server` 使用自身默认值。
- `mmproj` 路径相对 ModelsPath 解析，解析后不得逃逸 models root。
- 若 bundle 文件列表存在多个 mmproj 候选且 `engine_config.llama.mmproj` 未显式指定，registration 必须 fail-close。
- 当前参数空间基于 `llama.cpp` b8645 实证。升级 `llama.cpp` 版本时必须重新验证参数签名。

## K-LENG-019 Supervised Llama Residency 语义

supervised `llama` 的 public residency truth 固定投影到 `LocalWarmState`，不得平行发明另一套 public residency enum：

- `COLD`：模型已安装/可路由，但当前未驻留到 supervised llama worker
- `WARMING`：runtime 正在为目标模型执行加载、切换或 ready 建证
- `READY`：当前已有可服务的 resident worker 命中该模型
- `FAILED`：最近一次加载/切换/ready 建证失败

约束：

- `LocalAssetStatus.ACTIVE` 表示“可被路由选择”，不表示“当前 resident”。
- `LocalAssetStatus.ACTIVE` 的前提仍是 runtime 已证明该 asset 可执行或可按需进入执行路径；endpoint failure、bootstrap failure、bundle failure 或最小执行 failure 不得被包装为 `ACTIVE/COLD`。
- `COLD` 只表达 non-resident residency，不表达 probe failure。若最近一次 ready 建证失败，应投影为 `FAILED` 并按 local asset 状态机进入 fail-closed availability。
- `evicting` 在 Phase 0/Step A 保持 runtime-private，不进入 public state。
- Step A 固定为 request-routed single-worker switch：
  - 每次 llama 请求都必须显式绑定目标模型
  - 同模型请求必须复用同一 resident worker
  - 不同模型请求若需要切换 resident worker，runtime 必须显式协调；无法安全切换时必须 fail-close
- Step A 不得依赖“全局当前模型 = llama-models.yaml 第一条 entry”作为 stable product semantics。若 runtime 使用 YAML 作为内部配置载体，选择结果也必须由请求显式驱动，而不是由静态清单顺序隐式决定。
- bounded multi-worker residency（Step B）需要后续 spec cutover，至少补齐：
  - 多 worker 并存时的 Service / Engine truth
  - residency budget / keep_alive / eviction policy 的 public contract
  - 多 worker 对 `K-LOCAL-008` 的放宽方式

## K-LENG-020 Managed Image Backend Package Source

- `tables/managed-image-backend-packages.yaml` is the single normative source for runtime-owned managed image backend package materialization.
- Runtime must not infer a `stablediffusion-ggml` package ref from ad hoc code branches or from `llama-server backends install ...`.
- A host tuple may carry multiple `package_source` entries in the table, but exactly one `product_state=supported` entry is canonical for default resolution on that tuple.
- `product_state=proposed` package entries are runtime-private experimental sources. They may be selected only by an explicit runtime-private package-source selector and must never be auto-selected, implicitly promoted, or used as a hidden fallback when the canonical source is unavailable or slow.
- Current package admission is:
  - `darwin/arm64 + apple + stablediffusion-ggml`: supported via canonical LocalAI-derived OCI payload; official `stable-diffusion.cpp` direct archive remains runtime-private experimental only
  - `windows/amd64 + nvidia driver/gpu visible + stablediffusion-ggml`: supported via runtime-owned direct archive package + runtime wrapper launch path; CUDA user-space runtime is a shared accelerator dependency requirement resolved by runtime before activation/health success
  - `linux/amd64 + nvidia driver/gpu visible + stablediffusion-ggml`: unsupported until a published runtime-owned package exists
- A topology may remain recognized in `tables/local-image-supervised-backend-matrix.yaml` while package admission remains unsupported in `tables/managed-image-backend-packages.yaml`; runtime must fail-close rather than silently promoting the host tuple.

## K-LENG-021 Native-Binary Execution Cut

- For `backend_class=native_binary`, canonical execution must use the managed image backend gRPC contract directly (`LoadModel`, `GenerateImage`, `Free`).
- `local-media` remains the canonical app-facing HTTP surface for image execution and health projection, but native-binary success may not depend on proxy import support.
- Runtime must not treat llama `/models/import` as part of the canonical native-binary image path on any supported host tuple.

## Runtime Shared Accelerator Dependency Readiness Anchor

Shared accelerator dependency readiness for supervised local execution is owned
by `local-engine-accelerator-contract.md` under `K-LENG-022`. This file keeps
the local engine ordering anchor; CUDA source policy, selected source records,
dependency resolver states, process environment constraints, user confirmation,
and lifecycle projection live in the accelerator companion contract.

## K-LENG-023 Runtime Readiness Is Not Engine Bootstrap Readiness

Runtime daemon readiness proves that Runtime core services are available. It is
not proof that every supervised engine, model, accelerator dependency, Python
environment, or provider loopback is ready.

The daemon may remain in `STARTING` only for bounded core initialization:

- config parsed and validated
- stores opened
- gRPC/HTTP servers serving or ready to serve
- core Runtime services constructed

The daemon must not remain in `STARTING` while performing:

- llama/media/speech/native engine download
- CUDA or other accelerator dependency materialization
- Python environment creation
- Torch/diffusers dependency install
- model warmup or minimal execution
- provider loopback health probes
- repair jobs

Those tasks must run as Runtime-owned background jobs or health maintainers.
Their failure may set Runtime `DEGRADED`, provider unhealthy detail, local asset
`setup_required` / `repair_required` / `unhealthy`, or dependency
`materializable_requires_confirmation` / `failed`, but must not make
RuntimeLocalService, RuntimeAuditService, or config/status surfaces appear
unavailable.

If a startup background task fails before the daemon reaches `READY`, Runtime
must transition through `READY` before projecting `DEGRADED`, so consumers can
observe a consistent service-available state with explicit degradation detail.

## K-LENG-024 Runtime Local Environment Authority

Runtime owns local environment setup truth. The setup unit is a Runtime local environment plan, not a model row, engine installer, Desktop workflow, package-manager command, developer script, or provider health probe.

The normative table split is fixed across `host-capability-profiles`,
`local-compute-packs`, `local-environment-dependencies`,
`local-environment-consumer-requirements`, `local-environment-job-states`, and
`selected-source-record-schema`.

Local environment plans must resolve requested compute pack/capability, installed/imported assets, host profile, consumer requirements, dependency source policy, and current selected source records into dependency state, confirmation requirements, activation gates, repair requirements, and product-safe Desktop projection. Existing accelerator tables remain accelerator-specific projections only; they must not become parallel truth.

Runtime core readiness and cloud-only usage are outside local environment
setup. Cloud API setup, account/session, provider connector configuration, and
Runtime core status must not require local engines, Python, Torch, CUDA,
models, or accelerator dependency materialization.

## K-LENG-025 Managed Dependency Families And Activation

CUDA is one dependency family, not the setup model. Runtime-managed dependency
families include CUDA runtime, native engine packages, `uv`, managed Python,
venv, package sets, Torch wheels, model assets, and companion assets as defined
by `local-environment-dependencies.yaml`.

System sources require positive canonicalized proof. Managed sources must live
under Runtime-owned roots. Runtime must not mutate user PATH, machine PATH,
shell profiles, global Python, system CUDA, or package-manager global state.

## K-LENG-026 Consumer Activation Gates

Consumers declare requirements; Runtime resolves plans. Native engines and Python pipelines must consume Runtime selected source records and must not re-resolve sources, install hidden dependencies, or bypass activation gates.
Activation fails closed for missing, unconfirmed, cancelled, corrupt,
incompatible, unsupported, or repair-locked dependencies. File existence,
endpoint reachability, package directories, PATH precedence, import directory
contents, and script results never project readiness without selected source
records.

Detailed activation authority, request/response shape, environment key
derivation, process-local deltas, reason-code ownership, pack boundary, and
forbidden ready inputs are owned by
`local-environment-consumer-activation-contract.md`.

## K-LENG-027 Runtime Dependency Job Control

Dependency materialization and repair run as Runtime-owned jobs, idempotent per dependency environment. Network materialization requires explicit confirmation covering dependency family, known size, storage category, and no system mutation policy. Startup, route resolution, Desktop page load, passive import review, health probes, and SDK reads must not start heavy downloads.

Repair is first-class: repair locks block activation until Runtime verification
restores `ready_system` or `ready_managed`. Repair must not collapse into
unsupported, ready, or automatic reinstall unless the dependency family policy
admits it.

The public command target is the resolved dependency environment
(`environment_key`, `dependency_family`, `dependency_id`), except cancel/retry
which target Runtime job id. Admitted commands are
`StartLocalEnvironmentDependencyJob`, `CancelLocalEnvironmentDependencyJob`,
`RetryLocalEnvironmentDependencyJob`, and `RepairLocalEnvironmentDependency`.
Command semantics, terminal states, retryability, and forbidden shortcuts are
owned by `local-environment-job-states.yaml`.

Desktop, SDK, and engines may invoke these commands only through
RuntimeLocalService or downstream SDK projection. They must not choose sources,
create selected source records, mutate PATH, run package-manager scripts, or
project `ready` from job existence, transfer completion, endpoint reachability,
file existence, or local cache.

## Runtime Local Environment Materializers Anchor

Detailed materializer authority is owned by `K-LENG-028` in `local-environment-materializers-contract.md`. This section remains the stable Local Engine Contract anchor and delegates registry, source manifest, verification evidence, selected source record, activation, and ordinary-user boundary rules to that file.
