# Local AI Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`, `.nimi/spec/runtime/kernel/*`

## Scope

本地 AI 功能域 — Runtime Config 内的本地资产管理、dependency asset 管理、recommendation feed 页面、transfer/progress 展示，以及 Desktop 对 runtime 本地模型控制面的投影。

## Kernel References

### Runtime local control plane

- 本地模型 / artifact 的清单、状态、health、audit、import/install/download、orphan scaffold/adopt、transfer/progress 以 `.nimi/spec/runtime/kernel/rpc-surface.md` 的 `K-RPC-004 RuntimeLocalService` 为唯一规范真源。
- 获取/执行所有权、local chat installed-selectable 语义与 warm-on-demand 以 `.nimi/spec/runtime/kernel/local-category-capability.md`（`K-LOCAL-009`、`K-LOCAL-020a`、`K-LOCAL-028`）为准。

### Desktop bridge 投影

- Desktop renderer 必须优先消费 runtime typed local APIs；bridge 只负责把 host-native 能力与 runtime client 接起来。
- Tauri `runtime_local_*` 命令的规范边界见 `.nimi/spec/desktop/kernel/bridge-ipc-contract.md`（`D-IPC-011`、`D-IPC-012`）。它们只能承载 picker、reveal、notification 与少量 host helper，不得构成第二控制面。

### Security / Integrity

- 回环端点限制见 `D-SEC-001`。
- `verified` 与 `local_unverified` 完整性语义见 `D-SEC-006`；完整性校验/transfer 失败/健康判定的权威执行者是 runtime。

## Desktop 投影规则

- Local Model Center 的模型、artifact、transfer UI 必须全部反映 runtime 真源，不得读取或修复 Desktop host-local state。
- `Active Downloads` / `Active Imports` 必须来自 runtime transfer APIs，而不是 Tauri progress event。
- route options / resolve / health check 对 chat/text local model 的 readiness 判断必须固定使用 runtime authoritative local model list/status；host snapshot 只能补充标题、endpoint、catalog 辅助字段，不得单独决定 sendability。
- 当 host snapshot 与 runtime local state 出现 split-brain、degraded 或 missing authoritative record 时，Desktop 可以显示用户原先的本地选择，但必须 fail-close 为不可发送状态并附带诊断原因。
- Desktop host 只提供原生壳能力：
  - file picker / manifest picker
  - reveal-in-folder / reveal-root
  - notification
  - 仍未下沉到 runtime 的 host helper surface

## Product Semantics

- chat/text 本地模型以 runtime readiness 为准；`active` 表示已通过 runtime 可执行校验，`installed` 表示仍可展示/选择但请求时必须由 runtime 先 warm。
- media/image/video 本地 readiness 不在本域放宽，继续遵循 runtime kernel 的更严格规则。
- Local Model Center 是状态展示，不再是手动启停控制台；Desktop 不提供本地模型行内 start/stop toggle。
- `active` 表示模型已通过 runtime readiness 校验并可被选择，不要求常驻运行；`installed` 不再等价于 ready，只表示 runtime 已登记且允许 warm-on-demand。
- 对 runtime-owned shared accelerator dependency setup，Desktop 只提供 runtime truth projection 与用户确认入口：
  - 当 runtime 返回 CUDA accelerator dependency `needs_confirmation` / `materializable_requires_confirmation` 时，Desktop 可以展示一次共享确认 UI，说明 Nimi 将把依赖安装到 Nimi data/runtime dependency 目录且不会修改 system CUDA、user PATH 或 machine PATH。
  - 用户确认后，Desktop 只能调用 runtime-owned dependency install/repair job surface；不得自行运行 bash、PowerShell、Chocolatey、WSL、installer script，或自行选择 CUDA source。
  - Desktop 可以展示 runtime job phase：`queued`、`downloading`、`verifying`、`installing`、`ready_system`、`ready_managed`、`failed`、`repair_required`、`cancelled`。
  - 同一 CUDA dependency 被 llama、stable-diffusion.cpp、diffusers/Torch-style consumer 同时需要时，Desktop 必须投影同一个 runtime job / selected source record，不得显示成多个 engine-private installer。
  - visible terminal / install log / diagnostic command 只能作为高级诊断或日志入口，不得成为普通用户安装路径，也不得成为 dependency state truth。
  - dependency failure 必须投影为 fail-closed setup/repair 状态，不得伪装为 ready，不得降级为 attached endpoint。

### Runtime state cutover and data-dir projection

- Desktop `nimi_data_dir` is a storage-root preference, not local AI state
  truth. Changing it must request or display a Runtime-owned reconciliation
  plan before Local Model Center assumes models, dependency assets, or setup
  jobs are usable.
- Desktop must not read `<nimi_data_dir>/state.json` as a fallback inventory.
  That file may only be displayed as a retired cutover input when Runtime
  reports a cutover plan that references it.
- Desktop must not dual-write retired `state.json` and Runtime
  `localStatePath`. After cutover succeeds, Desktop must read local assets only
  through Runtime typed APIs.
