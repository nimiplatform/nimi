import type { NimiCapabilityManifest } from '@nimiplatform/sdk/contracts';

export const NIMI_MASTRA_ADAPTER_ID = 'mastra' as const;

// Mastra's text model boundary is the AI SDK provider `LanguageModelV3` admitted
// by `MastraModelConfig` (Mastra's `@ai-sdk/provider-v6` alias). The package also
// exposes Runtime-backed embedding and voice surfaces for Mastra migration code;
// those surfaces stay separate from the text-model mapper and do not claim
// Memory/Knowledge/voice asset ownership.
//
// `support` answers whether the named Mastra interface is covered without changing
// the Nimi ownership model. Mastra-owned orchestration can be supported when it only
// drives repeated model calls (tools, multi-step, callbacks, structured output).
// Mastra surfaces that imply durable agent state, memory, knowledge, or workflow
// ownership are not promoted to supported by a text-model adapter: they remain
// `partial` compatibility until wired to Nimi Runtime/Cognition owner surfaces.
export const NIMI_MASTRA_ADAPTER_MANIFEST = {
  adapterId: NIMI_MASTRA_ADAPTER_ID,
  targetLibrary: 'Mastra',
  targetVersionRange: '@mastra/core@^1.41.0',
  // L4 (Context): per-turn Runtime-owned memory/knowledge context injection
  // plus Runtime-owned RAG embeddings are conformance-verified, and every
  // durable framework-state cluster carries an explicit S-AIP-009
  // lifetime/reconstructibility classification (see partial-cluster gaps).
  capabilityLevel: 'L4',
  capabilities: {
    'model.config': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'A NimiAiModel maps to a LanguageModelV3 that satisfies Mastra MastraModelConfig and is accepted by new Agent({ model }).',
    },
    'agent.generate': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Mastra Agent.generate() text/usage/finishReason runs through the adapter-owned model.doGenerate.',
    },
    'agent.stream': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Mastra Agent.stream() textStream/fullStream is driven by Nimi streamText through the adapter-owned doStream mapping.',
    },
    'tools.definition': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Mastra createTool definitions are forwarded to the model as LanguageModelV3 function tools.',
    },
    'tools.toolChoice': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Mastra toolChoice (auto/required/none/tool) is mapped onto the Nimi request.',
    },
    'tools.execution': {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Mastra runs createTool.execute; the adapter maps the model tool-call request and the tool-result round trip.',
    },
    'tools.resultPropagation': {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Mastra feeds tool results back into the next model call; tool-call/tool-result messages map both directions.',
    },
    multiStep: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Mastra multi-step agent loops are usable through repeated adapter-backed model calls.',
    },
    agentCallbacks: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Mastra onFinish/onStepFinish callbacks fire with the adapter-produced text, usage, and finish reason.',
    },
    structuredOutput: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Mastra structuredOutput { schema } maps a json-schema response format onto the Nimi request; Mastra produces the validated .object.',
    },
    structuredOutputFailure: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'When the model returns unparseable output, Mastra fails closed with a structured-output validation error; the adapter never fabricates an object.',
    },
    dynamicResolution: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Mastra dynamic model/instructions functions can resolve to the adapter model; the resolved model drives generate/stream unchanged.',
    },
    runtimeContext: {
      support: 'supported',
      mode: 'runtime-owned',
      note: 'createNimiMastraContextBridge loads Nimi AI context providers (including Runtime memory/knowledge providers) and injects their per-turn material through Mastra Agent.generate()/stream() context without configuring or persisting Mastra Memory.',
    },
    runtimeDelegatedTools: {
      support: 'supported',
      mode: 'runtime-owned',
      note: 'createNimiMastraRuntimeDelegatedTool lets a Mastra tool call execute through Nimi Runtime ExecuteDelegatedCapability, fail closed with a typed approval-required error carrying the Runtime approval request id, and resume approved execution through Runtime ResumeDelegatedCapability without using Mastra snapshot storage. createNimiMastraRuntimeDelegatedToolBinding centralizes explicit Nimi turn/provider lineage for migration code without inferring Mastra-owned run state.',
    },
    usage: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Nimi usage maps to LanguageModelV3 usage surfaced as Mastra usage/totalUsage.',
    },
    finishReason: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Nimi finish reasons map to Mastra finishReason.',
    },
    sources: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Nimi URL/document sources map to LanguageModelV3 source parts surfaced as Mastra output sources.',
    },
    rawChunks: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'includeRawChunks is forwarded; Nimi raw events surface as LanguageModelV3 raw stream parts.',
    },
    abort: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'A Mastra/AI-SDK abort signal is forwarded onto the Nimi request signal.',
    },
    errors: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Model errors surface through Mastra; unsupported adapter features fail closed with NimiMastraUnsupportedFeatureError.',
    },
    reasoning: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Reasoning parts map only when the Nimi route emits reasoning content.'],
    },
    providerMetadata: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Provider metadata is projected into request/response metadata; provider-side honoring is Runtime-route-owned.'],
    },
    providerOptions: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Provider options are projected into request metadata for visibility; native honoring is Runtime-route-owned.'],
    },
    multimodalInput: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Image/audio/video/document file parts are mapped (binary base64, URL passthrough); provider acceptance is route-dependent.'],
    },
    toolApproval: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: [
        'Model-level tool-approval-request/response parts are mapped; Mastra native requireToolApproval suspension is verified, but approve/deny resume requires Mastra snapshot storage and is not bound to Nimi Runtime-owned lifecycle state. Use runtimeDelegatedTools for the Nimi Runtime-owned approval/resume path.',
        'S-AIP-009: persisted approval snapshots live in Mastra storage (cross-process lifetime, not reconstructible from Nimi truth) and are framework-owned-non-canonical; the adapter holds no approval state itself and never writes it into Nimi surfaces.',
      ],
    },
    toolSuspendResume: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: [
        'Model tool-calls are mapped; Mastra createTool suspend/resume orchestration is not yet exercised through Nimi.',
        'S-AIP-009: suspended-tool state persisted by Mastra storage is durable framework state (cross-process, not reconstructible from Nimi truth) and stays framework-owned-non-canonical.',
      ],
    },
    structuredOutputRepair: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: [
        'No-object failure is verified fail-closed; Mastra structured-output repair retry paths are not yet exhaustively exercised.',
        'S-AIP-009: repair loops are in-process and reconstructible from the caller request — orchestration ephemera, no durable framework state in this cluster.',
      ],
    },
    memory: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: [
        'A Mastra-Memory-enabled agent can thread prior-turn context into a Nimi text-model call (verified with MockMemory), but this adapter does not bind Mastra memory to Nimi Runtime/Cognition canonical memory.',
        'NimiMastraContextBridge supports per-turn Nimi Runtime-owned memory/knowledge context injection through Mastra context, but it does not yet own conversation writeback, thread/resource lifecycle, or a Mastra Memory-compatible persistence contract.',
        'S-AIP-009: Mastra Memory threads/messages persist in Mastra storage — cross-process lifetime, not reconstructible from Nimi truth — and are declared framework-owned-non-canonical: they must never be read or written as Nimi session/memory truth. Nimi-owned context flows only through the per-turn bridge and runtime.agent.* surfaces.',
      ],
    },
    workflows: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: [
        'A Nimi-backed text model can be called inside a Mastra Workflow step (verified with createWorkflow/createStep), but workflow lifecycle/checkpoint ownership remains Mastra-owned and is not Nimi Runtime workflow state.',
        'A Nimi-owned localAgent/workflow bridge must use Runtime localAgent/workflow owner surfaces; this adapter only supplies the model each step drives.',
        'S-AIP-009: workflow run/suspend/checkpoint state persists in Mastra storage — durable framework state, not reconstructible from Nimi truth — declared framework-owned-non-canonical.',
      ],
    },
    agentNetwork: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: [
        'A Mastra network can use Nimi-backed text models per member, but multi-agent lifecycle, routing, hand-off, and shared state are not yet bound to Nimi Runtime/Cognition owner surfaces.',
        'S-AIP-009: any persisted network routing/shared state lives in Mastra storage as durable framework state (not reconstructible from Nimi truth) and stays framework-owned-non-canonical.',
      ],
    },
    workflowCheckpoint: {
      support: 'not-applicable',
      mode: 'out-of-domain',
      note: 'Workflow checkpoint/resume/suspend durable state is not a text LanguageModelV3 interface. A Nimi-owned implementation must live in Runtime workflow/localAgent owner surfaces, not in this adapter.',
    },
    ragEmbeddings: {
      support: 'supported',
      mode: 'runtime-owned',
      note: 'createNimiMastraEmbeddingModel exposes an AI SDK EmbeddingModelV3 backed by Nimi Runtime TEXT_EMBED. Mastra RAG/vector/semantic-memory helpers can consume the embedder, while Runtime/Cognition remain owner of embedding route, credentials, canonical Memory/Knowledge banks, and vector substrate readiness.',
    },
    voice: {
      support: 'partial',
      mode: 'runtime-owned',
      gaps: [
        'createNimiMastraVoice supports Mastra speak()/listen()/getSpeakers() through Runtime speech synthesis, speech transcription, preset voice catalog, voice asset catalog, and Runtime artifact byte reads. Runtime Scenario idempotency keys are caller-supplied and fail closed; the adapter never fabricates idempotency keys.',
        'Mastra realtime connect/send/answer is intentionally fail-closed until bound to Nimi Runtime realtime session owner surfaces.',
      ],
    },
    telemetry: {
      support: 'not-applicable',
      mode: 'out-of-domain',
      note: 'Mastra tracing/telemetry spans are framework-owned observability, not a model interface; the adapter emits no Mastra spans.',
    },
    legacyV1Api: {
      support: 'not-applicable',
      mode: 'out-of-domain',
      note: 'Mastra generateLegacy/streamLegacy require LanguageModelV1; the adapter targets the modern V2/V3 model interface that backs generate()/stream().',
    },
    modelRouterString: {
      support: 'not-applicable',
      mode: 'out-of-domain',
      note: 'Mastra provider-registry router strings hit external providers; Nimi routing is Runtime-owned (S-AIP-001), so a model instance is passed instead.',
    },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;
