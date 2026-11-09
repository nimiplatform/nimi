import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNimiLocalAppTextAnnotationResult } from './local-app-text-annotation.js';
import { createNimiLocalAppAIConsumptionRuntimeClient } from './local-app-runtime-platform-ai.js';
import { CoreClient } from '../../core-client/index.js';
import { RuntimeTypedClient } from '../../core-generated/runtime-typed-client.js';
import { GetLocalAppScenarioJobResponse, ScenarioJobStatus, ScenarioType } from '../../core-generated/runtime-protobuf/runtime/v1/ai.js';

function result() {
  return { documents: [{ text: ' 😀 hi ', language: 'en', tokens: [
    { text: '😀', start: 1, end: 2, headIndex: 1, partOfSpeech: 'INTJ', dependency: 'intj', isPunctuation: false },
    { text: 'hi', start: 3, end: 5, headIndex: 1, partOfSpeech: 'INTJ', dependency: 'ROOT', isPunctuation: false },
  ], sentences: [{ startToken: 0, endToken: 2 }] }, { text: '', language: 'en', tokens: [], sentences: [] }] };
}

test('annotation job lookup projects a real protobuf-decoded result through the public App client', async () => {
  const bytes = GetLocalAppScenarioJobResponse.toBinary(GetLocalAppScenarioJobResponse.create({ job: {
    jobId: 'annotation-job', scenarioType: ScenarioType.TEXT_ANNOTATE, status: ScenarioJobStatus.COMPLETED,
    textAnnotation: result(), traceId: 'annotation-trace', createdAt: { seconds: '1', nanos: 0 }, updatedAt: { seconds: '2', nanos: 0 },
  } }));
  const client = createNimiLocalAppAIConsumptionRuntimeClient(new RuntimeTypedClient(new CoreClient({ transport: {
    async unary<Response>(request: { methodId: string; body?: unknown }): Promise<Response> {
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob');
      assert.deepEqual(request.body, { jobId: '', clientSubmissionId: 'saved-submission' });
      return GetLocalAppScenarioJobResponse.fromBinary(bytes) as Response;
    },
    async *serverStream<Response>(): AsyncIterable<Response> { throw new Error('Lookup must not submit or stream another job.'); },
  } })));
  const actual = await client.scenarioJobs.lookupSubmission('saved-submission');
  assert.equal(actual.job.status, 'completed');
  assert.deepEqual(actual.job.textAnnotation, result());
});

test('annotation preserves Unicode scalar offsets and empty documents', () => {
  const input = result();
  assert.deepEqual(validateNimiLocalAppTextAnnotationResult(input), input);
  assert.ok(Object.isFrozen(validateNimiLocalAppTextAnnotationResult(input).documents[0]?.tokens));
});

test('annotation rejects wrong offsets, heads, sentence coverage, and authority fields', () => {
  const wrongOffset = result();
  wrongOffset.documents[0]!.tokens[0]!.end = 3;
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(wrongOffset));
  const wrongHead = result();
  wrongHead.documents[0]!.tokens[0]!.headIndex = 2;
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(wrongHead));
  const noSentence = result();
  noSentence.documents[0]!.sentences = [];
  assert.throws(() => validateNimiLocalAppTextAnnotationResult(noSentence));
  assert.throws(() => validateNimiLocalAppTextAnnotationResult({ ...result(), modelId: 'private' }));
});

test('annotation accepts a complete document beyond the former byte and token limits', () => {
  const tokens = Array.from({ length: 9000 }, (_, i) => ({
    text: 'annotation', start: i * 11, end: i * 11 + 10, headIndex: 0,
    partOfSpeech: 'NOUN', dependency: 'dep', isPunctuation: false,
  }));
  const value = { documents: [{ text: tokens.map(t => t.text).join(' '), language: 'en', tokens,
    sentences: [{ startToken: 0, endToken: tokens.length }] }] };
  assert.equal(validateNimiLocalAppTextAnnotationResult(value).documents[0]?.tokens.length, 9000);
});
