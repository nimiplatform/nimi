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

- batch records
- item records
- current result image references
- evaluation payloads
- lightweight audit events

This storage is app-local working state, not Realm truth.

## LD-CAP-004 — Runtime Capability Split

Lookdev needs at least:

- image generation capability for portrait production
- multimodal text/vision understanding capability for auto-evaluation

The app should keep these concerns explicit rather than assuming a single opaque provider path.

## LD-CAP-005 — No Silent Contract Rescue

If generation output, evaluation output, or writeback payloads are malformed, mistyped, or structurally invalid, Lookdev must fail closed.

It must not fabricate pseudo-success item states to keep a batch moving.

## LD-CAP-006 — Realm Boundary Preservation

Lookdev must preserve the architecture split:

- Realm remains the only persistent shared truth source
- Runtime remains the local inference plane
- Lookdev remains a first-party app control plane

The app must not smuggle runtime working artifacts into Realm without explicit commit semantics.
