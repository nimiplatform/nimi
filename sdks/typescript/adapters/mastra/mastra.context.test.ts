import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeKnowledgeAgentContextProvider,
  type NimiRuntimeKnowledgeContextClient,
} from '@nimiplatform/sdk/features/knowledge-context';
import {
  createNimiRuntimeMemoryAgentContextProvider,
  type NimiRuntimeMemoryContextClient,
} from '@nimiplatform/sdk/features/memory-context';

import {
  createNimiMastraContextBridge,
  createNimiMastraModel,
  generateWithNimiMastraContext,
  streamWithNimiMastraContext,
} from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

test('Nimi Runtime memory and knowledge context feed a Mastra Agent without Mastra Memory', async () => {
  // Behavior: Mastra stays an orchestration/helper layer while Nimi Runtime-owned
  // memory and knowledge providers supply per-turn context through Mastra's public
  // context option. No Mastra Memory store is configured for this agent.
  const memoryQueries: string[] = [];
  const knowledgeQueries: string[] = [];
  const fixture = createNimiFixtureModel({ result: { text: 'context-applied', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'runtime-context-bridge',
    instructions: 'answer using supplied runtime context',
    model: createNimiMastraModel({ model: fixture.model }),
  });
  const memoryClient = {
    async recall(options) {
      memoryQueries.push(options.query);
      assert.equal(options.limit, 1);
      return {
        snippets: [{
          id: 'mem-1',
          text: 'Mira prefers green tea.',
          importance: 0.91,
        }],
        summaries: [],
      };
    },
    async history() {
      return unexpectedCall('memory.history');
    },
    async getEmbeddingRuntimeProjection() {
      return unexpectedCall('memory.getEmbeddingRuntimeProjection');
    },
    async setEmbeddingRuntimeIntent() {
      return unexpectedCall('memory.setEmbeddingRuntimeIntent');
    },
    async requestEmbeddingRuntimeBind() {
      return unexpectedCall('memory.requestEmbeddingRuntimeBind');
    },
    async requestEmbeddingRuntimeCutover() {
      return unexpectedCall('memory.requestEmbeddingRuntimeCutover');
    },
  } satisfies NimiRuntimeMemoryContextClient;
  const knowledgeClient = {
    async listBanks() {
      return unexpectedCall('knowledge.listBanks');
    },
    async search(options) {
      knowledgeQueries.push(options.query);
      assert.deepEqual(options.bankIds, ['nimi-sdk']);
      return {
        references: [{
          id: 'kb-1',
          source: 'nimi-sdk',
          text: 'S-AIP-007 requires adapter conformance not to persist framework state.',
          score: 0.84,
        }],
        citations: [{ referenceId: 'kb-1', label: 'S-AIP-007' }],
        nextPageToken: '',
        rawHits: [],
      };
    },
  } satisfies NimiRuntimeKnowledgeContextClient;
  const bridge = createNimiMastraContextBridge({
    agent: { id: 'nimi-runtime-owner', name: 'Nimi Runtime Owner' },
    model: fixture.model,
    contextProviders: [
      createNimiRuntimeMemoryAgentContextProvider({ client: memoryClient, recall: { limit: 1 } }),
      createNimiRuntimeKnowledgeAgentContextProvider({
        client: knowledgeClient,
        search: { bankIds: ['nimi-sdk'], mode: 'keyword', limit: 1 },
      }),
    ],
  });

  const result = await generateWithNimiMastraContext(agent, 'What should I remember about Mira?', { contextBridge: bridge });

  assert.equal(result.text, 'context-applied');
  assert.deepEqual(memoryQueries, ['What should I remember about Mira?']);
  assert.deepEqual(knowledgeQueries, ['What should I remember about Mira?']);
  const promptText = fixture.calls[0]?.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');

  assert.match(promptText ?? '', /Nimi Runtime Context/);
  assert.match(promptText ?? '', /Mira prefers green tea/);
  assert.match(promptText ?? '', /S-AIP-007 requires adapter conformance/);
});

test('Nimi Mastra context bridge also applies to Agent.stream', async () => {
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'streamed' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'runtime-context-stream',
    instructions: 'stream with runtime context',
    model: createNimiMastraModel({ model: fixture.model }),
  });
  const bridge = createNimiMastraContextBridge({
    agent: { id: 'nimi-runtime-stream-owner', name: 'Nimi Runtime Stream Owner' },
    model: fixture.model,
    contextProviders: [{
      id: 'runtime-context-provider',
      load: () => [{ type: 'text', text: 'Runtime context is available for streams.' }],
    }],
  });

  const streamed = await streamWithNimiMastraContext(agent, 'Stream with context.', { contextBridge: bridge });
  let text = '';
  for await (const delta of streamed.textStream) {
    text += delta;
  }

  assert.equal(text, 'streamed');
  const promptText = fixture.calls[0]?.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
  assert.match(promptText ?? '', /Runtime context is available for streams/);
});

function unexpectedCall(method: string): never {
  throw new Error(`unexpected ${method} call`);
}
