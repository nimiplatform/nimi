import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { MessageList } from '@mastra/core/agent';
import { SemanticRecall } from '@mastra/core/processors';
import { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import {
  RoutePolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  type SubmitScenarioJobRequest,
} from '@nimiplatform/sdk/runtime/generated';

import {
  createNimiMastraEmbeddingModel,
  createNimiMastraModel,
  createNimiMastraVoice,
} from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

// Upstream Mastra runtime-surface compatibility. These tests are derived from
// @mastra/core@1.41.0 public behavior tests around activeTools, modelSettings,
// providerOptions, streaming tool loops, direct voice config, and SemanticRecall.
// They intentionally use the published @mastra/core public API with the Nimi
// adapter, not Mastra monorepo internals or Nimi-owned persistence shortcuts.

test('upstream: activeTools is enforced at execution time over a Nimi-backed Agent', async () => {
  const fixture = createNimiFixtureModel({
    results: [
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ id: 'hidden-call-1', name: 'hiddenTool', arguments: { value: 'blocked' } }],
      },
      { text: 'Done after rejection.', finishReason: 'stop' },
    ],
  });
  let allowedCalls = 0;
  let hiddenCalls = 0;
  const agent = createMastraTestAgent({
    name: 'upstream-active-tools',
    instructions: 'Only use active tools.',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: {
      allowedTool: createTool({
        id: 'allowedTool',
        description: 'Allowed tool',
        inputSchema: z.object({ value: z.string() }),
        execute: async () => {
          allowedCalls += 1;
          return { ok: true };
        },
      }),
      hiddenTool: createTool({
        id: 'hiddenTool',
        description: 'Hidden tool',
        inputSchema: z.object({ value: z.string() }),
        execute: async () => {
          hiddenCalls += 1;
          return { ok: true };
        },
      }),
    },
  });

  const result = await agent.generate('try the hidden tool', {
    maxSteps: 3,
    prepareStep: () => ({ activeTools: ['allowedTool'] }),
  });

  assert.equal(result.text, 'Done after rejection.');
  assert.equal(allowedCalls, 0);
  assert.equal(hiddenCalls, 0);
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.calls[0]?.tools?.map((tool) => tool.name), ['allowedTool']);
  assert.ok(
    fixture.calls[1]?.messages.some((message) => (message.toolResults?.length ?? 0) > 0),
    'expected Mastra to feed an execution-denied tool result back to the model',
  );
});

