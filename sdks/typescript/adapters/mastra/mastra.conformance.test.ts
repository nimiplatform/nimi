import assert from 'node:assert/strict';
import test from 'node:test';

import { MockMemory } from '@mastra/core/memory';
import { createTool } from '@mastra/core/tools';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import type { NimiSource } from '@nimiplatform/sdk/contracts';
import { createNimiMastraModel, createNimiMastraProvider } from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

// Conformance suite: every test drives the real Mastra public API (Agent,
// createTool, structuredOutput, streaming) over a NimiAiModel wrapped by
// createNimiMastraModel, validating one Mastra target-library behavior the
// manifest claims.

test('Mastra Agent.generate maps text, usage, and finishReason through the Nimi model', async () => {
  // Behavior: Agent.generate() text/usage/finishReason (model.config, agent.generate, usage, finishReason).
  const fixture = createNimiFixtureModel({
    result: { text: 'hello from nimi', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 } },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-generate',
    instructions: 'be a deterministic probe',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('say hi');

  assert.equal(result.text, 'hello from nimi');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage?.totalTokens, 8);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0]?.messages.at(-1)?.role, 'user');
});

test('Mastra Agent.generate threads system instructions into the Nimi prompt', async () => {
  // Behavior: Agent instructions become a system message on the model call.
  const fixture = createNimiFixtureModel({ result: { text: 'ok', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'conformance-system',
    instructions: 'You are Nimi, answer tersely.',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  await agent.generate('question');

  const roles = fixture.calls[0]?.messages.map((message) => message.role) ?? [];
  assert.ok(roles.includes('system'), `expected a system message, saw ${JSON.stringify(roles)}`);
});

test('Mastra Agent.stream streams text deltas and resolves finishReason', async () => {
  // Behavior: Agent.stream() textStream + finishReason (agent.stream).
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'str' },
      { type: 'text-delta', text: 'eam' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'conformance-stream',
    instructions: 'stream a probe',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const streamed = await agent.stream('go');
  let text = '';
  for await (const delta of streamed.textStream) {
    text += delta;
  }

  assert.equal(text, 'stream');
  assert.equal(await streamed.finishReason, 'stop');
});

test('Mastra Agent.stream exposes a full stream of typed chunks', async () => {
  // Behavior: Agent.stream() fullStream chunk protocol (agent.stream).
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'chunked' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'conformance-fullstream',
    instructions: 'stream chunks',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const streamed = await agent.stream('go');
  const types: string[] = [];
  for await (const chunk of streamed.fullStream) {
    types.push(chunk.type);
  }

  assert.ok(types.includes('text-delta'), `expected a text-delta chunk, saw ${JSON.stringify(types)}`);
  assert.ok(types.includes('finish'), `expected a finish chunk, saw ${JSON.stringify(types)}`);
});

test('Mastra createTool definitions, execution, result propagation, and multi-step run through the Nimi model', async () => {
  // Behavior: tool definition mapping + Mastra-owned execution + result propagation + multi-step loop.
  const fixture = createNimiFixtureModel({
    results: [
      {
        text: '',
        finishReason: 'tool-calls',
        usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
        toolCalls: [{ id: 'call-weather-1', name: 'weather', arguments: { city: 'Paris' } }],
      },
      {
        text: 'It is sunny in Paris.',
        finishReason: 'stop',
        usage: { promptTokens: 8, completionTokens: 5, totalTokens: 13 },
      },
    ],
  });

  let executedInput: unknown = null;
  const weather = createTool({
    id: 'weather',
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ forecast: z.string() }),
    execute: async (input) => {
      executedInput = input;
      return { forecast: `sunny:${(input as { city: string }).city}` };
    },
  });

  const agent = createMastraTestAgent({
    name: 'conformance-tools',
    instructions: 'use the weather tool',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { weather },
  });

  const result = await agent.generate('weather in Paris?');

  // Tool definition forwarded to the model.
  assert.equal(fixture.calls[0]?.tools?.[0]?.name, 'weather');
  // Mastra executed the tool with the parsed input (framework-owned execution).
  assert.deepEqual(executedInput, { city: 'Paris' });
  // The agent loop re-entered the model after the tool result (multi-step + result propagation).
  assert.equal(fixture.calls.length, 2);
  assert.equal(result.text, 'It is sunny in Paris.');
});

test('Mastra requireToolApproval suspends and fails closed without snapshot storage', async () => {
  // Behavior: Mastra-owned requireToolApproval loop over a Nimi-backed model
  // (toolApproval, partial). The adapter maps the model tool call; Mastra owns
  // the pause/approval registry and requires snapshot storage to resume.
  const fixture = createNimiFixtureModel({
    results: [
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ id: 'call-delete-1', name: 'deleteUser', arguments: { userId: 'u-1' } }],
      },
      {
        text: 'deleted u-1',
        finishReason: 'stop',
      },
    ],
  });
  let executedInput: unknown = null;
  const deleteUser = createTool({
    id: 'deleteUser',
    description: 'Delete a user',
    inputSchema: z.object({ userId: z.string() }),
    outputSchema: z.object({ deleted: z.boolean(), userId: z.string() }),
    execute: async (input) => {
      executedInput = input;
      return { deleted: true, userId: (input as { userId: string }).userId };
    },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-tool-approval',
    instructions: 'delete users only after approval',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { deleteUser },
  });

  const pending = await agent.generate('delete user u-1', { requireToolApproval: true, maxSteps: 3 });

  assert.equal(pending.finishReason, 'suspended');
  assert.equal(executedInput, null);
  assert.equal(pending.suspendPayload?.toolCallId, 'call-delete-1');

  await assert.rejects(
    async () => await agent.approveToolCallGenerate({
      runId: requireText(pending.runId, 'approval runId'),
      toolCallId: pending.suspendPayload?.toolCallId,
      maxSteps: 3,
    }),
    (error: unknown) => {
      assert.equal((error as { readonly id?: unknown }).id, 'AGENT_RESUME_NO_SNAPSHOT_FOUND');
      return true;
    },
  );
  assert.equal(executedInput, null);
  assert.equal(fixture.calls.length, 1);
});

