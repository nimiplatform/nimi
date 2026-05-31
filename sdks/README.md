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

Realm OpenAPI resolution uses `config/realm-openapi-source.json`. If the
configured relative source is not present in a worktree, set
`NIMI_REALM_OPENAPI_PATH` to the OpenAPI file before running the generator.
Generated provenance records the environment source label, not the absolute
path.

Conformance:

```bash
node sdks/conformance/run.mjs --language all
```

The conformance runner validates generated manifest parity and then runs
per-language behavior checks for unary calls, server streams, Realm operations,
metadata propagation, timeout/cancellation posture, error projection, and unsafe
raw transport access. These commands are local Phase 1 foundation checks. They
are not wired into the repo release gates until admitted by the SDK kernel.
