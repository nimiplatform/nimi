import type { NimiCapabilityManifest } from '@nimiplatform/sdk/contracts';

export const NIMI_VERCEL_AI_ADAPTER_ID = 'vercel-ai' as const;

export const NIMI_VERCEL_AI_ADAPTER_MANIFEST = {
  adapterId: NIMI_VERCEL_AI_ADAPTER_ID,
  targetLibrary: 'Vercel AI SDK',
  targetVersionRange: 'ai@^6.0.0 || @ai-sdk/provider@^3.0.0',
  capabilityLevel: 'L2',
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
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'The Vercel adapter does not execute NimiTool.execute callbacks by itself.',
    },
    'tools.providerDefined': {
      support: 'unsupported',
      mode: 'runtime-owned',
      note: 'Provider-defined tools are fail-closed until Runtime/provider tool ownership is admitted.',
    },
    multiStep: {
      support: 'supported',
      mode: 'framework-owned',
      note: 'Vercel stopWhen/multi-step orchestration is usable through repeated adapter-backed model calls.',
    },
    approval: {
      support: 'partial',
      mode: 'framework-owned',
      gaps: ['Runtime-owned delegated approval and provider-executed approval are not mapped by this adapter.'],
    },
    externalExecution: {
      support: 'unsupported',
      mode: 'runtime-owned',
      note: 'External/provider execution requires Runtime-owned semantics and is fail-closed here.',
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
      support: 'unsupported',
      mode: 'runtime-owned',
      note: 'Nimi does not currently expose source run-events for this adapter to map.',
    },
    rawChunks: {
      support: 'unsupported',
      mode: 'adapter-mapped',
      note: 'Vercel includeRawChunks is explicitly rejected because raw provider chunks are not exposed.',
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
