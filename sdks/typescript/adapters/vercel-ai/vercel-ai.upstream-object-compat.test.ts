import assert from 'node:assert/strict';
import test from 'node:test';

import { generateObject, generateText, jsonSchema, NoObjectGeneratedError, Output, streamObject } from 'ai';

import { createNimiVercelLanguageModel } from './index';
import { createUpstreamCompatModel } from './vercel-ai.upstream-compat.fixture';

test('upstream-compat/generateObject: repairs invalid JSON through Vercel repairText', async () => {
  const { model, calls } = createUpstreamCompatModel({ text: '{ "city": "Paris"' });
  const repairs: string[] = [];

  const result = await generateObject({
    model: createNimiVercelLanguageModel({ model }),
    schema: jsonSchema({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    }),
    prompt: 'city',
    experimental_repairText: async ({ text, error }) => {
      repairs.push(`${error.constructor.name}:${text}`);
      return '{ "city": "Paris" }';
    },
  });

  assert.deepEqual(result.object, { city: 'Paris' });
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
  assert.equal(repairs.length, 1);
});

test('upstream-compat/generateObject: throws NoObjectGeneratedError when text is absent', async () => {
  const { model } = createUpstreamCompatModel({ text: '' });

  await assert.rejects(
    async () => await generateObject({
      model: createNimiVercelLanguageModel({ model }),
      schema: jsonSchema({
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      }),
      prompt: 'no object',
    }),
    (error) => NoObjectGeneratedError.isInstance(error),
  );
});

test('upstream-compat/generateText: Output object/array/choice projections use adapter responseFormat', async () => {
  const citySchema = jsonSchema({
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  });
  const { model, calls } = createUpstreamCompatModel([
    { text: '{ "city": "Paris" }' },
    { text: '{ "elements": [{ "city": "Paris" }, { "city": "Berlin" }] }' },
    { text: '{ "result": "sunny" }' },
  ]);

  const objectResult = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'object',
    output: Output.object({ schema: citySchema }),
  });
  const arrayResult = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'array',
    output: Output.array({ element: citySchema }),
  });
  const choiceResult = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'choice',
    output: Output.choice({ options: ['sunny', 'rainy'] }),
  });

  assert.deepEqual(objectResult.output, { city: 'Paris' });
  assert.deepEqual(arrayResult.output, [{ city: 'Paris' }, { city: 'Berlin' }]);
  assert.equal(choiceResult.output, 'sunny');
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
  assert.equal(calls[1]?.responseFormat?.type, 'json-schema');
  assert.equal(calls[2]?.responseFormat?.type, 'json-schema');
});

test('upstream-compat/streamObject: streams arrays, enum, and no-schema JSON through adapter text chunks', async () => {
  const citySchema = jsonSchema({
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  });
  const { model: arrayModel } = createUpstreamCompatModel({ text: '{"elements":[{"city":"Paris"},{"city":"Berlin"}]}' });
  const { model: enumModel } = createUpstreamCompatModel({ text: '{ "result": "sunny" }' });
  const { model: noSchemaModel } = createUpstreamCompatModel({ text: '{ "untyped": true }' });

  const arrayResult = streamObject({
    model: createNimiVercelLanguageModel({ model: arrayModel }),
    output: 'array',
    schema: citySchema,
    prompt: 'array',
  });
  const partialArrays = [];
  for await (const partial of arrayResult.partialObjectStream) {
    partialArrays.push(partial);
  }

  const enumResult = streamObject({
    model: createNimiVercelLanguageModel({ model: enumModel }),
    output: 'enum',
    enum: ['sunny', 'rainy'],
    prompt: 'enum',
  });
  const enumPartials = [];
  for await (const partial of enumResult.partialObjectStream) {
    enumPartials.push(partial);
  }

  const noSchemaResult = streamObject({
    model: createNimiVercelLanguageModel({ model: noSchemaModel }),
    output: 'no-schema',
    prompt: 'no schema',
  });
  const noSchemaPartials = [];
  for await (const partial of noSchemaResult.partialObjectStream) {
    noSchemaPartials.push(partial);
  }

  assert.deepEqual(partialArrays.at(-1), [{ city: 'Paris' }, { city: 'Berlin' }]);
  assert.deepEqual(await arrayResult.object, [{ city: 'Paris' }, { city: 'Berlin' }]);
  assert.equal(enumPartials.at(-1), 'sunny');
  assert.equal(await enumResult.object, 'sunny');
  assert.deepEqual(noSchemaPartials.at(-1), { untyped: true });
  assert.deepEqual(await noSchemaResult.object, { untyped: true });
});