test('upstream: modelSettings and merged providerOptions reach Nimi request parameters', async () => {
  const direct = createNimiFixtureModel({ result: { text: 'ok', finishReason: 'stop' } });
  const directAgent = createMastraTestAgent({
    name: 'upstream-settings-direct',
    instructions: 'Forward model settings.',
    model: createNimiMastraModel({ model: direct.model }),
  });

  await directAgent.generate('default settings');
  assert.equal(direct.calls[0]?.parameters?.temperature, undefined);

  await directAgent.generate('explicit settings', {
    modelSettings: {
      temperature: 0,
      topP: 0.5,
      maxOutputTokens: 128,
      stopSequences: ['END'],
    },
  });
  assert.equal(direct.calls[1]?.parameters?.temperature, 0);
  assert.equal(direct.calls[1]?.parameters?.topP, 0.5);
  assert.equal(direct.calls[1]?.parameters?.maxTokens, 128);
  assert.deepEqual(direct.calls[1]?.parameters?.stop, ['END']);

  const fallback = createNimiFixtureModel({ result: { text: 'merged', finishReason: 'stop' } });
  const fallbackAgent = createMastraTestAgent({
    name: 'upstream-provider-options-fallback',
    instructions: 'Merge provider options.',
    model: [{
      model: createNimiMastraModel({ model: fallback.model }),
      maxRetries: 0,
      providerOptions: { openai: { reasoningEffort: 'high' } },
    }],
  });

  const streamed = await fallbackAgent.stream('merge provider options', {
    providerOptions: {
      openai: { user: 'abc' },
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
  });
  await streamed.text;

  const metadata = decodeMastraMetadata(fallback.calls[0]);
  assert.deepEqual(metadata?.providerOptions, {
    openai: { user: 'abc', reasoningEffort: 'high' },
    google: { thinkingConfig: { thinkingBudget: 0 } },
  });
});

test('upstream: streaming tool loop honors stopWhen after a Nimi stream tool step', async () => {
  const fixture = createNimiFixtureModel({
    streams: [
      [
        {
          type: 'tool-call',
          toolCall: { id: 'lookup-call-1', name: 'lookup', arguments: { q: 'nimi' } },
        },
        { type: 'done', finishReason: 'tool-calls', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } },
      ],
      [
        { type: 'text-delta', text: 'this second model call should be stopped' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 7, totalTokens: 8 } },
      ],
    ],
  });
  let toolExecutions = 0;
  const stopWhenStepCounts: number[] = [];
  const agent = createMastraTestAgent({
    name: 'upstream-stream-stopwhen',
    instructions: 'Use lookup once.',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'Lookup a term',
        inputSchema: z.object({ q: z.string() }),
        execute: async (input) => {
          toolExecutions += 1;
          return { found: (input as { q: string }).q };
        },
      }),
    },
  });

  const stream = await agent.stream('lookup nimi', {
    stopWhen: ({ steps }: { steps: unknown[] }) => {
      stopWhenStepCounts.push(steps.length);
      return true;
    },
  });
  const chunkTypes: string[] = [];
  for await (const chunk of stream.fullStream) {
    chunkTypes.push(chunk.type);
  }

  assert.equal(toolExecutions, 1);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(stopWhenStepCounts, [1]);
  assert.ok(chunkTypes.includes('tool-call'));
  assert.ok(chunkTypes.includes('tool-result'));
  assert.equal(chunkTypes.includes('text-delta'), false);
});

test('upstream: streaming maxSteps overrides stopWhen in the published Mastra wrapper', async () => {
  const fixture = createNimiFixtureModel({
    streams: [
      [
        {
          type: 'tool-call',
          toolCall: { id: 'lookup-call-1', name: 'lookup', arguments: { q: 'nimi' } },
        },
        { type: 'done', finishReason: 'tool-calls', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } },
      ],
      [
        { type: 'text-delta', text: 'continued because maxSteps replaced stopWhen' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 7, totalTokens: 8 } },
      ],
    ],
  });
  const stopWhenStepCounts: number[] = [];
  const agent = createMastraTestAgent({
    name: 'upstream-stream-maxsteps-stopwhen',
    instructions: 'Use lookup once.',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'Lookup a term',
        inputSchema: z.object({ q: z.string() }),
        execute: async (input) => ({ found: (input as { q: string }).q }),
      }),
    },
  });

  const stream = await agent.stream('lookup nimi', {
    maxSteps: 2,
    stopWhen: ({ steps }: { steps: unknown[] }) => {
      stopWhenStepCounts.push(steps.length);
      return true;
    },
  });
  const chunkTypes: string[] = [];
  for await (const chunk of stream.fullStream) {
    chunkTypes.push(chunk.type);
  }

  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(stopWhenStepCounts, []);
  assert.ok(chunkTypes.includes('tool-call'));
  assert.ok(chunkTypes.includes('tool-result'));
  assert.ok(chunkTypes.includes('text-delta'));
});

