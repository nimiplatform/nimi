# SDKS Core Family

`sdks/` is the active SDK family source. `sdks/typescript` is the vNext
implementation target for the next major `@nimiplatform/sdk` package.

The archived pre-vNext TypeScript SDK lives under
`archive/sdk-pre-vnext-20260606/` as baseline evidence only. It is not an active
package root and must not regain implementation or authority ownership.

Current scope:

- TypeScript is the only full implementation target: Runtime, Realm, app, AI,
  agent, features, adapters, testing, and migration proofs.
- Python, Go, and Rust remain generated Runtime/Realm core only until the
  TypeScript implementation is stable.
- Generated files are produced through `sdks/generators`; do not hand-edit
  generated outputs.
- Adapter packages stay source-local/private until owner-approved public package
  names and compatibility promises are accepted.

Generation:

```bash
node sdks/generators/generate.mjs
node sdks/generators/generate.mjs --check
```

Realm OpenAPI resolution uses `config/realm-openapi-source.json`, with relative
paths resolved from the repo root. If that source is not present in a worktree,
set `NIMI_REALM_OPENAPI_PATH` to the canonical OpenAPI file before running the
generator. Realm typed-client generation fails closed when OpenAPI is
unavailable; spec tables are not REST schema fallback authority.

Conformance:

```bash
node sdks/conformance/run.mjs --language all --profile typed-core
```

The conformance runner validates generated manifest parity and generated
Runtime/Realm core behavior. TypeScript handwritten surfaces have their own
package tests and SDK matrix gates.
