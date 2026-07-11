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

## Runtime LocalAgent boundary

Realm-backed LocalAgents use one typed workflow: Runtime issues the source
materialization challenge, Realm returns the generated packet-v2 DTO, and
Runtime `CommitSourceMaterialization` atomically creates the immutable source
snapshot and LocalAgent. `InitializeAgent` is not a second Realm materialization
step.

Public consumers receive only the strict SDK projections
`NimiRuntimeAgentSourceContextStatus` and
`NimiRuntimeAgentTurnContextSummary`. Unknown or partial schemas, enums,
coverage, lanes, budgets, truncation, hashes, or identity correlations fail
closed. These projections never carry raw source/world text, prompts, lane
content, transcript text, private memory, packet proof, provider payloads, or
tool arguments/results.

LocalAgent turns accept exactly one current-user text message. Callers cannot
submit a system prompt, world/context attachment, execution binding, media
payload, assistant/tool history, or additional message. Generic app AI prompt
support is a separate SDK surface and is unchanged.
