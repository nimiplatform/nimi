# Local Environment Materializers Contract

> Owner Domain: `K-LENV-MAT-*`
> Delegated Anchors: `K-LENG-028`, `K-RPC-025`, `K-LENV-ACT-*`

This file owns the detailed runtime local environment materializer authority delegated from the Local Engine Contract and Runtime RPC Surface. It does not create a second truth owner; it keeps materializer rules in one AI-context-sized kernel spec while preserving the stable upstream anchors.

## K-LENG-028 Runtime Local Environment Materializers

Runtime materializers are the only admitted product path for materializing local
environment dependency families defined by
`tables/local-environment-dependencies.yaml`. The materializer registry is
`tables/local-environment-materializers.yaml`; source manifest schema families
are defined by `tables/local-environment-source-manifests.yaml`; verification
evidence schema families are defined by
`tables/local-environment-verification-evidence.yaml`.

The admitted materializer families are:

- `accelerator.cuda.runtime`
- `native-engine-package.llama`
- `native-engine-package.stablediffusion-ggml`
- `python.tool.uv`
- `python.runtime`
- `python.venv`
- `python.package-set`
- `python.torch-wheel`
- `model.asset`
- `model.companion-asset`

A materializer is a RuntimeLocalService-owned job executor. It consumes a
resolved dependency environment, source policy, source manifest, confirmation
disposition, and current selected source record. It stages artifacts under
Runtime-owned roots, verifies family-specific evidence, and promotes a selected
source record only after verification succeeds.

Materializers are not Desktop workflows, engine-local installers, developer
scripts, package-manager commands, PATH helpers, transfer records, endpoint
probes, or model rows. Engine startup, Python pipeline startup, route
resolution, provider health checks, passive import review, SDK reads, Desktop
page load, and background maintenance must not perform first heavy or network
materialization.

Missing `uv`, Python runtime, venv, package set, Torch wheel, native engine
package, model asset, or companion asset readiness must project Runtime local
environment setup, confirmation, failed, unsupported, cancelled, or repair
state. Ordinary users must not be instructed to install `uv`, Python, Torch,
CUDA, native packages, or model dependencies through a system package manager,
global Python environment, user PATH, machine PATH, shell profile, or
engine-private directory.

`native-engine-package.stablediffusion-ggml` source candidates are linked to
`tables/managed-image-backend-packages.yaml`, but selected source record
promotion remains owned by the local environment materializer. Runtime must not
infer a package source from engine startup branches, command-line backend
installers, or ad hoc code paths.

Explicit local imports may produce selected source records for `model.asset`
and `model.companion-asset` only. Imported paths must not become Python, `uv`,
CUDA, DLL, package-manager, Torch, or native engine package roots.

Selected source record identity is the dependency environment key. The
environment key is composed from the dependency family and family-specific key
fields in `tables/local-environment-dependencies.yaml`. `consumer_scope` is
not default key material; it is projection and activation-gate data unless a
future spec cut explicitly admits consumer-scoped selected source ownership for
a family. UI rows, transfer ids, consumer ids, model asset rows, and
engine-private paths must not replace the dependency environment key.

Runtime core readiness remains independent from materializers. Runtime may
reach core `READY` while local dependency jobs are missing, failed, cancelled,
unsupported, or repair-required; those states degrade local compute projections
without making RuntimeLocalService, RuntimeAuditService, or config/status
surfaces unavailable.

## K-RPC-025 RuntimeLocalService Materializer Projection Surface

RuntimeLocalService owns the app-facing projection and command surface for
Runtime local environment materializers. The concrete transport may be new RPC
methods or extensions to the existing local environment plan/job projection, but
the semantics are fixed:

1. Read the materializer registry for dependency families.
2. Resolve source candidates and source manifests from Runtime authority.
3. Project current selected source summaries with bounded diagnostics.
4. Project confirmation payloads before first network or storage-heavy
   materialization.
5. Start, observe, cancel, retry, and repair materializer jobs by dependency
   environment and Runtime job id.
6. Project activation gate failures without probing or installing dependencies.

Detailed consumer activation request, response, reason-code, and process-local
delta semantics are owned by
`local-environment-consumer-activation-contract.md`.

The surface must return Runtime setup or repair state for missing `uv`, Python
runtime, venv, package set, Torch wheel, native package, model asset, or
companion asset. It must not return ordinary-user instructions to install these
dependencies through a system package manager, global Python, user PATH, machine
PATH, shell profile, or engine-private directory.

Materializer projection must preserve the non-ready distinction between
`needs_confirmation`, `queued`, `downloading`, `verifying`, `installing`,
`repair_required`, `failed`, `unsupported`, and `cancelled`. Product-facing
setup-required or materializable-requires-confirmation text is a projection of
`needs_confirmation`; it is not a ready state.

Local transfer records may be included as progress or diagnostic detail only.
They must not target materializer commands, create selected source records, or
project readiness.
