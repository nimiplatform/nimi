# Vercel AI Upstream Compatibility Matrix

Status: active test plan
Adapter: `sdks/typescript/adapters/vercel-ai`
Target package: `ai@6.0.x`, `@ai-sdk/provider@3.0.x`
Pinned upstream tag: `vercel/ai@ai@6.0.190`
Pinned upstream commit: `6f2761c7453f0a29c65e052f6ebd05a8e1933aab`

`vercel/ai` `main` has moved beyond this adapter's current Vercel dependency
surface and uses `LanguageModelV4` in core tests. This matrix is pinned to the
installed `ai@6.0.190` / `@ai-sdk/provider@3.0.10` contract. V4 migration is a
separate adapter-generation decision, not evidence that the V3 adapter failed
the current dependency contract.

## Policy

The compatibility suite should exercise Vercel AI SDK public behavior through
the public `ai`, `@ai-sdk/provider`, and `ai/test` entrypoints. Do not vendor the
Vercel repository's internal test files as a second source of truth. When an
upstream test checks an internal helper, translate the externally observable
contract into an adapter test or classify it out of domain.

The goal is interface coverage, not Runtime implementation selection. Tests
should expose adapter mapping gaps and Nimi protocol gaps. Runtime/provider
execution failures must fail closed instead of being hidden by adapter shims.

## Executable Coverage

`vercel-ai.conformance.test.ts` currently covers:

- `generateText` basic text, usage, reasoning, tool calls, caller tool execution,
  approvals, multi-step loops, provider options, tool choice, top-k
- `streamText` text, reasoning, tool calls, multi-step loops, errors
- `generateObject` and `streamObject` structured output through Vercel
- multimodal image/audio/video file input mapping
- Runtime-style provider construction

`vercel-ai.upstream-compat.test.ts` imports the split executable suite:
`vercel-ai.upstream-text-compat.test.ts`,
`vercel-ai.upstream-tool-compat.test.ts`, and
`vercel-ai.upstream-object-compat.test.ts`. Together they currently cover:

- top-level provider metadata, request body, response id/model/headers/body
- generated and streamed URL/document sources through result/content/UI streams
- `includeRawChunks` request forwarding and raw stream part surfacing
- provider-executed tool calls not invoking caller `tool({ execute })`
- provider-defined tool request forwarding from Vercel high-level calls
- provider-executed tool results/errors through content, full stream, UI stream,
  and static tool-result projections
- invalid caller tool input and thrown caller tool execution as framework
  `tool-error` parts
- provider approval approved/denied continuation back into the Nimi prompt
- async iterable caller tool execution final result semantics in `generateText`
- streamed async iterable caller tool preliminary/final results
- multi-step `onStepFinish`/`onFinish` callback ordering and total usage
  aggregation
- thrown model stream errors rejecting `textStream` consumers
- `streamText` `onChunk` / `onFinish` callback ordering for adapter stream
  deltas
- `generateObject` repair and no-object failure behavior
- `generateText` `Output.object` / `Output.array` / `Output.choice`
- `streamObject` array element stream, enum output, and no-schema JSON

## Remaining Upstream Test Clusters

| Cluster | Target local test file | Status | Notes |
|---|---|---|---|
| `generateText` result metadata, steps, callbacks, warnings | `vercel-ai.upstream-text-compat.test.ts`, `vercel-ai.upstream-tool-compat.test.ts` | partial | Response/provider metadata, `onStepFinish`, `onFinish`, and `totalUsage` are covered. Add warning callback/logging parity only if project exposes Vercel logger hooks. |
| `generateText` tool error and repair behavior | `vercel-ai.upstream-tool-compat.test.ts` | partial | Provider-executed results/errors, invalid tool input, thrown `execute`, and approved/denied provider continuation are covered. Add tool-call repair retry and response message threading edge cases. |
| `streamText` full stream protocol | `vercel-ai.upstream-text-compat.test.ts`, `vercel-ai.upstream-tool-compat.test.ts` | partial | Sources, raw chunks, provider-executed results/errors, UI stream projection, preliminary streamed tool results, `onChunk`, and `onFinish` are covered. Add provider metadata on finish and abort behavior. |
| `generateObject` / `streamObject` modes | `vercel-ai.upstream-object-compat.test.ts` | partial | Schema object, repair/no-object failure, `Output.object/array/choice`, stream array/enum/no-schema are covered. Add stream repair markdown/error edge cases. |
| UI message conversion and stream protocol | future `vercel-ai.ui-compat.test.ts` | pending | Only include behavior that depends on `LanguageModelV3` provider output; pure UI utility tests remain Vercel-owned. |
| middleware behavior | future `vercel-ai.middleware-compat.test.ts` | pending | Include only externally visible wrapping behavior around a Nimi model. |
| telemetry | future `vercel-ai.telemetry-compat.test.ts` | pending | Needs explicit project decision because telemetry may require optional dependencies and stable span names. |
| provider-utils internal tests | none | out-of-domain | Covered by Vercel package itself unless a behavior crosses the public provider contract. |
| non-language modalities | none | out-of-domain for this adapter | Embedding/image/speech/rerank providers are not implemented by `createNimiVercelLanguageModel`. |

## Next Iterations

1. Expand `generateText` upstream-compatible tests for tool-call repair retry
   and response message threading edge cases.
2. Expand `streamText` tests for abort propagation and provider metadata on
   every stream part.
3. Add object-generation stream repair edge cases that force Vercel's markdown
   extraction and failed-repair paths through the adapter.
4. Add UI-message compatibility only after separating pure Vercel UI utilities
   from adapter-observable behavior.
