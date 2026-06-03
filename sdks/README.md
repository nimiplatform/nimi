# SDKS Core Family

`sdks/` is the Phase 1 multi-language Runtime/Realm core-family foundation.
It is separate from the current `sdk/` TypeScript package, which remains active
for existing Desktop/Web consumers.

Phase 1 includes:

- shared Runtime core manifests generated from `proto/runtime/v1/*.proto`
- shared Realm core manifests generated from Realm OpenAPI when available
- per-language generated Runtime and Realm clients for TypeScript, Python, Go,
  and Rust
- shared spec-derived manifests for SDK error codes and export surfaces
- minimal handwritten core-client glue for transport, auth metadata, timeout,
  cancellation, streaming, and unsafe raw access
- language-neutral conformance checks that execute generated clients through
  fake transports

Generation:

```bash
node sdks/generators/generate.mjs
node sdks/generators/generate.mjs --check
```

Realm OpenAPI resolution uses `config/realm-openapi-source.json`, with relative
paths resolved from the repo root. If that source is not present in a worktree,
set `NIMI_REALM_OPENAPI_PATH` to the canonical OpenAPI file before running the
generator. Realm typed-client generation fails closed when OpenAPI is
unavailable; spec fallback records are not sufficient schema authority for
generated Realm clients.

Conformance:

```bash
node sdks/conformance/run.mjs --language all
```

The conformance runner validates generated manifest parity and then runs
per-language behavior checks for unary calls, server streams, Realm operations,
metadata propagation, timeout/cancellation posture, error projection, and unsafe
raw transport access. These commands are local Phase 1 foundation checks. They
are not wired into the repo release gates until admitted by the SDK kernel.

Phase 1B raises the completion bar from descriptor-driven generated clients to
typed public core APIs. For Phase 1B, generated clients must expose named,
typed Runtime methods and Realm operation functions in TypeScript, Python, Go,
and Rust. Shared conformance must invoke those typed APIs through fake
transports. Generic descriptor calls remain low-level support and are not
normal core-ready proof.
