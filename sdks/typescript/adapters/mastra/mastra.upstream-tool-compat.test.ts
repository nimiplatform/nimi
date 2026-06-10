import assert from 'node:assert/strict';
import test from 'node:test';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createNimiMastraModel } from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

// Upstream tool compatibility: mirrors Mastra's observable createTool + agent
// tool-loop contract through the public API. Mastra owns tool execution and the
// multi-step loop; the adapter maps the model tool-call/tool-result interface.

test('tools: multiple tools are forwarded and only the called tool executes', async () => {
  // Upstream: an agent with several tools runs just the one the model calls.
  const fixture = createNimiFixtureModel({
    results: [
      { text: '', finishReason: 'tool-calls', toolCalls: [{ id: 'c1', name: 'getTime', arguments: { tz: 'UTC' } }] },
      { text: 'It is noon UTC.', finishReason: 'stop' },
    ],
  });
  const executed: string[] = [];
  const getTime = createTool({
    id: 'getTime',
    description: 'Get the current time',
    inputSchema: z.object({ tz: z.string() }),
    execute: async () => {
      executed.push('getTime');
      return { time: 'noon' };
    },
  });
  const getWeather = createTool({
    id: 'getWeather',
    description: 'Get the weather',
    inputSchema: z.object({ city: z.string() }),
    execute: async () => {
      executed.push('getWeather');
      return { forecast: 'sunny' };
    },
  });
  const agent = createMastraTestAgent({
    name: 'upstream-tools-multi',
    instructions: 'use the right tool',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { getTime, getWeather },
  });

  const result = await agent.generate('what time is it in UTC?');

  const forwardedToolNames = (fixture.calls[0]?.tools ?? []).map((tool) => tool.name).sort();
  assert.deepEqual(forwardedToolNames, ['getTime', 'getWeather']);
  assert.deepEqual(executed, ['getTime']);
  assert.equal(result.text, 'It is noon UTC.');
});

test('tools: a tool result is propagated back into the next model call', async () => {
  // Upstream: the tool output is added to the prompt before the model's final turn.
  const fixture = createNimiFixtureModel({
    results: [
      { text: '', finishReason: 'tool-calls', toolCalls: [{ id: 'c1', name: 'add', arguments: { a: 2, b: 3 } }] },
      { text: 'The sum is 5.', finishReason: 'stop' },
    ],
  });
  const add = createTool({
    id: 'add',
    description: 'Add two numbers',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    outputSchema: z.object({ sum: z.number() }),
    execute: async (input) => ({ sum: (input as { a: number; b: number }).a + (input as { a: number; b: number }).b }),
  });
  const agent = createMastraTestAgent({
    name: 'upstream-tools-propagate',
    instructions: 'add numbers',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { add },
  });

  const result = await agent.generate('add 2 and 3');

  // Second model call carries a tool result message produced by Mastra.
  const secondCallMessages = fixture.calls[1]?.messages ?? [];
  const hasToolResult = secondCallMessages.some((message) => (message.toolResults?.length ?? 0) > 0
    || message.role === 'tool');
  assert.ok(hasToolResult, 'expected the tool result to be threaded into the second model call');
  assert.equal(result.text, 'The sum is 5.');
});

test('tools: a specific toolChoice maps to a Nimi tool selection', async () => {
  // Upstream: toolChoice: { type: 'tool', toolName } pins the tool on the model call.
  const fixture = createNimiFixtureModel({
    results: [
      { text: '', finishReason: 'tool-calls', toolCalls: [{ id: 'c1', name: 'search', arguments: { q: 'nimi' } }] },
      { text: 'found it', finishReason: 'stop' },
    ],
  });
  const search = createTool({
    id: 'search',
    description: 'Search',
    inputSchema: z.object({ q: z.string() }),
    execute: async () => ({ hits: 1 }),
  });
  const agent = createMastraTestAgent({
    name: 'upstream-tools-choice',
    instructions: 'always search',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { search },
  });

  await agent.generate('look it up', { toolChoice: { type: 'tool', toolName: 'search' } });

  const toolChoice = fixture.calls[0]?.toolChoice;
  assert.ok(toolChoice && typeof toolChoice === 'object' && toolChoice.type === 'tool');
  assert.equal(toolChoice.type === 'tool' ? toolChoice.name : '', 'search');
});

test('tools: two sequential tool calls drive a three-step agent loop', async () => {
  // Upstream: chained tool use re-enters the model for each tool turn plus the final answer.
  const fixture = createNimiFixtureModel({
    results: [
      { text: '', finishReason: 'tool-calls', toolCalls: [{ id: 'c1', name: 'step', arguments: { n: 1 } }] },
      { text: '', finishReason: 'tool-calls', toolCalls: [{ id: 'c2', name: 'step', arguments: { n: 2 } }] },
      { text: 'done in two steps', finishReason: 'stop' },
    ],
  });
  let invocations = 0;
  const step = createTool({
    id: 'step',
    description: 'Run a step',
    inputSchema: z.object({ n: z.number() }),
    execute: async () => {
      invocations += 1;
      return { ok: true };
    },
  });
  const agent = createMastraTestAgent({
    name: 'upstream-tools-sequential',
    instructions: 'run two steps',
    model: createNimiMastraModel({ model: fixture.model }),
    tools: { step },
  });

  const result = await agent.generate('run the steps');

  assert.equal(invocations, 2);
  assert.equal(fixture.calls.length, 3);
  assert.equal(result.text, 'done in two steps');
});