test('Mastra forwards toolChoice to the Nimi model call', async () => {
  // Behavior: toolChoice mapping (tools.toolChoice).
  const fixture = createNimiFixtureModel({ result: { text: 'done', finishReason: 'stop' } });
  const lookup = createTool({
    id: 'lookup',
    description: 'Look something up',
    inputSchema: z.object({ q: z.string() }),
    execute: async () => ({ ok: true }),
  });
  const agent = createMastraTestAgent({
    name: 'conformance-toolchoice',
    instructions: 'choose a tool',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { lookup },
  });

  await agent.generate('do it', { toolChoice: 'required' });

  assert.equal(fixture.calls[0]?.toolChoice, 'required');
});

test('Mastra structuredOutput forwards a json-schema response format and yields a typed object', async () => {
  // Behavior: structured output request mapping + .object (structuredOutput).
  const person = { name: 'Ada', age: 36 };
  const fixture = createNimiFixtureModel({
    result: { text: JSON.stringify(person), finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 9, totalTokens: 13 } },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-structured',
    instructions: 'emit json',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('describe a person', {
    structuredOutput: { schema: z.object({ name: z.string(), age: z.number() }) },
  });

  assert.equal(fixture.calls[0]?.responseFormat?.type, 'json-schema');
  assert.deepEqual(result.object, person);
});

test('Mastra surfaces Nimi sources from a generate result', async () => {
  // Behavior: source mapping (sources).
  const source: NimiSource = {
    type: 'source',
    sourceType: 'url',
    id: 'source-1',
    url: 'https://example.com/nimi',
    title: 'Nimi',
  };
  const fixture = createNimiFixtureModel({
    result: { text: 'see the source', finishReason: 'stop', sources: [source] },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-sources',
    instructions: 'cite sources',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('with sources');

  // Mastra surfaces sources as { type, runId, from, payload } chunks; the URL the
  // adapter mapped from the Nimi source is preserved in payload.url.
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.payload?.url, 'https://example.com/nimi');
});

test('Mastra surfaces Nimi reasoning from a generate result', async () => {
  // Behavior: reasoning mapping (reasoning, partial).
  const fixture = createNimiFixtureModel({
    result: {
      text: 'answer',
      finishReason: 'stop',
      content: [
        { type: 'reasoning', text: 'thinking about it' },
        { type: 'text', text: 'answer' },
      ],
    },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-reasoning',
    instructions: 'reason then answer',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('reason');

  assert.equal(result.text, 'answer');
  assert.equal(result.reasoningText, 'thinking about it');
});

test('createNimiMastraProvider resolves Runtime-routed models a Mastra Agent accepts', async () => {
  // Behavior: client/runtime-driven model construction returns a Mastra-usable model.
  const fixture = createNimiFixtureModel({ modelId: 'gemini/default', result: { text: 'routed', finishReason: 'stop' } });
  const createdModelIds: string[] = [];
  const provider = createNimiMastraProvider({
    client: {
      ai: {
        createRuntimeModel(options: { model: { modelId: string } }) {
          createdModelIds.push(options.model.modelId);
          return fixture.model;
        },
      },
    } as never,
    routePolicy: 'cloud',
  });

  const agent = createMastraTestAgent({
    name: 'conformance-provider',
    instructions: 'routed model',
    model: provider.languageModel('gemini/default'),
  });
  const result = await agent.generate('route me');

  assert.deepEqual(createdModelIds, ['gemini/default']);
  assert.equal(result.text, 'routed');
});

test('Mastra abort signal is forwarded onto the Nimi request', async () => {
  // Behavior: abort mapping (abort). Driven at the model interface Mastra calls.
  const fixture = createNimiFixtureModel({ result: { text: 'ok', finishReason: 'stop' } });
  const model = createNimiMastraModel({ model: fixture.model });
  const controller = new AbortController();

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    abortSignal: controller.signal,
  });

  assert.equal(fixture.calls[0]?.signal, controller.signal);
});

test('Mastra onFinish and onStepFinish callbacks fire with adapter output', async () => {
  // Behavior: agent callbacks (agentCallbacks).
  const fixture = createNimiFixtureModel({
    result: { text: 'callback-text', finishReason: 'stop', usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } },
  });
  const agent = createMastraTestAgent({
    name: 'conformance-callbacks',
    instructions: 'fire callbacks',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  let finishText: string | undefined;
  let steps = 0;
  await agent.generate('go', {
    onFinish: (result) => { finishText = (result as { text?: string }).text; },
    onStepFinish: () => { steps += 1; },
  });

  assert.equal(finishText, 'callback-text');
  assert.ok(steps >= 1, `expected at least one step, saw ${steps}`);
});

test('Mastra fails closed when structured output cannot be parsed', async () => {
  // Behavior: structured-output no-object failure (structuredOutputFailure).
  // The model returns unparseable text; Mastra must reject, not fabricate an object.
  const fixture = createNimiFixtureModel({ result: { text: 'definitely not json', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'conformance-nobject',
    instructions: 'emit json',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  await assert.rejects(async () => {
    await agent.generate('describe', { structuredOutput: { schema: z.object({ value: z.number() }) } });
  });
});

test('Mastra accepts the adapter model as a dynamically resolved model', async () => {
  // Behavior: dynamic model/instructions resolution (dynamicResolution).
  const fixture = createNimiFixtureModel({ result: { text: 'dynamic', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'conformance-dynamic',
    instructions: () => 'dynamically resolved instructions',
    model: () => createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('go');

  assert.equal(result.text, 'dynamic');
});

test('Mastra stream forwards includeRawChunks and surfaces raw stream parts', async () => {
  // Behavior: raw chunks (rawChunks).
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'raw', value: { provider: 'raw-chunk' } },
      { type: 'text-delta', text: 'hi' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const model = createNimiMastraModel({ model: fixture.model });

  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    includeRawChunks: true,
  });
  const types: string[] = [];
  let rawValue: unknown;
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    types.push(next.value.type);
    if (next.value.type === 'raw') {
      rawValue = next.value.rawValue;
    }
  }

  assert.equal(fixture.calls[0]?.parameters?.includeRawChunks, true);
  assert.ok(types.includes('raw'), `expected a raw part, saw ${JSON.stringify(types)}`);
  assert.deepEqual(rawValue, { provider: 'raw-chunk' });
});

test('Mastra file input parts map onto Nimi file parts', async () => {
  // Behavior: multimodal file input (multimodalInput, partial). Binary payloads are
  // base64-encoded so the Runtime owns decode (S-AIP-001).
  const fixture = createNimiFixtureModel({ result: { text: 'saw file', finishReason: 'stop' } });
  const model = createNimiMastraModel({ model: fixture.model });

  await model.doGenerate({
    prompt: [{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/png', filename: 'pic.png' },
      ],
    }],
  });

  const content = fixture.calls[0]?.messages[0]?.content ?? [];
  assert.equal(content.length, 2);
  assert.equal(content[1]?.type, 'file');
  assert.equal(content[1]?.type === 'file' ? content[1].mediaType : '', 'image/png');
});

test('Mastra provider options are projected into Nimi request metadata', async () => {
  // Behavior: provider options projection (providerOptions, partial).
  const fixture = createNimiFixtureModel({ result: { text: 'ok', finishReason: 'stop' } });
  const model = createNimiMastraModel({ model: fixture.model });

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    providerOptions: { nimi: { trace: 'abc' } },
  });

  const metadata = fixture.calls[0]?.parameters?.metadata;
  assert.ok(metadata && typeof metadata === 'object');
  assert.ok(JSON.stringify(metadata).includes('providerOptions'));
});

test('Mastra Memory compatibility threads prior-turn context into the Nimi model across turns', async () => {
  // Behavior: a Mastra-Memory-enabled agent can call a Nimi model (memory, partial).
  // Mastra owns the store (MockMemory / InMemoryStore); the adapter carries the
  // memory-augmented prompt to the model. Nimi-owned durable state requires
  // Runtime/Cognition owner surfaces, not this text-model adapter.
  const fixture = createNimiFixtureModel({ result: { text: 'noted', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'conformance-memory',
    instructions: 'remember the conversation',
    model: createNimiMastraModel({ model: fixture.model }),
    memory: new MockMemory(),
  });
  const conversation = { thread: 'thread-1', resource: 'resource-1' };

  await agent.generate('My name is Ada.', { memory: conversation });
  await agent.generate('What is my name?', { memory: conversation });

  const lastCallTexts = (fixture.calls.at(-1)?.messages ?? [])
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''));
  assert.ok(
    lastCallTexts.some((text) => text.includes('Ada')),
    'expected the second turn to recall the first turn through Mastra memory',
  );
});

test('Mastra Workflow compatibility runs a Nimi-backed model step to success', async () => {
  // Behavior: a Nimi-backed text model can run inside a Mastra workflow step
  // (workflows, partial). Mastra owns workflow lifecycle/checkpoint state here.
  const fixture = createNimiFixtureModel({ result: { text: 'workflow-answer', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'conformance-workflow-agent',
    instructions: 'answer the question',
    model: createNimiMastraModel({ model: fixture.model }),
  });
  const ask = createStep({
    id: 'ask',
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ inputData }) => {
      const result = await agent.generate(inputData.question);
      return { answer: result.text };
    },
  });
  const workflow = createWorkflow({
    id: 'ask-workflow',
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
  }).then(ask).commit();

  const run = await workflow.createRun();
  const result = await run.start({ inputData: { question: 'hello' } });

  assert.equal(result.status, 'success');
  assert.equal(result.status === 'success' ? result.result.answer : '', 'workflow-answer');
  assert.equal(fixture.calls.length, 1);
});

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} must be a string`);
  }
  if (!value) {
    assert.fail(`${label} must not be empty`);
  }
  return value;
}
