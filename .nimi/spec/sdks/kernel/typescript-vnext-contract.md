# TypeScript vNext Contract

Status: active product authority.

`sdks/typescript` is the next major implementation target for
`@nimiplatform/sdk`.

Public source-root targets:

- `core/contracts`
- `core/ai`
- `core/agent`
- `core/testing`
- `features/conversation`
- `features/knowledge-context`
- `features/memory-context`
- `features/generation`
- `features/workflow`
- `features/evaluation`
- `features/toolkits`
- `adapters/vercel-ai`
- `adapters/openai-compatible`
- `adapters/mcp`
- `adapters/mastra`
- `adapters/langgraph`
- `adapters/llamaindex`
- `adapters/react`
- `adapters/next`
- `doctor`

Doctor boundary:

- `doctor` is the independent migration-assessment package
  (`@nimiplatform/sdk-doctor`), not a base SDK subpath and not an adapter.
- It performs read-only static analysis of an external app: it must not
  execute target code, reach the network, or mutate the scanned project.
- Its only framework-API-to-capability authority is
  `tables/framework-api-capability-map.yaml`; adapter capability truth stays
  in adapter manifests and `tables/typescript-adapter-capability-ledger.yaml`.
  The doctor must not carry private mappings or infer capabilities.
- A detected target-framework API absent from the map must be reported as
  `unknown-api`; it must never be silently skipped or counted as supported.
- Doctor output is a developer assessment projection only. It is not an
  admission evidence surface and creates no capability claim.

OpenAI-compatible boundary:

- Adapter v1 is a strict Chat Completions-compatible migration bridge only.
- Supported endpoint shape: `chat.completions.create`.
- Supported modes: non-streaming and streaming.
- Supported inputs: common chat generation parameters, function-tool
  definitions, `tool_choice`, `response_format`, and message roles
  `system`/`developer`/`user`/`assistant`/`tool`.
- Tool semantics: return OpenAI-style `tool_calls`; do not execute tools inside
  the adapter.
- Unsupported surfaces: `/v1/responses`, `/v1/completions`, `/v1/embeddings`,
  OpenAI built-in tools, file search, web search, code interpreter, stored chat
  completion CRUD, logprobs, `n > 1`, general OpenAI API compatibility, and
  Runtime REST bypass promises.
- Unsupported behavior: fail closed with `SDK_ADAPTER_FEATURE_UNSUPPORTED`.