test('upstream: Nimi voice can be passed directly to Agent.voice', async () => {
  const submitRequests: SubmitScenarioJobRequest[] = [];
  const runtimeJobBase = {
    jobId: 'job-agent-voice-1',
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: 2,
    routeDecision: RoutePolicy.LOCAL,
    modelResolved: 'voice-model',
    status: ScenarioJobStatus.SUBMITTED,
    providerJobId: 'provider-agent-voice-1',
    reasonCode: 0,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-submit',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
  const ai = {
    async submitScenarioJob(request: SubmitScenarioJobRequest) {
      submitRequests.push(request);
      return { job: { ...runtimeJobBase, scenarioType: request.scenarioType } };
    },
    async getScenarioJob() {
      const request = submitRequests.at(-1);
      return {
        job: {
          ...runtimeJobBase,
          scenarioType: request?.scenarioType ?? ScenarioType.SPEECH_SYNTHESIZE,
          status: ScenarioJobStatus.COMPLETED,
        },
      };
    },
    async cancelScenarioJob() {
      return { job: { ...runtimeJobBase, status: ScenarioJobStatus.CANCELED } };
    },
    async *subscribeScenarioJobEvents() {
      const request = submitRequests.at(-1);
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-event',
        job: {
          ...runtimeJobBase,
          scenarioType: request?.scenarioType ?? ScenarioType.SPEECH_SYNTHESIZE,
          status: ScenarioJobStatus.COMPLETED,
        },
      };
    },
    async getScenarioArtifacts() {
      const request = submitRequests.at(-1);
      if (request?.scenarioType === ScenarioType.SPEECH_TRANSCRIBE) {
        return {
          jobId: 'job-agent-voice-1',
          traceId: 'trace-stt',
          artifacts: [],
          output: {
            output: {
              oneofKind: 'speechTranscribe' as const,
              speechTranscribe: { text: 'agent transcript', artifacts: [] },
            },
          },
        };
      }
      return {
        jobId: 'job-agent-voice-1',
        traceId: 'trace-tts',
        artifacts: [],
        output: {
          output: {
            oneofKind: 'speechSynthesize' as const,
            speechSynthesize: {
              artifacts: [{
                artifactId: 'audio-agent-voice-1',
                mimeType: 'audio/wav',
                bytes: Uint8Array.from([7, 7, 7]),
                uri: '',
                sha256: 'sha',
                sizeBytes: '3',
                durationMs: '100',
                fps: 0,
                width: 0,
                height: 0,
                sampleRateHz: 24000,
                channels: 1,
              }],
            },
          },
        },
      };
    },
    async listPresetVoices() {
      return {
        voices: [{
          voiceId: 'preset-agent-voice',
          name: 'Preset Agent Voice',
          lang: 'en',
          supportedLangs: ['en'],
          labels: {},
          category: 'preset',
          previewAudioUri: '',
        }],
        modelResolved: 'voice-model',
        traceId: 'trace-voices',
      };
    },
  };
  const voice = createNimiMastraVoice({
    runtime: ai,
    head: { appId: 'app-1', subjectUserId: 'user-1' },
    transcriptionMimeType: 'audio/wav',
    requestIdFactory: (operation) => `agent-voice-req-${operation}`,
    idempotencyKeyFactory: (operation) => `agent-voice-idem-${operation}`,
  });
  const agent = createMastraTestAgent({
    name: 'upstream-direct-voice',
    instructions: 'Voice agent.',
    model: createNimiMastraModel({ model: createNimiFixtureModel().model }),
    voice,
  });

  assert.deepEqual((await agent.voice.getSpeakers()).map((speaker) => speaker.voiceId), ['preset-agent-voice']);
  const audioStream = await agent.voice.speak('hello voice', { speaker: 'preset-agent-voice' });
  assert.ok(audioStream);
  assert.deepEqual([...(await readStreamBytes(audioStream))], [7, 7, 7]);
  assert.equal(
    await agent.voice.listen(Readable.from([Buffer.from([1, 2, 3])]), { mediaType: 'audio/wav' }),
    'agent transcript',
  );
});

