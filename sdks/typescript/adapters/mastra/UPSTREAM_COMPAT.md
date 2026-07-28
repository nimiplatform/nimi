# Mastra Upstream Compatibility Matrix

Status: active test plan
Adapter: `sdks/typescript/adapters/mastra`
Target package: `@mastra/core@1.41.x`
Pinned upstream version: `@mastra/core@1.41.0`
Pinned upstream tag: `@mastra/core@1.41.0` (monorepo `github.com/mastra-ai/mastra`; annotated tag `6c437c7bfdf88b835f0b5875545458ab9c9d023e`, peeled source commit `a584d8f7c81aeb07832adfd0a4ddd04cae73e3fa`)

## Why this version

`@mastra/core@1.41.0` depends on both `@ai-sdk/provider-v5` (`@ai-sdk/provider@2.0.3`,
`LanguageModelV2`) and `@ai-sdk/provider-v6` (`@ai-sdk/provider@3.0.10`,
`LanguageModelV3`). Mastra's `MastraModelConfig` admits a raw `LanguageModelV3`, so
this adapter owns its own Nimi → `LanguageModelV3` mapping (`mappers.ts`,
`raw-metadata.ts`, `@ai-sdk/provider@3.0.10`, `specificationVersion: 'v3'`) and
pins the Mastra version whose AI-SDK-v6 surface it validates against. The mapping
shape overlaps the Vercel adapter today, but the Mastra adapter does not depend on
it — a shared `ai-sdk-v3` bridge package is deliberately deferred until Vercel,
Mastra, and a third consumer stabilize, so the duplication is controlled and
self-owned (enforced by `mastra.boundary.test.ts`). This matrix tracks the
installed `@mastra/core@1.41.0` contract, not upstream `main`.

## Policy

The compatibility suite exercises Mastra public behavior through the public
`@mastra/core/agent`, `@mastra/core/tools`, and `@mastra/core/llm` entrypoints. Do
not vendor Mastra's internal repository test files as a second source of truth.
When an upstream test checks a Mastra internal, translate the externally observable
Agent/tool/structured-output contract into an adapter test or classify it
out of domain.

The goal is Mastra target-library **LLM execution-layer** coverage, not Runtime
route ownership or Nimi localAgent-state ownership. Tests expose adapter mapping gaps
and Nimi protocol gaps; Runtime/provider route gaps fail closed with the adapter's
own typed `NimiMastraUnsupportedFeatureError` rather than being hidden by a shim.
Mastra-owned orchestration is supported only when it drives repeated model calls
(tool execution, multi-step, structured-output parsing, callbacks) or consumes
explicit Nimi Runtime-backed helper surfaces (embedding, speech synthesis,
speech transcription). Surfaces that own durable localAgent lifecycle, memory,
knowledge, or workflow state are compatibility-only until bound to Nimi
Runtime/Cognition owner surfaces.

## Executable Coverage

`mastra.conformance.test.ts` drives a real Mastra `Agent` (and the adapter's
`LanguageModelV3` interface Mastra calls) over `createNimiMastraModel`, covering:

- `Agent.generate` text, usage, finish reason; system-instruction threading
- `Agent.stream` text-delta streaming, resolved finish reason, and `fullStream` chunks
- `createTool` definition forwarding, Mastra-owned tool execution, tool-result
  propagation, and the multi-step agent loop; `toolChoice` forwarding
- `structuredOutput` json-schema response-format forwarding and the validated `.object`
- Nimi source mapping (Mastra `payload.url` source chunks) and reasoning (`reasoningText`)
- `createNimiMastraProvider` Runtime-routed model construction accepted by an Agent
- abort-signal forwarding onto the Nimi request
- `onFinish` / `onStepFinish` callbacks firing with adapter output
- `requireToolApproval` suspension before tool execution, plus fail-closed
  approve/resume when no Mastra snapshot storage is configured; this identifies
  the storage/lifecycle owner gap instead of fabricating an approval continuation.
- structured-output **no-object failure** failing closed (Mastra rejects; the adapter
  never fabricates an object)
