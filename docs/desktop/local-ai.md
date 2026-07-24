# Local AI

Desktop's Local AI surface — the Local Model Center — is the user
UI for managing local AI on their machine. All UI is a Runtime-owned
typed projection. Desktop never reads its own local state for AI
configuration; it asks Runtime.

## What Local AI Surfaces

| Concept | Meaning |
| --- | --- |
| Active | Runtime-validated executable (this model can run right now) |
| Installed | Registered, must warm-on-demand |
| Local Model Center | The UI for browsing, installing, activating local models |
| Engine binding | Which engine is bound to which capability |

Active vs Installed is a real distinction. An Installed model is
registered but not warmed; warming happens on first use. An Active
model is validated as executable right now.

## Truth Projection, Not State Owning

Desktop's Local AI UI **never invents truth**. Every state shown
on the screen is a projection of Runtime truth.

| Concern | Owner |
| --- | --- |
| Whether a model is active | Runtime |
| Whether a model is installed | Runtime |
| What capability a model serves | Runtime |
| Which engine is bound | Runtime |
| Cuda dependency state | Runtime materializer |

If Runtime says a model is unavailable, Desktop shows "unavailable"
— it does not silently retry or pretend the model is available.

## CUDA Dependency Setup

Engines that require CUDA go through a runtime materializer.
Desktop UI shows the materializer's typed phases.

| Phase | Meaning |
| --- | --- |
| `queued` | Setup queued |
| `downloading` | Fetching dependencies |
| `verifying` | Checksum / compatibility verification |
| `installing` | Installing into runtime-managed location |
| `ready_system` | Ready under system mode |
| `ready_managed` | Ready under managed mode |
| `failed` | Setup failed; reason recorded |
| `repair_required` | Setup needs repair |
| `cancelled` | User cancelled |

Critically: the setup never runs PowerShell or bash directly.
**Single confirmation UI**; the materializer handles the actual
installation under admitted contracts.

The user clicks "install CUDA dependencies"; the materializer
walks the phases; Desktop projects the phase to the user. There
is no opaque shell command stage.

## Reader Scenario: Installing And Activating A Local Model

You want to run a local text model on your machine.

1. **Open Local Model Center.** Desktop reads from Runtime which
   models are admitted, available, installed, active.
2. **Browse / search.** Through admitted catalog routes.
3. **Install.** You select a model bundle. Runtime downloads,
   verifies, registers.
4. **Installed state.** Model appears as Installed.
5. **Activate / warm.** You ask Runtime to activate the model.
   Runtime warms the model; engine binds capability.
6. **Active.** Model is now Active. Apps can route requests to
   it.

Throughout this flow, Desktop UI is reading Runtime state
projection. If Runtime says "validation failed," Desktop shows
that exact reason.

## Reader Scenario: Memory Embedding Configuration

The user wants to choose which embedding model the memory
substrate uses.

1. **Runtime Config UI.** Desktop's Runtime Config edits user-
   selected memory embedding **intent** — what model the user
   wants.
2. **Runtime owns resolution.** Once the intent is submitted,
   Runtime decides bind success, bank identity, migration, and
   cutover.
3. **Desktop never decides "memory is ready" on its own.** That
   is a Runtime-side determination.
4. **Desktop projects.** UI shows whether the embedding bind
   succeeded; if it failed, why.

This is the single most important boundary discipline in this
section: Desktop **expresses intent**; Runtime **owns resolution**.

## Reader Scenario: CUDA Setup Walks Through Phases

A user with a discrete GPU first installs an engine that needs
CUDA.

1. **CUDA needed.** The engine declares CUDA as a required
   dependency.
2. **Materializer offers setup.** Single confirmation UI:
   "Install CUDA dependencies?"
3. **User confirms.** The materializer queues.
4. **Phase progress.** Desktop UI shows phases:
   `queued → downloading → verifying → installing → ready_managed`.
5. **Engine ready.** The engine can now run on GPU.

If any phase fails, Desktop shows the typed reason; the user can
retry, repair, or cancel under admitted state.

## Realm Offline Does Not Block Local AI

| Realm state | Local AI state |
| --- | --- |
| Online | Local AI works normally |
| Offline | Local AI keeps working |
| Both offline | Degraded read-only |

This is the local-first posture made concrete. Realm being offline
does not prevent the user from running their local agent.

## What Local AI Does Not Do

| Concern | Why not |
| --- | --- |
| Read its own local state for AI configuration | Desktop projects from Runtime |
| Run shell commands directly | Materializer is the admitted path |
| Decide memory bind success | Runtime owns that |
| Provide a fallback when Runtime says unavailable | Fail-closed posture |

## Source Basis

- [`.nimi/spec/desktop/local-ai.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/local-ai.md)
- [`.nimi/spec/desktop/runtime-config.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/runtime-config.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/canonical/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/desktop/ai-consumption.authority.yaml)
