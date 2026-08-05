import assert from 'node:assert/strict';
import test from 'node:test';

import { generateText, streamText } from 'ai';
import { convertReadableStreamToArray } from 'ai/test';

import { createNimiVercelLanguageModel } from './index';
import { createUpstreamCompatModel, DEFAULT_USAGE } from './vercel-ai.upstream-compat.fixture';

test('upstream-compat/generateText: exposes provider metadata and response metadata from Nimi raw', async () => {
  const { model } = createUpstreamCompatModel({
    text: 'metadata ok',
    raw: {
      providerMetadata: { nimi: { cache: 'hit' } },
      requestBody: { promptHash: 'abc123' },
      responseId: 'resp-1',
      responseModelId: 'resolved-model',
      responseHeaders: { 'x-provider-trace': 'trace-1', ignored: 42 },
      responseBody: { id: 'raw-body' },
    },
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'metadata',
  });

  assert.equal(result.text, 'metadata ok');
  assert.deepEqual(result.providerMetadata, { nimi: { cache: 'hit' } });
  assert.deepEqual(result.request.body, { promptHash: 'abc123' });
  assert.equal(result.response.id, 'resp-1');
  assert.equal(result.response.modelId, 'resolved-model');
  assert.deepEqual(result.response.headers, { 'x-provider-trace': 'trace-1' });
  assert.deepEqual(result.response.body, { id: 'raw-body' });
});

test('upstream-compat/generateText: surfaces sources through content, steps, and result.sources', async () => {
  const { model } = createUpstreamCompatModel({
    content: [
      { type: 'text', text: 'source ok' },
      {
        type: 'source',
        sourceType: 'url',
        id: 'source-url-1',
        url: 'https://example.com/nimi',
        title: 'Nimi source',
        providerMetadata: { provider: { custom: 'source-metadata' } },
      },
      {
        type: 'source',
        sourceType: 'document',
        id: 'source-doc-1',
        mediaType: 'application/pdf',
        title: 'Spec document',
        filename: 'spec.pdf',
      },
    ],
  });

  const result = await generateText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'sources',
  });

  assert.equal(result.text, 'source ok');
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0]?.sourceType, 'url');
  assert.deepEqual(result.sources[0]?.providerMetadata, { provider: { custom: 'source-metadata' } });
  assert.equal(result.sources[1]?.sourceType, 'document');
  assert.equal(result.content.filter((part) => part.type === 'source').length, 2);
  assert.equal(result.steps[0]?.sources.length, 2);
});

test('upstream-compat/streamText: forwards includeRawChunks and surfaces raw chunks in fullStream', async () => {
  const { model, calls } = createUpstreamCompatModel({
    text: 'raw ok',
    rawChunks: [{ type: 'raw', value: { provider: 'raw', index: 1 } }],
  });

  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'stream raw',
    includeRawChunks: true,
  });
  const parts = [];
  for await (const part of result.fullStream) {
    parts.push(part);
  }

  assert.equal(calls[0]?.parameters?.includeRawChunks, true);
  assert.ok(parts.some((part) => part.type === 'raw' && part.rawValue && typeof part.rawValue === 'object'));
  assert.equal((await result.response).id, 'stream-response-id');
});

test('upstream-compat/streamText: surfaces url and document sources in result and UI streams', async () => {
  const { model } = createUpstreamCompatModel({
    events: [
      {
        type: 'source',
        sourceType: 'url',
        id: 'source-url-stream',
        url: 'https://example.com/stream',
        title: 'Stream source',
      },
      {
        type: 'source',
        sourceType: 'document',
        id: 'source-doc-stream',
        mediaType: 'text/plain',
        title: 'Stream document',
        filename: 'source.txt',
      },
      { type: 'text-delta', text: 'sources streamed' },
      { type: 'done', finishReason: 'stop', usage: DEFAULT_USAGE },
    ],
  });

  const result = streamText({
    model: createNimiVercelLanguageModel({ model }),
    prompt: 'stream sources',
  });

  const uiChunks = await convertReadableStreamToArray(result.toUIMessageStream({ sendSources: true }));
  const sources = await result.sources;

  assert.equal((await result.text), 'sources streamed');
  assert.equal(sources.length, 2);
  assert.ok(uiChunks.some((chunk) => chunk.type === 'source-url' && chunk.url === 'https://example.com/stream'));
  assert.ok(uiChunks.some((chunk) => chunk.type === 'source-document' && chunk.mediaType === 'text/plain'));
});