- dynamic model/instructions resolution accepting the adapter model
- `includeRawChunks` forwarding and raw stream-part surfacing
- file input parts mapping onto Nimi file parts (binary base64 / URL passthrough)
- **Nimi Runtime context bridge**: `createNimiMastraContextBridge` loads Nimi
  AI context providers, including Runtime memory/knowledge providers, and
  injects their per-turn material through Mastra `Agent.generate()`/`stream()`
  `context` without configuring or persisting Mastra Memory.
- **Mastra Memory compatibility**: a memory-enabled agent threads prior-turn
  context into the model across turns (verified with `MockMemory`); this does not
  bind Mastra memory to Nimi Runtime/Cognition canonical memory.
- **Mastra Workflow compatibility**: a Nimi-backed text model runs inside a
  `createWorkflow`/`createStep` step to `status: 'success'`; this does not make
  Mastra workflow checkpoint/lifecycle state Nimi-owned.
- **Mastra RAG / embedding compatibility**: `createNimiMastraEmbeddingModel`
  returns an AI SDK `EmbeddingModelV3` / Mastra-supported embedder backed by
  Nimi Runtime `TEXT_EMBED`; Mastra vector and semantic-memory helpers may
  consume the embedder without owning Nimi Memory/Knowledge truth.
- **Mastra Voice compatibility**: `createNimiMastraVoice` maps `speak()` to
  Runtime speech synthesis, `listen()` to Runtime speech transcription, and
  `getSpeakers()` to Runtime preset/voice-asset catalogs. Runtime artifact bytes
  remain Runtime-owned. Runtime Scenario idempotency keys are caller-supplied and
  fail closed; the adapter never fabricates idempotency keys. Mastra realtime
  `connect/send/answer` fails closed until a Runtime realtime-session bridge is
  admitted.

`mastra.upstream-compat.test.ts` aggregates `mastra.upstream-text-compat.test.ts`,
`mastra.upstream-tool-compat.test.ts`, `mastra.upstream-object-compat.test.ts`, and
`mastra.upstream-runtime-surface.test.ts`: multi-turn history forwarding,
`usage`/`totalUsage`, streamed `.text` consistency, thrown-model-error fail-close;
multiple-tool forwarding with single-tool execution, active-tool filtering,
tool-result threading, specific `toolChoice: { type: 'tool' }`, three-step
sequential tool loop, stream `stopWhen` after a tool step; nested/array/enum
schemas and streamed `structuredOutput`; provider option/model setting forwarding;
direct `Agent.voice` compatibility; and `SemanticRecall` accepting the Runtime-backed
Nimi embedder contract.

One upstream-observed Mastra wrapper rule is intentionally captured in
`mastra.upstream-runtime-surface.test.ts`: for `Agent.stream()`, the published
`@mastra/core@1.41.0` LLM stream wrapper replaces user `stopWhen` with
`stepCountIs(maxSteps)` when `maxSteps` is also provided. The adapter does not
override this framework-owned loop rule; migration code that needs a custom
`stopWhen` stop after a tool step should not pass `maxSteps` on that call.

`mastra.test.ts` additionally covers the `LanguageModelV3` model shape, the generate
request mapping, **typed fail-closed errors** (`NimiMastraUnsupportedFeatureError`
`instanceof` + `code` + `feature` for missing model, unsupported streaming, provider
misconfiguration, and unknown model id), the Runtime delegated tool typed
approval-required error/resume helper, and the capability manifest, and imports
the boundary + conformance + upstream suites so the single-file adapter capability
ledger gate runs the whole suite. `mastra.boundary.test.ts` asserts no source
imports the vercel-ai sibling adapter, no package dependency on it, and no
vercel-ai directory/import in the built `dist`.

## Remaining / Partial Upstream Test Clusters

These match the `partial` capability claims in `manifest.ts` and the ledger; they
are not blurred into the supported set.

