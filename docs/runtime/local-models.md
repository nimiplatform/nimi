# Local Models

Runtime can run AI capability on your hardware. This page covers
local engines, local model lifecycle, and the engine-first routing
model. For cloud routing see
[Connectors And Providers](/runtime/connectors-and-providers).

## Engine-First Routing

Nimi's local routing is **engine-first**. You do not pick a model
and hope something can run it; you pick an engine, and the engine
resolves a model into a runnable bundle.

| Step | What happens |
| --- | --- |
| 1. Choose engine | E.g., a llama.cpp engine, a stable-diffusion engine, a sidecar engine |
| 2. Engine resolves model | The engine picks the right model bundle based on capability + device |
| 3. Bundle becomes runnable | Quantization, runtime context, GPU layers all admitted |
| 4. Route registered | The local route is now an admitted runtime route |

This is opposite to "model-first" routing where you pick a model
name and hope for compatibility. Engine-first means the engine
owns the compatibility decision.

## Local Engine Catalog

Admitted engine types live in
`runtime/kernel/tables/local-engine-catalog.yaml`. Common engine
types include text engines (e.g., llama.cpp variants), image
engines (e.g., stable-diffusion variants), audio engines, and
sidecar engines for specialized work.

Each engine has:

| Field | Purpose |
| --- | --- |
| Engine id | Stable identity |
| Engine type | Text / image / audio / sidecar / etc. |
| Runtime mode | How the engine runs (inline, daemon, etc.) |
| Configuration priority | Which config layers apply |
| Capability surface | What this engine can do |

Engines are admitted; new engine types require kernel admission.

## Device Profile

Runtime's device profile system describes what your hardware can
support. The profile is generated from device detection and admits
or refuses model bundles based on compatibility.

| Field | Purpose |
| --- | --- |
| GPU presence | Whether a discrete GPU is available |
| GPU memory | Available VRAM |
| CPU profile | Cores, architecture |
| Device tier | Admitted compatibility tier |

A model bundle that requires more VRAM than the device profile
admits fails closed at admission. The platform does not silently
load a quantization the device cannot run.

## Local Adapter Routing

Once an engine is admitted and a model is resolved, requests from
apps route through the **local adapter routing** layer. The
adapter normalizes the call shape so an app cannot tell whether a
generation came from a local engine or a cloud provider — same
streaming shape, same error model, same metadata.

| Routing rule | Source |
| --- | --- |
| Capability → adapter | `tables/local-adapter-routing.yaml` |
| Engine → model bundle | `tables/local-engine-catalog.yaml` |

## HuggingFace Catalog Search

Local model installation supports HuggingFace catalog search. The
CLI / Desktop runtime config lets you search admitted model
families and install a bundle that matches your engine's
expectations.

| Step | What happens |
| --- | --- |
| 1. Search | Query an admitted catalog source |
| 2. Filter | Engine-compatible bundles only |
| 3. Install | Download + verify + register under engine |
| 4. Activate | Mark the model as active for this engine |

The catalog search is gated by admitted catalog routes. Random
URLs are not loadable; only admitted catalog routes can install
models.

## Reader Scenario: Installing A Local Text Model

You want to run a local text model on your machine.

1. **Pick an engine.** You select an admitted text engine (e.g.,
   a llama.cpp engine). The engine has a known capability
   surface.
2. **Search.** Through CLI or Desktop runtime config, you search
   admitted catalog routes for a compatible model.
3. **Filter.** The search filters to bundles your engine can run
   on your device. Bundles that exceed your VRAM profile are
   either filtered out or shown as "device-too-small."
4. **Install.** The selected bundle is downloaded, verified
   (checksum), and registered under the engine.
5. **Activate.** The model becomes the active model for this
   engine. Local capability for text generation is now
   available.
6. **Use.** An app issues a text request through `@nimiplatform/sdk/runtime`.
   Runtime routes the request to the local engine and streams
   the result back through the normalized streaming shape.

The app code did not change between cloud routing and local
routing. The local adapter normalized the shape.

## Reader Scenario: A Model Install That Hits A Device Constraint

You attempt to install a model bundle larger than your VRAM.

1. **Search returns the bundle** with a "device-too-small"
   marker, OR the bundle is filtered out depending on your CLI
   filter.
2. **If you proceed anyway**, install fails closed at admission.
   The device profile says the bundle does not fit.
3. **Audit lineage.** The failed install is recorded with reason.
4. **Remediation.** You pick a smaller bundle (or a different
   quantization), or a different engine.

The platform does not silently load a quantization that will OOM.
Fail-closed is the contract.

## Reader Scenario: Multi-Engine On The Same Machine

You want both a text engine and an image engine running locally.

1. **Both engines admitted.** Each runs under its own engine
   instance.
2. **GPU arbitration.** Runtime arbitrates GPU access between
   engines under admitted GPU policy. Concurrent generation is
   subject to GPU budget.
3. **Capability surface.** Apps can issue text requests routed
   to the text engine and image requests routed to the image
   engine. Each routes through the local adapter.
4. **Audit.** Each generation is recorded under the engine that
   served it.

Multi-engine is the normal case. The engine-first routing is
exactly what makes this manageable — capabilities resolve to
engines, not to a global model namespace.

## Cuda Dependency Setup

For engines that need CUDA, Runtime provides a materializer-based
setup with explicit phases:

| Phase | Meaning |
| --- | --- |
| `queued` | Setup queued |
| `downloading` | Fetching dependencies |
| `verifying` | Checksum / compatibility verification |
| `installing` | Installing into runtime-managed location |
| `ready_system` / `ready_managed` | Ready under system or managed mode |
| `failed` | Setup failed; reason recorded |
| `repair_required` | Setup needs repair |
| `cancelled` | User cancelled |

The setup never runs PowerShell or bash directly; everything goes
through the materializer with a single confirmation UI.

## Source Basis

- [`.nimi/spec/runtime/local-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-model.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml)
- [`.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/kernel/scheduling-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scheduling-contract.md)
