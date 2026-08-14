import type { NimiCapabilityManifest } from '@nimiplatform/sdk/contracts';

export const NIMI_VERCEL_AI_ADAPTER_ID = 'vercel-ai' as const;

// @nimi-authority: rule.nimi.sdks.feature-clients.r006
export const NIMI_VERCEL_AI_ADAPTER_MANIFEST = {
  adapterId: NIMI_VERCEL_AI_ADAPTER_ID,
  targetLibrary: 'Vercel AI SDK',
  targetVersionRange: 'ai@^6.0.0 || @ai-sdk/provider@^3.0.0',
  capabilityLevel: 'L3',
  capabilities: {
    'model.provider': { support: 'supported', mode: 'adapter-mapped' },
    'text.generate': { support: 'supported', mode: 'adapter-mapped' },
    'text.stream': { support: 'supported', mode: 'adapter-mapped' },
    'runEvents.text': { support: 'supported', mode: 'adapter-mapped' },
    'runEvents.reasoning': { support: 'supported', mode: 'adapter-mapped' },
    'runEvents.finish': { support: 'supported', mode: 'adapter-mapped' },
    'runEvents.error': { support: 'supported', mode: 'adapter-mapped' },
    'runEvents.toolCallReturn': { support: 'supported', mode: 'adapter-mapped' },
    'structured.output.requestMapping': { support: 'supported', mode: 'adapter-mapped' },
    'tools.definitionMapping': { support: 'supported', mode: 'adapter-mapped' },
    'tools.toolChoiceMapping': { support: 'supported', mode: 'adapter-mapped' },
    'tools.callerOwnedLoop': {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Vercel owns the loop and the adapter preserves Nimi tool-call/tool-result round trips.',
    },
    'tools.execute': {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Vercel tool execute callbacks run in the caller/framework; Nimi supplies compatible model calls.',
    },
    'tools.adapterExecute': {
      support: 'not-applicable',
      mode: 'framework-owned',
      note: 'LanguageModelV3 providers do not execute caller tool callbacks; Vercel owns tool({ execute }) orchestration above the model adapter.',
    },
    'tools.providerDefined': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'LanguageModelV3 provider tools are projected onto Nimi provider tools with id/name/args preserved.',
    },
    'tools.providerExecuted': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Provider-executed tool-call flags and dynamic/provider metadata are preserved in generate content and stream parts.',
    },
    'tools.providerToolResults': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Provider-executed tool-result content, preliminary/error/dynamic flags, and provider metadata are mapped both directions.',
    },
    'tools.providerApproval': {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Provider approval requests and prompt approval responses are preserved through formal Nimi contracts.',
    },
    deferredResults: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Deferred/preliminary provider tool results are preserved via the Vercel preliminary flag.',
    },
    multiStep: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Vercel stopWhen/multi-step orchestration is usable through repeated adapter-backed model calls.',
    },
    approval: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Caller-owned Vercel approvals remain framework-owned; provider approval request/response parts are adapter-mapped.',
    },
    externalExecution: {
      support: 'not-applicable',
      mode: 'framework-owned',
      note: 'External caller execution is a Vercel framework/tool-loop concern, not a LanguageModelV3 provider interface.',
    },
    traces: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: ['Nimi trace run-events are not mapped into Vercel stream parts.'],
    },
    multimodalInput: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Provider acceptance remains route-dependent.'],
    },
    multimodalOutput: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Artifact-like output is mapped only for supported Nimi run-event shapes.'],
    },
    sources: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'Vercel URL and document source content/stream parts map to Nimi source events and generate content.',
    },
    rawChunks: {
      support: 'supported',
      mode: 'adapter-mapped',
      note: 'includeRawChunks is forwarded; raw stream parts are emitted only from Nimi raw events carrying provider raw chunks.',
    },
    providerOptions: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Options are projected into request metadata; provider-side honoring is route-owned.'],
    },
    usageTokenDetails: {
      support: 'partial',
      mode: 'adapter-mapped',
      gaps: ['Cache read and reasoning output tokens map; cache write tokens are not available from Nimi usage.'],
    },
    memoryContext: { support: 'not-applicable', mode: 'out-of-domain' },
    knowledgeContext: { support: 'not-applicable', mode: 'out-of-domain' },
    workflowCheckpoint: { support: 'not-applicable', mode: 'out-of-domain' },
    migrationProof: { support: 'not-applicable', mode: 'governance-only' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;
