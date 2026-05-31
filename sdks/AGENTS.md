# sdks/ AGENTS.md

## Scope

- Applies to `sdks/**`.
- This tree is the Phase 1 multi-language Runtime/Realm core-family foundation.
- Phase 1 means generated Runtime/Realm core implementation plus behavior
  conformance. Manifest-only parity, directory presence, and thin skeletons are
  not sufficient completion evidence.

## Boundaries

- Do not switch Desktop/Web imports to `sdks/**`.
- Do not refactor or move the current `sdk/` package from this tree.
- Do not create forwarding packages or compatibility shims between `sdk/` and
  `sdks/`.
- Core-generated facts must come from Runtime proto, Realm OpenAPI, or admitted
  spec tables. Do not copy method IDs, codec maps, Realm operation maps, error
  tables, or export manifests from `sdk/src/**`.
- Derivative surfaces such as `ai-provider`, `world`, app clients, permission
  clients, AI config, runtime route, local environment helpers, Agno, LangChain,
  and Vercel AI SDK adapters are outside Phase 1 core readiness.
- OpenAI-compatible APIs, tool loops, agent loops, memory/session
  orchestration, and structured-output repair helpers are outside Phase 1 core
  readiness.
- Runtime AIService typed consume coverage is in scope because it is part of
  Runtime proto; external framework semantics are not.
- Conformance must invoke generated clients through fake transports. Do not
  count manifest comparison or file-existence checks as core readiness.

## Verification

- `node sdks/generators/generate.mjs --check`
- `node sdks/conformance/run.mjs --language all`