| Cluster | Manifest capability | Status | Notes |
|---|---|---|---|
| `requireToolApproval` human-in-the-loop | `toolApproval` (partial) | partial | Model-level tool-approval-request/response parts are mapped in `mappers.ts`; Mastra native `requireToolApproval` suspension before execution is verified. Approve/deny resume requires Mastra snapshot storage (`AGENT_RESUME_NO_SNAPSHOT_FOUND` without it) and is not bound to a current Nimi Runtime-owned lifecycle surface. |
| tool suspend / resume | `toolSuspendResume` (partial) | partial | Model tool-calls are mapped; Mastra `createTool` suspend/resume orchestration (suspendSchema/resumeSchema pause + resume) is not yet exercised through Nimi. |
| structured-output repair retry | `structuredOutputRepair` (partial) | partial | No-object failure is verified fail-closed; Mastra's repair retry path (fixing malformed JSON) is not yet exhaustively exercised. |
| reasoning / providerMetadata / providerOptions / multimodal acceptance | `reasoning`, `providerMetadata`, `providerOptions`, `multimodalInput` (partial) | partial | Mapped by the adapter; end-to-end surfacing/acceptance is Runtime-route-dependent. |
| Memory / durable context | `memory` (partial), `runtimeContext` (supported) | partial | Mastra Memory can inject prior-turn context into the Nimi text-model prompt, but the store remains Mastra-owned. `NimiMastraContextBridge` now supports per-turn Nimi Runtime-owned memory/knowledge context injection through Mastra `context`; remaining gaps are conversation writeback, thread/resource lifecycle, and any Mastra Memory-compatible persistence contract. |
| Workflows / lifecycle state | `workflows` (partial) | compatibility-only | Mastra Workflow steps can call a Nimi-backed text model, but workflow lifecycle/checkpoint/suspend state remains Mastra-owned. Nimi-owned workflow/localAgent lifecycle must use Runtime owner surfaces. |
| telemetry / tracing spans | `telemetry` (not-applicable) | out-of-domain | Mastra tracing is framework-owned observability, not a model interface; the adapter emits no Mastra spans. A future decision could add span emission. |
| agent networks / multi-agent routing | `agentNetwork` (partial) | partial | Network members can use Nimi-backed text models, but routing/hand-off and shared state are not bound to Nimi Runtime/Cognition owner surfaces. |
| workflow checkpoint / suspend-resume durable state; evals/scorers/processors | `workflowCheckpoint` (not-applicable) | out-of-domain | Above-the-model framework orchestration and durable state; persistence/scoring is Mastra-owned in this path, not an adapter capability. Nimi-owned checkpointing belongs in Runtime workflow/localAgent owner surfaces. |
| RAG / vector recall | `ragEmbeddings` | supported | `createNimiMastraEmbeddingModel` exposes Runtime `TEXT_EMBED` as AI SDK `EmbeddingModelV3`; vector store persistence and canonical Memory/Knowledge state are still not owned by Mastra. |
| Voice STT/TTS | `voice` (partial) | partial | `createNimiMastraVoice` supports `speak()`/`listen()`/`getSpeakers()` through Runtime speech and voice catalog surfaces. Runtime Scenario idempotency keys are caller-supplied and fail closed; the adapter never fabricates them. Realtime `connect/send/answer` remains fail-closed until Runtime realtime-session ownership is bridged. |
| legacy `generateLegacy` / `streamLegacy` | `legacyV1Api` (not-applicable) | out-of-domain | Require `LanguageModelV1`; the adapter targets Mastra's modern V2/V3 model interface backing `generate()`/`stream()`. |
| model-router strings (`'openai/gpt-4'`) | `modelRouterString` (not-applicable) | out-of-domain | Mastra provider-registry routing hits external providers; Nimi routing is Runtime-owned (S-AIP-001). |

## Next Iterations

1. Keep Mastra native `requireToolApproval` classified as framework-owned partial;
   graduate only the Runtime-owned delegated tool path unless a future admitted
   bridge replaces Mastra snapshot storage.
2. Exercise Mastra `createTool` suspend/resume through the adapter to graduate
   `toolSuspendResume`.
3. Add structured-output repair-retry cases (malformed-then-repaired JSON) to
   graduate `structuredOutputRepair`.
4. Extend the Runtime context bridge from per-turn injection to owner-complete
   conversation writeback/thread lifecycle if Mastra Memory API compatibility is
   required.
5. Add a Runtime realtime-session voice bridge before promoting Mastra realtime
   voice beyond fail-closed partial support.
6. Add a Runtime-owned localAgent lifecycle/workflow bridge before promoting workflow
   and agent-network state beyond compatibility-only.
