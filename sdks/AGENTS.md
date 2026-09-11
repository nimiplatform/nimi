# sdks/ AGENTS.md
## Scope
- Applies to `sdks/**`.
- `.nimi/spec/sdks/*.authority.yaml` owns the SDK family.
- `sdks/typescript/**` is the active TypeScript implementation of `@nimiplatform/sdk`.
- Python/Go/Rust stay generated Runtime/Realm core until TypeScript stabilizes.
## Hard Boundaries
- Do not restore active `sdk/**`; archived SDK history is baseline evidence only.
- Do not create forwarding packages, old-name aliases, or compatibility shims.
- Do not hand-edit generated files; regenerate through `sdks/generators`.
- Generated facts come from Runtime proto, Realm OpenAPI, or admitted spec.
- Adapter public surfaces live in adapter packages, not base SDK shims.
- Unsupported capability fails closed. No pseudo-success or hidden bypass.
## Retrieval Defaults
- Start in the affected SDK implementation and its direct test or consumer. Read the relevant generator for generated changes, conformance code for shared language contracts, and exact authority units when semantics or ownership are unresolved.
- For generated drift, inspect proto/OpenAPI input before generated output.
- Skip `archive/**`, `**/dist/**`, `**/generated/**`, and dependency folders.
## Verification Commands
- Handwritten TypeScript changes: run the directly affected tests and `pnpm --filter @nimiplatform/sdk build`; run `pnpm --filter @nimiplatform/sdk test` for shared behavior or public API changes.
- Generator or proto/OpenAPI input changes: run `node sdks/generators/generate.mjs --check` after regenerating affected output.
- Shared typed-core or cross-language contract changes: run `node sdks/conformance/run.mjs --language all --profile typed-core`.
