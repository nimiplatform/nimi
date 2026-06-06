import type { NimiCapabilityManifest } from '@nimiplatform/sdk/contracts';

export const NIMI_VERCEL_AI_ADAPTER_ID = 'vercel-ai' as const;

export const NIMI_VERCEL_AI_ADAPTER_MANIFEST = {
  adapterId: NIMI_VERCEL_AI_ADAPTER_ID,
  targetLibrary: 'Vercel AI SDK',
  targetVersionRange: 'ai@^6.0.0 || @ai-sdk/provider@^3.0.0',
  capabilityLevel: 'L2',
  capabilities: {
    'model.provider': 'supported',
    'text.generate': 'supported',
    'text.stream': 'supported',
    'runEvents.text': 'supported',
    'runEvents.finish': 'supported',
    'runEvents.error': 'supported',
    'runEvents.toolCallReturn': 'partial',
    'structured.output.requestMapping': 'partial',
    'tools.definitionMapping': 'partial',
    'tools.toolChoiceMapping': 'partial',
    'tools.execute': 'unsupported',
    multiStep: 'unsupported',
    approval: 'unsupported',
    externalExecution: 'unsupported',
    traces: 'unsupported',
    memoryContext: 'unsupported',
    knowledgeContext: 'unsupported',
    workflowCheckpoint: 'unsupported',
    migrationProof: 'unsupported',
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;
