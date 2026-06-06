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
- Unsupported behavior: fail closed with
  `unsupported_openai_compat_feature`.