test('upstream: SemanticRecall accepts the Nimi Runtime-backed embedder contract', async () => {
  const embedCalls: unknown[] = [];
  const createIndexCalls: unknown[] = [];
  const queryCalls: unknown[] = [];
  const storageCalls: unknown[] = [];
  const embedder = createNimiMastraEmbeddingModel({
    model: { modelId: 'text.embed' },
    embedding: {
      async embedText(request) {
        embedCalls.push(request);
        return {
          embeddings: [[0.1, 0.2, 0.3]],
          usage: { promptTokens: 6, completionTokens: 0, totalTokens: 6 },
          raw: {
            traceId: 'trace-semantic-embed',
            modelResolved: 'runtime-embed-semantic',
            routeDecision: 'local',
            ignoredExtensions: [],
          },
        };
      },
    },
  });
  const vector = {
    async createIndex(request: unknown) {
      createIndexCalls.push(request);
    },
    async query(request: unknown) {
      queryCalls.push(request);
      return [{
        id: 'vec-1',
        score: 0.94,
        metadata: { message_id: 'msg-remembered', thread_id: 'thread-1' },
      }];
    },
  };
  const remembered = {
    id: 'msg-remembered',
    role: 'assistant' as const,
    content: {
      format: 2,
      content: 'Use the Runtime-backed embedder.',
      parts: [{ type: 'text', text: 'Use the Runtime-backed embedder.' }],
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const storage = {
    async listMessages(request: unknown) {
      storageCalls.push(request);
      return {
        messages: [remembered],
        total: 1,
        page: 1,
        perPage: false,
        hasMore: false,
      };
    },
  };
  const processor = new SemanticRecall({
    storage: storage as never,
    vector: vector as never,
    embedder,
    indexName: 'nimi_runtime_embedder_test_index',
    topK: 1,
    embedderOptions: { providerOptions: { nimi: { purpose: 'semantic-recall' } } },
  });
  const inputMessage = {
    id: 'msg-new',
    role: 'user' as const,
    content: {
      format: 2,
      content: 'How do I use Nimi RAG?',
      parts: [{ type: 'text', text: 'How do I use Nimi RAG?' }],
    },
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
  };
  const messageList = new MessageList();
  messageList.add([inputMessage as never], 'input');
  const requestContext = new RequestContext();
  requestContext.set('MastraMemory', {
    thread: { id: 'thread-1', resourceId: 'resource-1' },
    resourceId: 'resource-1',
  });

  const result = await processor.processInput({
    messages: [inputMessage as never],
    messageList,
    abort: ((reason?: string) => {
      throw new Error(reason ?? 'abort');
    }) as never,
    requestContext,
  });

  const dbMessages = Array.isArray(result) ? result : result.get.all.db();
  assert.ok(dbMessages.some((message) => message.id === 'msg-remembered'));
  assert.deepEqual((embedCalls[0] as { values?: unknown }).values, ['How do I use Nimi RAG?']);
  assert.deepEqual(
    (embedCalls[0] as { metadata?: { providerOptions?: unknown } }).metadata?.providerOptions,
    { nimi: { purpose: 'semantic-recall' } },
  );
  assert.deepEqual(createIndexCalls[0], {
    indexName: 'nimi_runtime_embedder_test_index',
    dimension: 3,
    metric: 'cosine',
  });
  assert.deepEqual(queryCalls[0], {
    indexName: 'nimi_runtime_embedder_test_index',
    queryVector: [0.1, 0.2, 0.3],
    topK: 1,
    filter: { resource_id: 'resource-1' },
  });
  assert.deepEqual(storageCalls[0], {
    threadId: 'thread-1',
    resourceId: 'resource-1',
    include: [{
      id: 'msg-remembered',
      threadId: 'thread-1',
      withNextMessages: 1,
      withPreviousMessages: 1,
    }],
    perPage: 0,
  });
});

function decodeMastraMetadata(call: NimiGenerateTextRequest | undefined): Record<string, unknown> | undefined {
  const value = call?.parameters?.metadata?.['x-nimi-mastra-metadata'];
  if (typeof value !== 'string') {
    return undefined;
  }
  return JSON.parse(value) as Record<string, unknown>;
}

async function readStreamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}
