# Local Engine Accelerator Contract

> Owner Domain: `K-LENG-*` accelerator-specific local engine readiness rules.
> Companion authority to `local-engine-contract.md`; this file owns shared
> accelerator dependency readiness for supervised local execution.

## K-LENG-022 Runtime Shared Accelerator Dependency Readiness

Runtime owns shared accelerator dependency readiness for supervised local
execution. CUDA user-space runtime readiness is not owned by image assets,
`llama.cpp`, `stable-diffusion.cpp`, diffusers, package installers, Desktop, SDK,
or mods. Ordinary users must not be required to install CUDA Toolkit, configure
`CUDA_PATH` / `CUDA_HOME`, or have `nvcc` on PATH before using an admitted
Windows NVIDIA local execution path.

The authority layers are fixed:

- `tables/host-accelerator-profiles.yaml` owns host accelerator profile shape,
  evidence sources, staleness, refresh triggers, multi-GPU policy, degraded
  reasons, and profile states.
- `tables/shared-accelerator-dependencies.yaml` is an accelerator-specific
  projection of canonical local environment dependency authority. It may carry
  CUDA compatibility and package provenance detail, but source policy, selected
  source record schema, activation policy, repair policy, and dependency job
  lifecycle are owned by the local environment tables.
- `tables/accelerator-consumer-requirements.yaml` is an accelerator-specific
  projection of canonical local environment consumer requirements. It may carry
  CUDA consumer projection detail, but it must preserve distinct `failed`,
  `unsupported`, `repair_required`, and `cancelled` semantics and must not
  become a parallel consumer authority.
- Image topology/package tables may reference dependency ids and consumer ids,
  but they must not own CUDA source selection, installation, repair, or selected
  source records.
- Desktop, SDK, mods, and app code may only project runtime dependency truth and
  must not probe, install, or infer CUDA readiness themselves.

Windows NVIDIA CUDA source policy is `system-first-managed-fallback`:

1. compatible system CUDA user-space runtime, if runtime can prove compatibility
   from canonicalized and allowlisted evidence
2. previously verified runtime-managed CUDA dependency under the Nimi runtime
   dependency root
3. declared managed dependency package, after explicit user confirmation for
   first network materialization

System source proof must be positive. Runtime must fail closed when it cannot
verify source identity, canonical root, required DLL/file set, version metadata
or binary version, driver compatibility, and selected source record creation.
Runtime may inspect PATH as a hint, but must never accept a source solely because
a DLL appears earlier in PATH. Runtime must reject model directories, import
directories, and arbitrary user-selected directories as CUDA DLL sources.

Managed source proof must include declared package source, archive hash,
staged extraction, required artifact set verification, version/driver
compatibility where available, atomic promotion, repair metadata, and a selected
source record before any consumer activation.

Dependency resolver states are runtime-private but must be projectable through
stable install / health / audit detail:

| state | meaning |
|---|---|
| `unknown` | dependency evidence has not been resolved |
| `ready_system` | compatible system accelerator dependency was verified and selected |
| `ready_managed` | compatible runtime-managed accelerator dependency was verified and selected |
| `materializable_requires_confirmation` | runtime can install/repair the dependency, but first network materialization needs explicit user confirmation |
| `queued` | user confirmation has been accepted and the runtime install job is queued |
| `downloading` | runtime is fetching a declared dependency package |
| `verifying` | runtime is verifying archive hash, declared files, canonical path, version metadata, and driver compatibility |
| `installing` | runtime is staging and atomically promoting the managed dependency |
| `repair_required` | previously selected dependency is missing, corrupt, or incompatible |
| `failed` | dependency download, verification, compatibility, or install failed |
| `unsupported` | no admitted source can satisfy the dependency on this host |
| `cancelled` | user cancelled before promotion; no ready state may be projected |

Selected source record invariants:

- exactly one active selected source record may exist per
  `dependency_id + host_profile_id + platform_tuple + runtime_data_root`
- all engine consumers in the same dependency environment must reference that
  record; consumers must not independently re-resolve a different CUDA source
- record invalidation is allowed only by runtime verification failure, explicit
  repair, dependency removal, host profile incompatibility, or required artifact
  loss
- failed verification cannot produce a fallback ready state without a new
  verified selected source record

Runtime job invariants:

- setup is idempotent for the same dependency/environment while a job is active
- duplicate consumer requests attach to the same active job id
- cancellation is explicit and stops before promotion
- repair locks exclude activation using the corrupt dependency
- automatic reinstall is forbidden unless the current confirmation policy allows
  it for that repair case

Windows process environment constraints:

- Runtime may prepend the selected dependency directory to a supervised engine
  process PATH only for that child process.
- Runtime must not mutate machine PATH, user PATH, shell profile, or system CUDA
  configuration.
- Runtime must canonicalize dependency paths before use.
- Runtime must record selected source and verification detail in runtime-private
  audit / health detail.

User confirmation constraints:

- Health probes, route resolution, background maintenance, and passive import
  review must not silently trigger first network download of accelerator
  dependencies.
- The first managed dependency download must be initiated by explicit user
  confirmation or by a model install/import confirmation that clearly discloses
  the dependency, approximate size when known, and Nimi data/runtime dependency
  storage location.
- A visible terminal, bash, PowerShell, Chocolatey, WSL, or external package
  manager flow is not the ordinary-user installation path. It may exist only as
  diagnostic/log export and must not be the source of truth for dependency state.

Lifecycle projection:

- A consumer with `materializable_requires_confirmation` may appear as
  installable/review-needed dependency setup, but must not become `ACTIVE` or
  health-successful.
- Activation and ready health for accelerator-backed consumers require
  `ready_system` or `ready_managed`.
- `failed`, `cancelled`, and `repair_required` must project as fail-closed
  dependency setup / repair detail, not as topology unsupported and not as
  pseudo-success.
