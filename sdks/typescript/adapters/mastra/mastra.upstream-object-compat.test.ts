import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { createNimiMastraModel } from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

// Upstream structured-output compatibility: mirrors Mastra's observable
// structuredOutput contract through the public API. Mastra forwards a json-schema
// response format (adapter-mapped) and produces the validated .object itself.

test('object: a nested object schema yields a typed .object', async () => {
  // Upstream: structuredOutput with a nested schema produces the nested object.
  const value = { user: { name: 'Ada', roles: ['admin', 'dev'] }, active: true };
  const fixture = createNimiFixtureModel({ result: { text: JSON.stringify(value), finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'upstream-object-nested',
    instructions: 'emit nested json',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('describe', {
    structuredOutput: {
      schema: z.object({
        user: z.object({ name: z.string(), roles: z.array(z.string()) }),
        active: z.boolean(),
      }),
    },
  });

  assert.equal(fixture.calls[0]?.responseFormat?.type, 'json-schema');
  assert.deepEqual(result.object, value);
});

test('object: an array-valued field round-trips through structured output', async () => {
  // Upstream: array fields in the schema are preserved.
  const value = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const fixture = createNimiFixtureModel({ result: { text: JSON.stringify(value), finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'upstream-object-array',
    instructions: 'emit a list',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('list', {
    structuredOutput: { schema: z.object({ items: z.array(z.object({ id: z.number() })) }) },
  });

  assert.deepEqual(result.object, value);
});

test('object: an enum field is validated by Mastra', async () => {
  // Upstream: enum/union schema fields are honored.
  const value = { status: 'active', count: 2 };
  const fixture = createNimiFixtureModel({ result: { text: JSON.stringify(value), finishReason: 'stop' } });
  const agent = createMastraTestAgent({
    name: 'upstream-object-enum',
    instructions: 'emit a status',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const result = await agent.generate('status', {
    structuredOutput: { schema: z.object({ status: z.enum(['active', 'inactive']), count: z.number() }) },
  });

  assert.deepEqual(result.object, value);
});

test('object: structured output resolves through Agent.stream().object', async () => {
  // Upstream: streaming structured output exposes the validated object via .object.
  const value = { title: 'Nimi', score: 9 };
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: JSON.stringify(value) },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'upstream-object-stream',
    instructions: 'stream json',
    model: createNimiMastraModel({ model: fixture.model }),
  });

  const streamed = await agent.stream('emit', {
    structuredOutput: { schema: z.object({ title: z.string(), score: z.number() }) },
  });
  const object = await streamed.object;

  assert.deepEqual(object, value);
});
