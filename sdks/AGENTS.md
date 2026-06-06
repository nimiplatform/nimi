# sdks/ AGENTS.md
## Scope
- Applies to `sdks/**`.
- `.nimi/spec/sdks/**` owns the new SDK family.
- `sdks/typescript/**` is the TypeScript-first next major `@nimiplatform/sdk`.
- Python/Go/Rust stay generated Runtime/Realm core until TypeScript stabilizes.
## Hard Boundaries
- Do not restore active `sdk/**`; archived SDK history is baseline evidence only.
- Do not create forwarding packages, old-name aliases, or compatibility shims.
- Do not hand-edit generated files; regenerate through `sdks/generators`.
- Generated facts come from Runtime proto, Realm OpenAPI, or admitted spec.
- Adapter public surfaces live in adapter packages, not base SDK shims.
- Unsupported capability fails closed. No pseudo-success or hidden bypass.
## Retrieval Defaults
- Start in `sdks/typescript`, `sdks/generators`, `sdks/conformance`, and `.nimi/spec/sdks/kernel`.
- For generated drift, inspect proto/OpenAPI input before generated output.
- Skip `archive/**`, `**/dist/**`, `**/generated/**`, and dependency folders.
## Verification Commands
- `node sdks/generators/generate.mjs --check`
- `node sdks/conformance/run.mjs --language all --profile typed-core`
- `pnpm --filter @nimiplatform/sdk build`
- `pnpm --filter @nimiplatform/sdk test`
- `pnpm check:sdk-vnext-matrix`
