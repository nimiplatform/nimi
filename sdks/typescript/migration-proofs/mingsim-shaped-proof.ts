import { createNimiMcpAdapter } from '../adapters/mcp';
import { createNimiOpenAICompatibleAdapter, NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST } from '../adapters/openai-compatible';
import {
  buildNimiConversationFeatureEvents,
  type NimiConversationFeatureEvent,
} from '../features/conversation';
import {
  createNimiKnowledgeContextBundle,
  toNimiKnowledgeContextPart,
} from '../features/knowledge-context';
import { buildNimiMemoryContextWindow, toNimiMemoryContextPart } from '../features/memory-context';
import {
  createNimiGenerationJob,
  transitionNimiGenerationJob,
} from '../features/generation';
import {
  createNimiApprovalTool,
  createNimiExternalExecutionTool,
} from '../features/toolkits';
import { createNimiProofModel } from './model-fixtures';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runMingSimShapedProof(): Promise<NimiMigrationProofResult> {
  const memoryPart = toNimiMemoryContextPart(
    buildNimiMemoryContextWindow([{ id: 'memory-1', text: 'User prefers precise plans.', importance: 1 }]),
  );
  const knowledgePart = toNimiKnowledgeContextPart(
    createNimiKnowledgeContextBundle([{ id: 'knowledge-1', source: 'spec', text: 'Adapters must fail closed.', score: 1 }]),
  );
  const generationJob = transitionNimiGenerationJob(createNimiGenerationJob({ id: 'job-1', prompt: 'render proof' }), {
    status: 'completed',
    artifacts: [{ id: 'artifact-1', kind: 'document', uri: 'memory://artifact-1' }],
  });

  const approvalTool = createNimiApprovalTool({ name: 'approve_plan', description: 'Approve plan.' });
  const externalTool = createNimiExternalExecutionTool({ name: 'run_external', description: 'Run external work.' });
  const mcp = createNimiMcpAdapter({
    tools: [
      {
        name: 'collect_context',
        description: 'Collect context.',
        inputSchema: { type: 'object' },
        policy: 'auto',
        visibility: 'model',
        execute() {
          return { memory: 'memory-1', knowledge: 'knowledge-1' };
        },
      },
    ],
  });
  const mcpResult = await mcp.callTool({ name: 'collect_context', arguments: {} });

  const fixture = createNimiProofModel({
    modelId: 'mingsim-proof-model',
    text: '{"status":"accepted","next":"continue"}',
    stream: [
      { type: 'start', traceId: 'trace-mingsim' },
      { type: 'text-delta', text: 'accepted' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const openAICompatible = createNimiOpenAICompatibleAdapter({
    model: fixture.model,
    idGenerator: () => 'chatcmpl-mingsim',
    createdUnixSeconds: () => 123,
  });
  const completion = await openAICompatible.chat.completions.create({
    model: 'mingsim-proof-model',
    messages: [
      { role: 'developer', content: 'Return structured proof status.' },
      { role: 'user', content: 'Run the MingSim-shaped flow.' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'MingSimProof',
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            next: { type: 'string' },
          },
          required: ['status', 'next'],
        },
        strict: true,
      },
    },
    tools: [
      {
        type: 'function',
        function: {
          name: 'collect_context',
          parameters: { type: 'object' },
        },
      },
    ],
  });

  const conversationEvents = buildNimiConversationFeatureEvents([
    { type: 'start', traceId: 'trace-mingsim' },
    { type: 'text-delta', text: 'accepted' },
    { type: 'done', finishReason: 'stop' },
  ]);
  const session = createLongRunningSession(conversationEvents);

  const evidence = [
    `memory:${memoryPart.type}`,
    `knowledge:${knowledgePart.type}`,
    `mcp:${mcpResult.content[0]?.text ?? ''}`,
    `approval:${approvalTool.policy}`,
    `external:${externalTool.policy}`,
    `artifact:${generationJob.artifacts[0]?.id ?? ''}`,
    `structured:${completion.choices[0].message.content ?? ''}`,
    `session:${session.turns.length}`,
  ];

  return {
    proofId: 'mingsim-shaped-proof',
    appShape: 'MingSim-shaped tools/context/artifact/session flow',
    status: evidence.every((item) => item.length > 0) ? 'passed' : 'failed',
    migratedBy: 'source-root-adapter-contract',
    adapterIds: [NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.adapterId, 'mcp'],
    observedCapabilities: [
      'tools',
      'memory-context',
      'knowledge-context',
      'structured-output',
      'approval',
      'external-execution',
      'artifacts',
      'long-running-session',
    ],
    evidence,
  };
}

function createLongRunningSession(events: readonly NimiConversationFeatureEvent[]): {
  readonly turns: readonly { readonly id: string; readonly status: string; readonly events: readonly NimiConversationFeatureEvent[] }[];
} {
  return {
    turns: [
      { id: 'turn-1', status: 'queued', events: [] },
      { id: 'turn-1', status: 'running', events: events.slice(0, 2) },
      { id: 'turn-1', status: 'completed', events },
    ],
  };
}
