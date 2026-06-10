import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiMastraModel } from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

// Upstream text-generation compatibility: mirrors Mastra's observable
// Agent.generate()/stream() text contract through the public API, not copies of
// Mastra's internal unit tests. Each test names the upstream behavior it tracks.

test('text: a multi-turn message history is forwarded to the Nimi model', async () => {
  // Upstream: Agent.generate(messages[]) threads prior turns into the model prompt.
  const fixture = createNimiFixtureModel({ result: { text: 'continued', finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'upstream-text-history',
    instructions: 'hold a conversation',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  await agent.generate([
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
  ]);

  const userTexts = (fixture.calls[0]?.messages ?? [])
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''));
  assert.ok(userTexts.some((text) => text.includes('first question')));
  assert.ok(userTexts.some((text) => text.includes('second question')));
});

test('text: Agent.generate surfaces model usage', async () => {
  // Upstream: result.usage reports model token usage.
  const fixture = createNimiFixtureModel({
    result: { text: 'measured', finishReason: 'stop', usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 } },
  });
  const agent = createMastraTestAgent({
    name: 'upstream-text-usage',
    instructions: 'report usage',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('measure');

  assert.equal(result.usage?.totalTokens, 18);
  assert.equal(result.totalUsage?.totalTokens, 18);
});

test('text: Agent.stream .text promise equals the accumulated textStream', async () => {
  // Upstream: the streamed text and the resolved .text agree.
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'a' },
      { type: 'text-delta', text: 'b' },
      { type: 'text-delta', text: 'c' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'upstream-text-stream',
    instructions: 'stream text',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const streamed = await agent.stream('stream');
  let accumulated = '';
  for await (const delta of streamed.textStream) {
    accumulated += delta;
  }

  assert.equal(accumulated, 'abc');
  assert.equal(await streamed.text, 'abc');
});

test('text: a thrown Nimi model error fails closed through Mastra', async () => {
  // Upstream: model failures reject rather than returning a fabricated success.
  const failing = {
    model: { providerId: 'nimi-test', modelId: 'boom' },
    async generateText(): Promise<never> {
      throw new Error('nimi route unavailable');
    },
  };
  const agent = createMastraTestAgent({
    name: 'upstream-text-error',
    instructions: 'will fail',
    model: createNimiMastraModel({ model: failing }),
  });

  await assert.rejects(async () => {
    await agent.generate('break');
  });
});
