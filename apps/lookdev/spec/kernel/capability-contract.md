# Lookdev Capability Contract

> Rule namespace: `LD-CAP-*`

## LD-CAP-001 — Typed Runtime Mainline

Lookdev consumes runtime capabilities through typed SDK runtime surfaces.

Mainline generation and evaluation paths must not depend on ad hoc provider payloads or raw provider-specific request assembly.

## LD-CAP-002 — Typed Realm Mainline

Lookdev commits portrait truth through typed app-facing Realm surfaces or an explicitly approved typed adapter.

Product code must not bypass Realm typed services with raw REST path assembly as its mainline writeback path.

## LD-CAP-003 — App-Managed Working Storage

Lookdev owns app-managed storage for:

- world style session records
- world style pack records
- portrait brief records
- batch records
- item records
- current result image references
- evaluation payloads
- lightweight audit events

This storage is app-local working state, not Realm truth.

## LD-CAP-004 — Runtime Capability Split

Lookdev needs at least:

- structured text generation or equivalent typed reasoning capability for world-style-session synthesis and portrait-brief compilation
- image generation capability for portrait production
- multimodal text/vision understanding capability for auto-evaluation

The app should keep these concerns explicit rather than assuming a single opaque provider path.

## LD-CAP-005 — Explicit Batch-Scoped Target Selection

Lookdev must expose explicit batch-scoped target selection for:

- one `image.generate` target used by batch generation
- one `text.generate.vision` target used by batch evaluation

The app may prefill sensible defaults from runtime availability, but it must not silently hide target choice behind an opaque "first available" provider path.

## LD-CAP-006 — Shared Capture Logic Reuse

Lookdev may reuse Agent-Capture portrait refinement logic for capture-selected items.

That reuse must happen through shared typed logic or an explicitly approved shared adapter layer. Lookdev must remain the top-level app shell and must not require the operator to switch products during its mainline flow.

## LD-CAP-007 — No Silent Contract Rescue

If generation output, evaluation output, or writeback payloads are malformed, mistyped, or structurally invalid, Lookdev must fail closed.

It must not fabricate pseudo-success item states to keep a batch moving.

## LD-CAP-008 — Realm Boundary Preservation

Lookdev must preserve the architecture split:

- Realm remains the only persistent shared truth source
- Runtime remains the local inference plane
- Lookdev remains a first-party app control plane

The app must not smuggle runtime working artifacts into Realm without explicit commit semantics.