- If Runtime reports `cutover_required_confirmation`, Desktop may show a
  confirmation UI with source path, target path, asset counts, conflicts, and
  non-destructive effects. The confirmation must call a Runtime-owned cutover
  job; Desktop must not perform the migration itself.
- If Runtime state is empty while a retired input is detected, Desktop must
  project setup/cutover-required state. It must not project "No Installed
  Models" as final truth without the Runtime cutover status.

### Auth and bounded loading

- Runtime Config pages must not keep `Discovering...`, audit, usage, Local
  Models, or dependency setup loading indefinitely. Every Runtime read path must
  have a bounded timeout, error projection, stale projection, or auth-invalid
  projection.
- `AUTH_TOKEN_INVALID` must be projected as `invalid_requires_reauth` unless
  the target RPC is normatively anonymous-readable. Anonymous retry may be used
  only for admitted read-only Runtime surfaces, and the credential source must
  remain visible in audit/detail.
- Logout must clear local persisted session, active streams, cached runtime
  reads, and auth state before best-effort server logout. A failed server logout
  must not leave Desktop believing the stale bearer is valid.

## Error Families

本域引用的错误码族：

- `LOCAL_AI_IMPORT_*`
- `LOCAL_AI_MODEL_*`
- `LOCAL_AI_ENDPOINT_*`
- `LOCAL_AI_SPEECH_*`
- `LOCAL_AI_HF_DOWNLOAD_*`
- `LOCAL_AI_FILE_IMPORT_*`

权威来源：`.nimi/spec/desktop/kernel/tables/error-codes.yaml`

## CI 门禁引用

- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope desktop --check`

## Local Compute Setup Projection Boundary

Desktop owns only ordinary-user projection and confirmation for Runtime local
environment plans. Runtime remains the sole owner of host capability profile,
local compute pack resolution, dependency graph, dependency jobs, selected
source records, repair truth, and activation gates.

Desktop may:

- display cloud-only readiness separately from local compute readiness
- display Runtime-projected local compute packs and environment plans
- ask for explicit user confirmation before Runtime performs heavy dependency
  materialization
- show active Runtime dependency jobs with product-safe names
- invoke Runtime cancel, retry, or repair APIs
- start Runtime dependency jobs only with a dependency environment from the
  current Runtime plan
- expose raw dependency ids, selected source records, hashes, paths, and logs
  only in diagnostics

Desktop must not:

- probe GPU, CUDA, Python, uv, Torch, package sets, model directories, or PATH as
  dependency truth
- choose dependency sources or selected source records
- run PowerShell, bash, Chocolatey, WSL, package-manager, engine-local, or
  script-only installers as the ordinary product path
- mutate user PATH, machine PATH, shell profiles, system CUDA, global Python, or
  package-manager global state
- project `ready` from file existence, endpoint reachability, import success,
  model row state, transfer completion, or stale host-local cache
- split one Runtime dependency job into engine-private installers
- treat a stored Runtime job id as durable dependency truth after the next plan
  refresh

Normal UI copy must be environment-centered. A model row may say that it is
waiting for local GPU support, Python runtime setup, repair, or activation, but
the row must link to the Runtime environment plan rather than becoming a
separate installer.

Cloud API configuration, sign-in, provider connector setup, and cloud-backed
chat must remain usable when no local compute pack is selected, when local
dependency probing fails, and when local dependency repair is required.

### Materializer Setup Projection

Desktop local AI surfaces may project Runtime materializer state for all local
environment dependency families: CUDA runtime, native engine packages, `uv`,
Python runtime, venv, package sets, Torch wheels, model assets, and companion
assets.

Desktop may display Runtime-projected setup, confirmation, progress, cancel,
retry, repair, failed, unsupported, and activation-gate details. It must not
probe these dependencies, choose sources, create selected source records, run
installers, mutate PATH, or infer readiness.

Normal user-facing copy must say that Nimi will set up the local environment
under Runtime-owned storage after confirmation. It must not tell ordinary users
to install `uv`, Python, Torch, CUDA, native packages, model assets, or
companion assets through system package managers, global Python, PATH mutation,
shell profile edits, or engine-private directories. Paths, hashes, source
labels, selected source record ids, and logs may appear only in diagnostics.

Desktop must keep one Runtime dependency environment projected as one setup job
or selected source record even when multiple model rows or engine consumers need
it. It must not split shared Runtime dependency truth into engine-private
installers.

For model payload dependencies, Desktop must pass concrete Runtime asset
identity (`asset_id`, `local_asset_id`, `companion_asset_id`, and parent binding
where available) into Runtime plan and activation-gate requests. Desktop must
not start `model.asset` or `model.companion-asset` jobs from pack-level
placeholder ids.

## Offline / Degradation

Realm 离线不阻断本地模型管理；Runtime 不可达时，本域所有 local model 管理、transfer 与 lifecycle 路径必须 fail-close。详细降级语义回指 `kernel/offline-degradation-contract.md`。
