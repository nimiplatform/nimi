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
    'runEvents.reasoning': { support: 'partial', mode: 'adapter-mapped', gaps: ['Permitted reasoning summaries are mapped; opaque continuity is metadata, and raw reasoning is not exposed.'] },
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
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'The current Nimi text contract does not admit this provider-owned behavior; requests and output fail explicitly.',
    },
    'tools.providerExecuted': {
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'The current Nimi text contract does not admit this provider-owned behavior; requests and output fail explicitly.',
    },
    'tools.providerToolResults': {
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'The current Nimi text contract does not admit this provider-owned behavior; requests and output fail explicitly.',
    },
    'tools.providerApproval': {
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'The current Nimi text contract does not admit this provider-owned behavior; requests and output fail explicitly.',
    },
    deferredResults: {
      support: 'partial', mode: 'framework-owned',
      gaps: ['Caller async-iterable tool results are framework-owned and supported; provider-deferred results are not admitted.'],
    },
    multiStep: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Vercel stopWhen/multi-step orchestration is usable through repeated adapter-backed model calls.',
    },
    approval: {
      support: 'partial', mode: 'framework-owned',
      gaps: ['Provider approval transcripts are rejected. Caller approval continuation is not yet verified through the Local App binding.'],
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
      support: 'unsupported', mode: 'out-of-domain',
      note: 'Use the purpose-specific Nimi media APIs; a text model step does not return media.',
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
      support: 'unsupported', mode: 'adapter-mapped',
      note: 'Configure generation through the admitted Nimi surface; arbitrary provider settings are not forwarded.',
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
