import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

// Lab-only capability tests: handlers and Session controllers run against a
// fake formal Local App client. They prove Lab-side behavior only; real
// Runtime execution is covered by Desktop-supervised Lab acceptance.
const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

function buildModules() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'capability-tests-'));
  buildWithTsc([
    '--outDir', buildDir,
    '--rootDir', 'src',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--skipLibCheck', 'true',
    '--jsx', 'react-jsx',
    '--strict', 'true',
    '--types', 'node',
    '--noEmit', 'false',
    'src/lab/lab-runtime.ts',
    'src/ai-studio-core/history.ts',
    'src/ai-studio-core/text-annotation-document.ts',
    'src/lab/lab-only/video-face-swap-session.ts',
    'src/lab/lab-only/ai-realtime-session.ts',
  ], { cwd: root, stdio: 'pipe' });
  return buildDir;
}

const load = (relativePath) => import(pathToFileURL(path.join(buildModules(), relativePath)).href);

test.after(() => {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function job(jobId, status, overrides = {}) {
  return {
    jobId, scenarioType: 'text-annotate', status, progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
    reasonCode: '', reasonDetail: '', artifacts: [], traceId: `trace-${jobId}`, createdAt: null, updatedAt: null,
    transcriptionText: '', ...overrides,
  };
}

function subscription(events) {
  return {
    async *[Symbol.asyncIterator]() { for (const event of events) yield event; },
    async cancel() {},
  };
}

// Only the operations a test configures exist; anything else fails loudly.
function fakeClient(overrides = {}) {
  const missing = (name) => async () => { throw Object.assign(new Error(`${name} was not configured`), { reasonCode: 'TEST_METHOD_UNAVAILABLE' }); };
  const assets = new Map();
  const calls = { submit: [], upload: [], adopt: [], write: [], remove: [], cancel: [], execute: [], executeOptions: [] };
  const client = {
    ai: {
      text: { generateCandidate: missing('generateCandidate'), streamTurn: missing('streamTurn') },
      scenario: { execute: overrides.execute ? async (spec, options) => { calls.execute.push(structuredClone(spec)); calls.executeOptions.push(options); return overrides.execute(spec, calls.execute.length, options); } : missing('execute') },
      scenarioJobs: {
        submit: overrides.submit ? async (spec, options) => { calls.submit.push({ spec, options }); return overrides.submit(spec); } : missing('submit'),
        get: overrides.get ?? missing('get'),
        subscribe: overrides.subscribe ?? missing('subscribe'),
        cancel: async (jobId, reason) => { calls.cancel.push({ jobId, reason }); return overrides.cancel ? overrides.cancel(jobId) : { job: job(jobId, 'canceled') }; },
      },
      artifacts: {
        read: missing('artifacts.read'),
        upload: async (input) => { calls.upload.push(input); return { artifactId: `upload-${calls.upload.length}`, sizeBytes: input.bytes.byteLength, mimeType: input.mimeType }; },
      },
      voiceAssets: { list: missing('voiceAssets.list') },
    },
    storage: {
      assets: {
        async write(input) {
          calls.write.push(input);
          if (overrides.writeFails) throw new Error('disk full');
          const bytes = input.body;
          const record = { relativePath: input.relativePath, mediaType: input.mediaType, sizeBytes: bytes.byteLength, sha256: sha256(bytes), createdAt: 'now', updatedAt: 'now' };
          assets.set(input.relativePath, { record, bytes });
          return record;
        },
        async remove(relativePath) { calls.remove.push(relativePath); return { removed: assets.delete(relativePath) }; },
        async adoptArtifact(input) {
          calls.adopt.push(input);
          const mediaType = overrides.adoptedMediaType ?? 'image/png';
          return { relativePath: input.relativePath.replace(/\.asset$/u, mediaType === 'video/mp4' ? '.mp4' : '.png'), mediaType, sizeBytes: 1234, sha256: `sha256:${'f'.repeat(64)}`, createdAt: 'now', updatedAt: 'now' };
        },
        async read({ relativePath }) {
          const stored = assets.get(relativePath);
          if (!stored) throw Object.assign(new Error('not found'), { reasonCode: 'NOT_FOUND' });
          return {
            asset: stored.record,
            range: { offset: 0, length: stored.bytes.byteLength, totalSize: stored.bytes.byteLength },
            body: (async function* () { yield stored.bytes.slice(0, 7); yield stored.bytes.slice(7); })(),
          };
        },
      },
    },
  };
  return { client, calls, assets };
}

const ready = (client) => ({
  async getRuntimeProjection() { return { status: 'ready', mode: 'local-app' }; },
  getLocalAppClient() { return client; },
});

// "The café sells 🍰 cake." counted in Unicode scalars: 🍰 is one scalar but
// two UTF-16 code units, so "cake" starts at 17, not 18.
const SAMPLE = 'The café sells 🍰 cake.';
function sampleAnnotation(text = SAMPLE) {
  const scalars = Array.from(text);
  const word = (value, start) => ({ text: value, start, end: start + Array.from(value).length, headIndex: 2, partOfSpeech: 'NOUN', dependency: 'dep', isPunctuation: false });
  assert.equal(scalars.slice(17, 21).join(''), 'cake');
  return {
    documents: [{
      text, language: 'en',
      tokens: [
        word('The', 0), word('café', 4), { ...word('sells', 9), headIndex: 2, dependency: 'ROOT', partOfSpeech: 'VERB' },
        word('🍰', 15), word('cake', 17), { text: '.', start: 21, end: 22, headIndex: 2, partOfSpeech: 'PUNCT', dependency: 'punct', isPunctuation: true },
      ],
      sentences: [{ startToken: 0, endToken: 6 }],
    }],
  };
}

test('text.annotate submits the exact documents, observes the known Job and saves the complete result as an App document', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { readStudioTextAnnotationDocument } = await load('ai-studio-core/text-annotation-document.js');
  const annotation = sampleAnnotation();
  const fake = fakeClient({
    submit: () => ({ job: job('job-annotate', 'queued') }),
    get: async () => ({ job: job('job-annotate', 'running'), asset: null, voiceReference: null }),
    subscribe: async () => subscription([{ eventType: 'completed', sequence: '2', traceId: 't', timestamp: null, job: job('job-annotate', 'completed', { textAnnotation: annotation }) }]),
  });
  const result = await runLabCapability({ capabilityId: 'text.annotate', prompt: SAMPLE, parameters: { language: 'en' } }, ready(fake.client));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fake.calls.submit[0].spec, { type: 'text-annotate', language: 'en', texts: [SAMPLE] });
  assert.equal(result.output.kind, 'text-annotation');
  assert.equal(result.output.jobId, 'job-annotate');
  assert.equal(result.output.tokenCount, 6);
  assert.equal(result.output.document.mediaType, 'application/json');
  const written = fake.calls.write[0];
  assert.equal(written.overwrite, false);
  assert.equal(result.output.document.sha256, sha256(written.body));
  assert.deepEqual(JSON.parse(Buffer.from(written.body).toString('utf8')), annotation);
  // Reopening reads the document back, checks size and digest, and validates it.
  const reopened = await readStudioTextAnnotationDocument(fake.client.storage.assets, result.output.document);
  assert.equal(reopened.documents[0].tokens[4].start, 17);
  assert.equal(Array.from(reopened.documents[0].text).slice(17, 21).join(''), 'cake');
});

test('text.annotate refuses a result whose documents differ from the submitted text and keeps the Job ID', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const fake = fakeClient({
    submit: () => ({ job: job('job-mismatch', 'queued') }),
    get: async () => ({ job: job('job-mismatch', 'completed', { textAnnotation: { documents: [{ text: 'Other', language: 'en', tokens: [{ text: 'Other', start: 0, end: 5, headIndex: 0, partOfSpeech: 'X', dependency: 'ROOT', isPunctuation: false }], sentences: [{ startToken: 0, endToken: 1 }] }] } }), asset: null, voiceReference: null }),
  });
  const result = await runLabCapability({ capabilityId: 'text.annotate', prompt: SAMPLE, parameters: { language: 'en' } }, ready(fake.client));
  assert.equal(result.ok, false);
  assert.equal(result.jobId, 'job-mismatch');
  assert.deepEqual(fake.calls.write, [], 'nothing is saved for a mismatched result');
});

test('known Job IDs and owner reasons survive failure, cancellation and timeout; an unknown Submit is not retried', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  for (const [status, reason] of [['failed', 'runtime-call-failed'], ['canceled', 'runtime-canceled'], ['timeout', 'runtime-timeout']]) {
    const fake = fakeClient({
      submit: () => ({ job: job(`job-${status}`, 'queued') }),
      get: async () => ({ job: job(`job-${status}`, status, { reasonCode: 'AI_LOCAL_EXECUTION_INFERENCE_FAILED', reasonDetail: `ended ${status}` }), asset: null, voiceReference: null }),
    });
    const result = await runLabCapability({ capabilityId: 'text.annotate', prompt: SAMPLE, parameters: { language: 'en' } }, ready(fake.client));
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.jobId, `job-${status}`);
    assert.equal(result.diagnostics.reasonCode, 'AI_LOCAL_EXECUTION_INFERENCE_FAILED');
  }
  let submits = 0;
  const lost = fakeClient({ submit: () => { submits += 1; throw Object.assign(new Error('transport lost'), { reasonCode: 'UNAVAILABLE' }); } });
  const unknown = await runLabCapability({ capabilityId: 'text.annotate', prompt: SAMPLE, parameters: { language: 'en' } }, ready(lost.client));
  assert.equal(unknown.ok, false);
  assert.equal(submits, 1);
  assert.equal(unknown.jobId, undefined, 'no Job ID is invented for an unknown Submit response');
});

test('canceling a running annotation requests Runtime cancellation for the known Job', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const controller = new AbortController();
  const fake = fakeClient({
    submit: () => ({ job: job('job-cancel', 'queued') }),
    get: async () => ({ job: job('job-cancel', 'running'), asset: null, voiceReference: null }),
    subscribe: async () => ({
      async *[Symbol.asyncIterator]() {
        controller.abort('lab-user-canceled');
        yield { eventType: 'canceled', sequence: '3', traceId: 't', timestamp: null, job: job('job-cancel', 'canceled', { reasonCode: 'ACTION_EXECUTED' }) };
      },
      async cancel() {},
    }),
  });
  const result = await runLabCapability({ capabilityId: 'text.annotate', prompt: SAMPLE, parameters: { language: 'en' }, signal: controller.signal }, ready(fake.client));
  assert.equal(result.reason, 'runtime-canceled');
  assert.equal(result.jobId, 'job-cancel');
  assert.deepEqual(fake.calls.cancel.map((call) => call.jobId), ['job-cancel']);
});

const png = { name: 'ref.png', mimeType: 'image/png', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
const jpeg = { name: 'target.jpg', mimeType: 'image/jpeg', sizeBytes: 3, bytes: new Uint8Array([5, 6, 7]) };
const mp4 = { name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 5, bytes: new Uint8Array([8, 9, 10, 11, 12]) };

test('image.face_swap uploads both roles, adopts the single PNG and records per-role input facts', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const fake = fakeClient({
    submit: () => ({ job: job('job-face', 'queued', { scenarioType: 'image-face-swap' }) }),
    get: async () => ({ job: job('job-face', 'completed', { scenarioType: 'image-face-swap', artifacts: [{ artifactId: 'out-1', mimeType: 'image/png', bytes: [], sizeBytes: 1234, sha256: 'x', durationMs: 0, width: 1, height: 1, sampleRateHz: 0, channels: 0 }] }), asset: null, voiceReference: null }),
  });
  const result = await runLabCapability({ capabilityId: 'image.face_swap', prompt: '', parameters: { reference: png, target: jpeg } }, ready(fake.client));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fake.calls.upload.map((call) => call.mimeType), ['image/png', 'image/jpeg']);
  assert.deepEqual(fake.calls.submit[0].spec, { type: 'image-face-swap', referenceImageArtifactId: 'upload-1', targetImageArtifactId: 'upload-2' });
  assert.equal(fake.calls.adopt[0].artifactId, 'out-1');
  assert.equal(result.output.artifacts[0].mediaType, 'image/png');
  assert.deepEqual(result.output.faceSwap.inputs, [
    { role: 'reference-image', name: 'ref.png', mediaType: 'image/png', sizeBytes: 4, sha256: sha256(png.bytes) },
    { role: 'target-image', name: 'target.jpg', mediaType: 'image/jpeg', sizeBytes: 3, sha256: sha256(jpeg.bytes) },
  ]);
  assert.equal(result.output.faceSwap.noFacePolicy, undefined);
});

test('image.face_swap keeps the owner face-selection reason and Job ID and publishes no media', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const fake = fakeClient({
    submit: () => ({ job: job('job-noface', 'queued') }),
    get: async () => ({ job: job('job-noface', 'failed', { reasonCode: 'AI_FACE_TARGET_MISSING' }), asset: null, voiceReference: null }),
  });
  const result = await runLabCapability({ capabilityId: 'image.face_swap', prompt: '', parameters: { reference: png, target: jpeg } }, ready(fake.client));
  assert.equal(result.ok, false);
  assert.equal(result.jobId, 'job-noface');
  assert.equal(result.diagnostics.reasonCode, 'AI_FACE_TARGET_MISSING');
  assert.deepEqual(fake.calls.adopt, []);
  const invalid = await runLabCapability({ capabilityId: 'image.face_swap', prompt: '', parameters: { reference: png, target: { ...jpeg, mimeType: 'image/webp' } } }, ready(fakeClient().client));
  assert.equal(invalid.reason, 'input-invalid');
});

test('video.face_swap requires an explicit no-face policy and keeps the typed frame summary with the adopted MP4', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const noPolicy = await runLabCapability({ capabilityId: 'video.face_swap', prompt: '', parameters: { reference: png, target: mp4 } }, ready(fakeClient().client));
  assert.equal(noPolicy.reason, 'input-invalid');
  const summary = { totalFrames: 90, transformedFrames: 84, preservedFrames: 6, durationUs: 3_000_000, frameRate: 30, audioPreserved: true };
  const fake = fakeClient({
    adoptedMediaType: 'video/mp4',
    submit: () => ({ job: job('job-video', 'queued', { scenarioType: 'video-face-swap' }) }),
    get: async () => ({ job: job('job-video', 'completed', { scenarioType: 'video-face-swap', videoFaceSwapSummary: summary, artifacts: [{ artifactId: 'out-video', mimeType: 'video/mp4', bytes: [], sizeBytes: 1234, sha256: 'x', durationMs: 3000, width: 1280, height: 720, sampleRateHz: 48000, channels: 2 }] }), asset: null, voiceReference: null }),
  });
  const result = await runLabCapability({ capabilityId: 'video.face_swap', prompt: '', parameters: { reference: png, target: mp4, noFacePolicy: 'preserve-frame' } }, ready(fake.client));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(fake.calls.submit[0].spec, { type: 'video-face-swap', referenceImageArtifactId: 'upload-1', targetVideoArtifactId: 'upload-2', noFacePolicy: 'preserve-frame' });
  assert.deepEqual(fake.calls.upload.map((call) => call.mimeType), ['image/png', 'video/mp4']);
  assert.deepEqual(result.output.faceSwap.video, summary);
  assert.equal(result.output.faceSwap.noFacePolicy, 'preserve-frame');
  assert.equal(result.output.faceSwap.inputs[1].role, 'target-video');

  const inconsistent = fakeClient({
    adoptedMediaType: 'video/mp4',
    submit: () => ({ job: job('job-video-bad', 'queued') }),
    get: async () => ({ job: job('job-video-bad', 'completed', { videoFaceSwapSummary: { ...summary, preservedFrames: 5 }, artifacts: [{ artifactId: 'out', mimeType: 'video/mp4', bytes: [], sizeBytes: 1, sha256: 'x', durationMs: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0 }] }), asset: null, voiceReference: null }),
  });
  const rejected = await runLabCapability({ capabilityId: 'video.face_swap', prompt: '', parameters: { reference: png, target: mp4, noFacePolicy: 'fail' } }, ready(inconsistent.client));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.jobId, 'job-video-bad');
  assert.deepEqual(inconsistent.calls.adopt, []);
});

const continuity = { type: 'reasoning-continuity', carrier: { kind: 'opaque-v1', version: 1, payload: [7, 8, 9] } };

test('text.tools returns every ordered item and a ToolResult with the same call ID, then accepts the final text', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const fake = fakeClient({
    execute: (_spec, call) => call === 1
      ? { output: { type: 'text-generate', items: [continuity, { type: 'text', text: 'Converting.' }, { type: 'tool-call', toolCall: { id: 'call-7', name: 'lab_convert_centimeters', arguments: { centimeters: 30 } } }], finishReason: 'tool-calls' }, traceId: 'trace-1' }
      : { output: { type: 'text-generate', items: [{ type: 'text', text: '30 cm is 11.811 inches.' }], finishReason: 'stop' }, traceId: 'trace-2' },
  });
  const result = await runLabCapability({ capabilityId: 'text.tools', prompt: 'Convert 30 cm.', parameters: { scenario: 'tool-call' } }, ready(fake.client));
  assert.equal(result.ok, true, result.message);
  const [first, second] = fake.calls.execute;
  assert.deepEqual(first.tools.map((tool) => tool.name), ['lab_convert_centimeters']);
  assert.equal(first.toolChoice, 'auto');
  assert.deepEqual(second.messages[1], {
    role: 'assistant',
    text: '',
    turnItems: [
      { type: 'output', output: continuity },
      { type: 'output', output: { type: 'text', text: 'Converting.' } },
      { type: 'output', output: { type: 'tool-call', toolCall: { id: 'call-7', name: 'lab_convert_centimeters', arguments: { centimeters: 30 } } } },
      { type: 'tool-result', toolResult: { toolCallId: 'call-7', toolName: 'lab_convert_centimeters', result: { centimeters: 30, inches: 11.811 }, isError: false } },
    ],
  });
  assert.deepEqual(result.output.steps.map((step) => step.origin), ['model', 'app', 'model']);
  assert.deepEqual(result.output.steps[0].items[0], { type: 'reasoning-continuity', carrierKind: 'opaque-v1', version: 1, payloadBytes: 3 });
  assert.equal(result.output.text, '30 cm is 11.811 inches.');
});

test('text.tools fails explicitly for an undeclared tool or invalid arguments and never runs anything else', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  for (const call of [
    { id: 'c1', name: 'run_shell', arguments: { command: 'rm -rf /' } },
    { id: 'c2', name: 'lab_convert_centimeters', arguments: { centimeters: '30' } },
    { id: 'c3', name: 'lab_convert_centimeters', arguments: { centimeters: 30, extra: true } },
  ]) {
    const fake = fakeClient({ execute: () => ({ output: { type: 'text-generate', items: [{ type: 'tool-call', toolCall: call }], finishReason: 'tool-calls' }, traceId: 't' }) });
    const result = await runLabCapability({ capabilityId: 'text.tools', prompt: 'x', parameters: { scenario: 'tool-call' } }, ready(fake.client));
    assert.equal(result.ok, false, call.name);
    assert.equal(fake.calls.execute.length, 1, 'no follow-up turn after a failed check');
  }
  const noCall = fakeClient({ execute: () => ({ output: { type: 'text-generate', items: [{ type: 'text', text: 'I will not call tools.' }], finishReason: 'stop' }, traceId: 't' }) });
  const refused = await runLabCapability({ capabilityId: 'text.tools', prompt: 'x', parameters: { scenario: 'tool-call' } }, ready(noCall.client));
  assert.equal(refused.ok, false);
  const { t } = await load('shell/i18n/index.js');
  assert.ok(refused.message.includes(t('CapabilityTests.textTools.toolNotCalled', { tool: 'lab_convert_centimeters' })), refused.message);
});

test('text.tools structured output declares the fixed schema and the App parses and checks the final text', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { t } = await load('shell/i18n/index.js');
  const valid = fakeClient({ execute: () => ({ output: { type: 'text-generate', items: [{ type: 'text', text: '{"title":"Lab tests","priority":"high","tags":["lab"]}' }], finishReason: 'stop' }, traceId: 't' }) });
  const passed = await runLabCapability({ capabilityId: 'text.tools', prompt: 'Release note.', parameters: { scenario: 'structured-output' } }, ready(valid.client));
  assert.equal(passed.ok, true, passed.message);
  assert.equal(valid.calls.execute[0].responseFormat.type, 'json-schema');
  assert.equal(valid.calls.execute[0].responseFormat.name, 'lab_release_note');
  assert.equal(valid.calls.execute[0].tools, undefined);
  assert.deepEqual(passed.output.structured, { title: 'Lab tests', priority: 'high', tags: ['lab'] });
  for (const text of ['not json', '{"title":"x","priority":"urgent","tags":[]}', '{"title":"x","priority":"low","tags":[],"extra":1}']) {
    const fake = fakeClient({ execute: () => ({ output: { type: 'text-generate', items: [{ type: 'text', text }], finishReason: 'stop' }, traceId: 't' }) });
    const failed = await runLabCapability({ capabilityId: 'text.tools', prompt: 'x', parameters: { scenario: 'structured-output' } }, ready(fake.client));
    assert.equal(failed.ok, false, text);
    assert.ok(failed.message.includes(t('CapabilityTests.textTools.structuredCheckFailed', { detail: '' }).trim()), failed.message);
  }
});

// A Decisions form with a JSON state, a yes/no question and a choice whose
// second candidate has no description.
const decisionForm = () => ({
  stateFormat: 'json',
  state: '{ "query": "quiet headphones", "result": { "title": "Travel headphones tested" } }',
  questions: [
    { id: 'relevant', instructions: 'Does the result answer the query?', kind: 'boolean', candidates: [{ id: 'kept', description: '' }], trueCriterion: 'It answers the query.', falseCriterion: '  ' },
    { id: 'intent', instructions: 'What does the reader want?', kind: 'choice', candidates: [{ id: 'buy', description: 'Buy a pair' }, { id: 'learn', description: '' }, { id: 'compare', description: 'Compare models' }], trueCriterion: '', falseCriterion: '' },
  ],
  timeoutMs: 5000,
});
const decisionAnswers = [
  { questionId: 'relevant', kind: 'boolean', trueProbability: 0.875 },
  { questionId: 'intent', kind: 'choice', selectedCandidateId: 'learn', probabilities: [{ candidateId: 'buy', probability: 0.2 }, { candidateId: 'learn', probability: 0.5 }, { candidateId: 'compare', probability: 0.3 }] },
];
const decided = (answers = decisionAnswers) => ({ output: { type: 'text-decide', answers }, traceId: 'trace-decide' });
const typedError = (reasonCode, message = reasonCode) => Object.assign(new Error(message), { reasonCode, source: 'sdk' });

test('text.decide sends one typed spec built from the form and keeps every answer in submitted order', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { t } = await load('shell/i18n/index.js');
  const fake = fakeClient({ execute: () => decided() });
  const controller = new AbortController();
  const result = await runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: decisionForm(), signal: controller.signal }, ready(fake.client));
  assert.equal(result.ok, true, result.message);
  assert.equal(fake.calls.execute.length, 1);
  // Blank criteria and descriptions are omitted; everything else is sent as written.
  assert.deepEqual(fake.calls.execute[0], {
    type: 'text-decide',
    state: { json: { query: 'quiet headphones', result: { title: 'Travel headphones tested' } } },
    questions: [
      { id: 'relevant', instructions: { text: 'Does the result answer the query?' }, kind: 'boolean', trueCriterion: { text: 'It answers the query.' } },
      { id: 'intent', instructions: { text: 'What does the reader want?' }, kind: 'choice', candidates: [{ id: 'buy', description: { text: 'Buy a pair' } }, { id: 'learn' }, { id: 'compare', description: { text: 'Compare models' } }] },
    ],
  });
  assert.equal(fake.calls.executeOptions[0].signal, controller.signal);
  assert.equal(fake.calls.executeOptions[0].timeoutMs, 5000);
  assert.deepEqual(result.output, { kind: 'text-decision', answers: decisionAnswers });
  assert.equal(result.trace.traceId, 'trace-decide');
  assert.equal(result.message, t('CapabilityTests.textDecide.completed', { count: 2 }));

  const textState = fakeClient({ execute: () => decided([decisionAnswers[0]]) });
  const text = await runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: { stateFormat: 'text', state: '  keep spacing ', questions: [decisionForm().questions[0]] } }, ready(textState.client));
  assert.equal(text.ok, true, text.message);
  assert.deepEqual(textState.calls.execute[0].state, { text: '  keep spacing ' });
  assert.deepEqual(textState.calls.executeOptions[0], {}, 'no timeout is sent unless one is set');
});

test('text.decide refuses an invalid form before any call and names the problem', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { t } = await load('shell/i18n/index.js');
  const cases = [
    [{ ...decisionForm(), state: '[1, 2' }, 'stateJsonInvalid'],
    [{ ...decisionForm(), state: '"just a string"' }, 'stateJsonNotContainer'],
    [{ ...decisionForm(), questions: [] }, 'questionCount'],
    [{ ...decisionForm(), questions: [{ ...decisionForm().questions[1], candidates: [{ id: 'only', description: '' }] }] }, 'candidateCount'],
    [{ ...decisionForm(), questions: [decisionForm().questions[0], { ...decisionForm().questions[1], id: 'relevant' }] }, 'questionIdRepeated'],
    [{ ...decisionForm(), timeoutMs: 120001 }, 'timeout'],
  ];
  for (const [parameters, issue] of cases) {
    const fake = fakeClient({ execute: () => decided() });
    const result = await runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters }, ready(fake.client));
    assert.equal(result.ok, false, issue);
    assert.equal(result.reason, 'input-invalid', issue);
    assert.ok(result.message.includes(t(`CapabilityTests.textDecide.issues.${issue}`, { detail: '' }).replace(/[:：]\s*$/u, '')), `${issue}: ${result.message}`);
    assert.equal(fake.calls.execute.length, 0, issue);
  }
});

test('text.decide Stop settles as a caller stop and a late result is never shown', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { t } = await load('shell/i18n/index.js');
  // The SDK settles an aborted call right away with its typed canceled failure.
  const conforming = fakeClient({
    execute: (_spec, _call, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(typedError('OPERATION_ABORTED', 'Local-app scenario execution was canceled by its caller.')), { once: true });
    }),
  });
  const controller = new AbortController();
  const running = runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: decisionForm(), signal: controller.signal }, ready(conforming.client));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(conforming.calls.execute.length, 1);
  controller.abort('studio-user-canceled');
  const stopped = await running;
  assert.equal(stopped.ok, false);
  assert.equal(stopped.reason, 'operation-aborted');
  assert.equal(stopped.message, t('CapabilityTests.textDecide.stopped'));
  assert.equal(stopped.diagnostics.reasonCode, 'OPERATION_ABORTED');

  // A carrier that still resolves after Stop does not turn the run into a success.
  let release;
  const late = fakeClient({ execute: () => new Promise((resolve) => { release = () => resolve(decided()); }) });
  const lateController = new AbortController();
  const lateRun = runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: decisionForm(), signal: lateController.signal }, ready(late.client));
  await new Promise((resolve) => setImmediate(resolve));
  lateController.abort('studio-user-canceled');
  release();
  const lateResult = await lateRun;
  assert.equal(lateResult.ok, false);
  assert.equal(lateResult.reason, 'operation-aborted');

  // Stopped before the call: nothing reaches the SDK.
  const early = fakeClient({ execute: () => decided() });
  const aborted = new AbortController();
  aborted.abort('studio-user-canceled');
  const before = await runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: decisionForm(), signal: aborted.signal }, ready(early.client));
  assert.equal(before.reason, 'operation-aborted');
  assert.equal(early.calls.execute.length, 0);
});

test('text.decide failures keep typed non-success reasons and the input limit has its own copy', async () => {
  const { runLabCapability } = await load('lab/lab-runtime.js');
  const { studioNonSuccessReasonUserMessage, studioNonSuccessReasonUserAction } = await load('ai-studio-core/non-success-presentation.js');
  const { t } = await load('shell/i18n/index.js');
  const run = async (execute) => runLabCapability({ capabilityId: 'text.decide', prompt: '', parameters: decisionForm() }, ready(fakeClient({ execute }).client));
  const cases = [
    ['AI_INPUT_LIMIT_EXCEEDED', 'input-invalid'],
    ['AI_INPUT_INVALID', 'input-invalid'],
    ['SDK_LOCAL_APP_INPUT_INVALID', 'input-invalid'],
    ['OPERATION_TIMEOUT', 'runtime-timeout'],
    ['AI_PROVIDER_TIMEOUT', 'runtime-timeout'],
    ['AI_OUTPUT_INVALID', 'runtime-call-failed'],
    ['AI_ROUTE_UNSUPPORTED', 'runtime-call-failed'],
  ];
  for (const [reasonCode, reason] of cases) {
    const result = await run(() => { throw typedError(reasonCode); });
    assert.equal(result.ok, false, reasonCode);
    assert.equal(result.reason, reason, reasonCode);
    assert.equal(result.diagnostics.reasonCode, reasonCode);
  }
  // The carrier's default deadline (no timeoutMs) is a timeout, not a generic failure.
  const carrierDeadline = await run(() => { throw typedError('timeout'); });
  assert.equal(carrierDeadline.reason, 'runtime-timeout');
  const limit = await run(() => { throw typedError('AI_INPUT_LIMIT_EXCEEDED'); });
  assert.equal(studioNonSuccessReasonUserMessage(limit.reason, t, limit.capabilityId, limit.diagnostics), t('NonSuccess.message.inputLimitExceeded'));
  assert.equal(studioNonSuccessReasonUserAction(limit.reason, t, limit.capabilityId, limit.diagnostics), t('NonSuccess.action.inputLimitExceeded'));
  assert.notEqual(t('NonSuccess.message.inputLimitExceeded'), t('NonSuccess.message.inputInvalid'));

  // Only a synchronous decision reads as simply stopped; a Job whose cancellation
  // is unconfirmed keeps the pending-cancellation copy even without a jobId.
  const { isStoppedDirectCall, studioNonSuccessReasonTitle } = await load('ai-studio-core/non-success-presentation.js');
  assert.equal(isStoppedDirectCall('operation-aborted', 'text.decide'), true);
  assert.equal(isStoppedDirectCall('operation-aborted', 'video.generate'), false);
  assert.equal(studioNonSuccessReasonTitle('operation-aborted', t, 'text.decide'), t('NonSuccess.title.stoppedDirectCall'));
  assert.equal(studioNonSuccessReasonUserMessage('operation-aborted', t, 'video.generate'), t('NonSuccess.message.operationAborted'));
  assert.equal(studioNonSuccessReasonTitle('operation-aborted', t, 'video.generate'), t('NonSuccess.title.operationAborted'));

  // Answers that do not match the submitted questions are never shown.
  const [relevant, intent] = decisionAnswers;
  for (const answers of [
    [intent, relevant],
    [relevant],
    [relevant, { ...intent, probabilities: [intent.probabilities[1], intent.probabilities[0], intent.probabilities[2]] }],
    [relevant, { ...intent, selectedCandidateId: 'unknown' }],
  ]) {
    const mismatch = await run(() => decided(answers));
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, 'runtime-call-failed');
    assert.equal(mismatch.message, t('CapabilityTests.textDecide.resultMismatch'));
  }
});

test('text.decide history records the exact spec, restores the form and the answers', async () => {
  const { createStudioRunHistoryRecord, restoreStudioCapabilityRunResult, getStudioRunMetricSummary, getStudioRunResultTags } = await load('ai-studio-core/history.js');
  const { labTextDecideParameters, encodeLabTextDecideRequest, decodeLabTextDecideRequest } = await load('lab/lab-only/text-decide.js');
  const form = decisionForm();
  const prompt = encodeLabTextDecideRequest(form);
  assert.equal(labTextDecideParameters.recordedInput.encode(form), prompt);
  assert.deepEqual(JSON.parse(prompt).questions.map((question) => question.id), ['relevant', 'intent']);
  const record = createStudioRunHistoryRecord({
    result: { ok: true, capabilityId: 'text.decide', capabilityLabel: 'Decisions', message: 'ok', output: { kind: 'text-decision', answers: decisionAnswers }, trace: { traceId: 'trace-decide' } },
    prompt, runId: 'run-decide', createdAt: '2026-09-24T00:00:00.000Z',
  });
  assert.equal(record.prompt, prompt);
  assert.equal(record.result.kind, 'text-decision');
  assert.equal(record.result.questionCount, 2);
  assert.equal(record.result.summary, 'relevant: true 0.88 / intent: learn 0.50');
  assert.equal(getStudioRunMetricSummary(record), '2 questions');
  assert.deepEqual(getStudioRunResultTags(record), ['Decision', '2 questions']);
  const restored = restoreStudioCapabilityRunResult(record, () => 'Decisions');
  assert.deepEqual(restored.output, { kind: 'text-decision', answers: decisionAnswers });
  assert.equal(restored.trace.traceId, 'trace-decide');
  assert.equal(restoreStudioCapabilityRunResult({ ...record, result: { ...record.result, answers: undefined } }, () => 'Decisions'), null);

  // The form comes back from the record; the call timeout is not part of it.
  const decoded = decodeLabTextDecideRequest(prompt);
  assert.equal(decoded.stateFormat, 'json');
  assert.deepEqual(JSON.parse(decoded.state), JSON.parse(form.state));
  assert.deepEqual(decoded.questions.map((question) => [question.id, question.kind, question.instructions]), [
    ['relevant', 'boolean', 'Does the result answer the query?'],
    ['intent', 'choice', 'What does the reader want?'],
  ]);
  assert.deepEqual(decoded.questions[0], { id: 'relevant', instructions: 'Does the result answer the query?', kind: 'boolean', candidates: [], trueCriterion: 'It answers the query.', falseCriterion: '' });
  assert.deepEqual(decoded.questions[1].candidates, [{ id: 'buy', description: 'Buy a pair' }, { id: 'learn', description: '' }, { id: 'compare', description: 'Compare models' }]);
  assert.equal('timeoutMs' in decoded, false);
  assert.equal(encodeLabTextDecideRequest({ ...form, ...decoded }), prompt, 're-encoding a restored form sends the same spec');
  // A truncated preview or a spec the form cannot represent is not restored.
  assert.equal(decodeLabTextDecideRequest(prompt.slice(0, 40)), null);
  const jsonInstructions = JSON.parse(prompt);
  jsonInstructions.questions[0].instructions = { json: { ask: 'relevance' } };
  assert.equal(decodeLabTextDecideRequest(JSON.stringify(jsonInstructions)), null);
});

test('text.decide runs on the Local or Cloud route saved in AIConfig and keeps its request on both', async () => {
  const { labTextDecideParameters } = await load('lab/lab-only/text-decide.js');
  const { isLabLocalRouteOnlyCapability } = await load('lab/lab-only/capability-test-descriptors.js');
  const form = decisionForm();
  assert.deepEqual(labTextDecideParameters.project('local', form), form);
  assert.deepEqual(labTextDecideParameters.project('cloud', form), form);
  for (const source of ['local', 'cloud']) {
    assert.ok(labTextDecideParameters.presentation(source).every((item) => item.state === 'enabled'), source);
  }
  assert.equal(isLabLocalRouteOnlyCapability('text.decide'), false);
  assert.equal(labTextDecideParameters.hasAlternativeInput(labTextDecideParameters.initial()), true, 'the loaded example is runnable');
  assert.equal(labTextDecideParameters.hasAlternativeInput({ ...form, state: '' }), false);
});

test('history keeps equal-dimension embeddings from different spaces apart after reopening', async () => {
  const { createStudioRunHistoryRecord, restoreStudioCapabilityRunResult, getStudioRunMetricSummary } = await load('ai-studio-core/history.js');
  const record = (spaceId, runId) => createStudioRunHistoryRecord({
    result: { ok: true, capabilityId: 'text.embed', capabilityLabel: 'Embeddings', message: 'ok', output: { kind: 'embedding', vectorCount: 1, dimensions: 768, spaceId, sample: [0.1] } },
    prompt: 'same', runId, createdAt: '2026-09-23T00:00:00.000Z',
  });
  const first = record('cloud:space-a', 'run-a');
  const second = record('local:space-b', 'run-b');
  assert.notEqual(first.result.summary, second.result.summary);
  assert.notEqual(getStudioRunMetricSummary(first), getStudioRunMetricSummary(second));
  const label = () => 'Embeddings';
  assert.equal(restoreStudioCapabilityRunResult(first, label).output.spaceId, 'cloud:space-a');
  assert.equal(restoreStudioCapabilityRunResult(second, label).output.spaceId, 'local:space-b');
});

function fakeVideoSessions({ results = [], openError, submitError } = {}) {
  const calls = { open: [], submit: [], close: [] };
  const queue = [...results];
  let closed = false;
  return {
    calls,
    client: {
      async open(input) {
        calls.open.push(input);
        if (openError) throw openError;
        return { videoSessionId: 'vs-1', generation: '1', format: input.format, maximumInFlightSubmissions: 2 };
      },
      async submitFrame(input) {
        calls.submit.push(input);
        if (submitError) throw submitError;
        return { accepted: true, sequence: input.sequence };
      },
      async read() {
        if (closed) throw Object.assign(new Error('closed'), { reasonCode: 'SDK_LOCAL_APP_OPERATION_UNAVAILABLE' });
        await new Promise((resolve) => setImmediate(resolve));
        return queue.shift() ?? null;
      },
      async close(input) { calls.close.push(input); closed = true; return { closed: true }; },
    },
  };
}

async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('video Session opens with the App-owned reference, separates receipts from correlated results and closes', async () => {
  const { createLabVideoSessionController, labVideoSessionSummary, labRgbaToRgb8, labRgb8ToRgba, labContainRect, LAB_VIDEO_SESSION_FRAME_BYTES } = await load('lab/lab-only/video-face-swap-session.js');
  const frame = new Uint8Array(LAB_VIDEO_SESSION_FRAME_BYTES);
  const fake = fakeVideoSessions({ results: [
    { videoSessionId: 'vs-1', generation: '1', type: 'transformed', sequence: '1', timestampUs: '0', frame },
    { videoSessionId: 'vs-1', generation: '1', type: 'no-target-face', sequence: '2', timestampUs: '33333', reasonCode: 'AI_FACE_TARGET_MISSING' },
  ] });
  const states = [];
  const session = createLabVideoSessionController({ client: fake.client, now: () => new Date('2026-09-23T00:00:00.000Z'), onState: (state) => states.push(state) });
  await session.open('upload-ref');
  assert.deepEqual(fake.calls.open[0], { referenceImageArtifactId: 'upload-ref', format: { width: 1280, height: 720, pixelFormat: 'rgb8' } });
  await session.submit(frame);
  assert.equal(session.getState().frames[0].receipt, 'accepted');
  await session.submit(frame);
  await waitFor(() => session.getState().frames.every((entry) => entry.result), 'correlated Session results');
  const [first, second] = session.getState().frames;
  assert.deepEqual([first.sequence, first.timestampUs, first.result.type], ['1', '0', 'transformed']);
  assert.deepEqual([second.sequence, second.timestampUs, second.result.type], ['2', '33333', 'no-target-face']);
  await session.close();
  assert.equal(session.getState().phase, 'closed');
  assert.equal(fake.calls.close.length, 1);
  const { t } = await load('shell/i18n/index.js');
  await assert.rejects(() => session.submit(frame), { message: t('CapabilityTests.videoSession.notOpen') });
  const summary = labVideoSessionSummary(session.getState());
  assert.equal(summary.ending, 'closed');
  assert.equal(summary.observed.transformed, 1);
  assert.equal(summary.observed['no-target-face'], 1);
  assert.equal(summary.observed.accepted, 2);
  // Fixed-format conversion keeps pixel order and places images without stretching.
  const rgba = new Uint8ClampedArray(1280 * 720 * 4).fill(9);
  rgba[0] = 1; rgba[1] = 2; rgba[2] = 3;
  const rgb = labRgbaToRgb8(rgba);
  assert.deepEqual([...rgb.slice(0, 4)], [1, 2, 3, 9]);
  assert.equal(labRgb8ToRgba(rgb)[3], 255);
  assert.deepEqual(labContainRect(640, 640), { x: 280, y: 0, width: 720, height: 720 });
});

test('video Session reports owner termination and open failure without claiming a result', async () => {
  const { createLabVideoSessionController, labVideoSessionSummary } = await load('lab/lab-only/video-face-swap-session.js');
  const fake = fakeVideoSessions({ results: [{ videoSessionId: 'vs-1', generation: '1', type: 'session-terminal', reasonCode: 'AI_VIDEO_SESSION_OVERLOADED' }] });
  const session = createLabVideoSessionController({ client: fake.client, now: () => new Date(), onState: () => {} });
  await session.open('upload-ref');
  await waitFor(() => session.getState().phase === 'terminated', 'owner termination');
  assert.equal(session.getState().phase, 'terminated');
  assert.equal(labVideoSessionSummary(session.getState()).terminalReason, 'AI_VIDEO_SESSION_OVERLOADED');
  const failing = fakeVideoSessions({ openError: Object.assign(new Error('no loadout'), { reasonCode: 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED' }) });
  const refused = createLabVideoSessionController({ client: failing.client, now: () => new Date(), onState: () => {} });
  await assert.rejects(() => refused.open('upload-ref'), /no loadout/u);
  assert.equal(refused.getState().terminalReason, 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED');
});

// The event stream stays open until Close unless a test ends it on purpose.
function fakeRealtime({ events = [], openError, ackOk = true, endStream = false } = {}) {
  const calls = { open: [], append: [], control: [], interrupt: [], close: [] };
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const control = (lifecycle = 'ready', terminalReason = '') => ({ realtimeSessionId: 'rt-1', channelId: 'ch', subscriptionId: '', adapterKind: 'ai', lifecycle, generation: '1', sequence: '1', correlationId: 'c', backpressure: 'normal', bufferedItems: 0, bufferCapacity: 64, terminalReason, actionHint: '', occurredAt: null });
  const operation = () => ({ ack: { ok: ackOk, reasonCode: ackOk ? '' : 'AI_INPUT_INVALID', actionHint: '' }, control: control() });
  return {
    calls,
    client: {
      async open(input) {
        calls.open.push(input);
        if (openError) throw openError;
        return { realtimeSessionId: 'rt-1', generation: '1', channelId: 'ch', negotiatedInputAudio: input.inputAudio, negotiatedOutputAudio: null, control: control() };
      },
      async appendInput(input) { calls.append.push(input); return operation(); },
      async submitOwnerControl(input) { calls.control.push(input); return operation(); },
      async subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) { await new Promise((resolve) => setImmediate(resolve)); yield { control: control(), event }; }
            if (!endStream) await released;
          },
          async cancel() { release(); },
        };
      },
      async interruptOutput(input) { calls.interrupt.push(input); return operation(); },
      async close(input) { calls.close.push(input); release(); return { ack: { ok: true, reasonCode: '', actionHint: '' }, control: control('closed', 'cancelled') }; },
    },
  };
}

test('direct AI Realtime opens without an Agent using the legal 16 kHz PCM format, sends text with an explicit response start and closes', async () => {
  const { createLabRealtimeController, labRealtimeSessionSummary } = await load('lab/lab-only/ai-realtime-session.js');
  const fake = fakeRealtime({ events: [
    { type: 'opened', inputAudio: { codec: 'pcm-s16le', sampleRateHz: 16000, channelCount: 1, frameDurationMs: 20, maximumFrameBytes: 640 }, outputAudio: null, turnDetection: 'manual' },
    { type: 'text-output', requestId: 'lab-text-1', outputTrackId: 'track-1', text: 'Hel', final: false },
    { type: 'text-output', requestId: 'lab-text-1', outputTrackId: 'track-1', text: 'lo!', final: false },
    { type: 'text-output', requestId: 'lab-text-1', outputTrackId: 'track-1', text: 'Hello!', final: true },
    { type: 'output-track', requestId: 'lab-text-1', outputTrackId: 'track-1', lifecycle: 'completed', reasonCode: '' },
    { type: 'request-terminal', requestId: 'lab-text-1', finishReason: 'stop', usage: null, reasonCode: '' },
  ] });
  let id = 0;
  const session = createLabRealtimeController({ client: fake.client, now: () => new Date('2026-09-23T00:00:00.000Z'), createId: (prefix) => `${prefix}-${++id}`, onState: () => {} });
  await session.open({ instruction: '  Be brief.  ', turnDetection: 'manual', audioOutputEnabled: false });
  assert.deepEqual(fake.calls.open[0], {
    inputAudio: { codec: 'pcm-s16le', sampleRateHz: 16000, channelCount: 1, frameDurationMs: 20, maximumFrameBytes: 640 },
    audioOutputEnabled: false,
    turnDetection: 'manual',
    initialInstruction: 'Be brief.',
  });
  assert.equal('agentHandle' in fake.calls.open[0], false);
  const requestId = await session.sendText('Say hello');
  assert.deepEqual(fake.calls.append[0].input, { type: 'text', requestId, text: 'Say hello' });
  assert.deepEqual(fake.calls.control[0], { realtimeSessionId: 'rt-1', generation: '1', requestId, control: 'start-response' });
  await waitFor(() => session.getState().observed['request-terminal'] === 1, 'request terminal');
  assert.equal(session.getState().phase, 'open', 'a finished response does not end the Session');
  assert.equal(session.getState().tracks[0].text, 'Hello!', 'the complete final text replaces the deltas instead of repeating them');
  assert.equal(session.getState().tracks[0].lifecycle, 'completed');
  await session.close();
  const summary = labRealtimeSessionSummary(session.getState());
  assert.equal(summary.ending, 'closed');
  assert.equal(summary.terminalReason, 'cancelled');
  assert.equal(summary.observed['text-input'], 1);
  assert.equal(summary.observed['text-output'], 3);
});

test('direct AI Realtime reports the owner reason for a refused Local route, a rejected ack and an ended event stream', async () => {
  const { createLabRealtimeController, labRealtimeSessionSummary } = await load('lab/lab-only/ai-realtime-session.js');
  const local = fakeRealtime({ openError: Object.assign(new Error('Local driver unavailable'), { reasonCode: 'AI_LOCAL_DRIVER_UNAVAILABLE' }) });
  const refused = createLabRealtimeController({ client: local.client, now: () => new Date(), createId: (prefix) => prefix, onState: () => {} });
  await assert.rejects(() => refused.open({ instruction: '', turnDetection: 'manual', audioOutputEnabled: false }), /Local driver unavailable/u);
  assert.equal(refused.getState().terminalReason, 'AI_LOCAL_DRIVER_UNAVAILABLE');
  assert.equal(labRealtimeSessionSummary(refused.getState()).ending, 'terminated');

  const rejecting = fakeRealtime({ ackOk: false });
  const session = createLabRealtimeController({ client: rejecting.client, now: () => new Date(), createId: (prefix) => prefix, onState: () => {} });
  await session.open({ instruction: '', turnDetection: 'manual', audioOutputEnabled: false });
  const { t } = await load('shell/i18n/index.js');
  await assert.rejects(() => session.sendText('hi'), { message: t('CapabilityTests.aiRealtime.notAcknowledged', { operation: 'append-text' }) });
  assert.equal(rejecting.calls.control.length, 0, 'no response starts after a rejected input');
  await session.close();

  const ending = fakeRealtime({ endStream: true, events: [{ type: 'session-terminal', reasonCode: 'AI_PROVIDER_UNAVAILABLE' }] });
  const ended = createLabRealtimeController({ client: ending.client, now: () => new Date(), createId: (prefix) => prefix, onState: () => {} });
  await ended.open({ instruction: '', turnDetection: 'manual', audioOutputEnabled: false });
  await waitFor(() => ended.getState().phase === 'terminated', 'owner terminal');
  assert.equal(ended.getState().terminalReason, 'AI_PROVIDER_UNAVAILABLE');

  const silent = fakeRealtime({ endStream: true });
  const dropped = createLabRealtimeController({ client: silent.client, now: () => new Date(), createId: (prefix) => prefix, onState: () => {} });
  await dropped.open({ instruction: '', turnDetection: 'manual', audioOutputEnabled: false });
  await waitFor(() => dropped.getState().phase === 'terminated', 'ended stream');
  assert.equal(dropped.getState().terminalReason, 'event-stream-ended', 'an event stream that ends is not a successful close');
});

// Holds an owner call until the test releases it, so Close can happen first.
function gated(call) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return { call: async (...args) => { await gate; return call(...args); }, release };
}

test('closing a video Session while Open is pending closes the Session the owner returns', async () => {
  const { createLabVideoSessionController, labVideoSessionSummary } = await load('lab/lab-only/video-face-swap-session.js');
  const fake = fakeVideoSessions();
  const open = gated(fake.client.open);
  let reads = 0;
  const read = fake.client.read;
  const client = { ...fake.client, open: open.call, read: async (scope) => { reads += 1; return read(scope); } };
  const phases = [];
  const session = createLabVideoSessionController({ client, now: () => new Date(), onState: (state) => phases.push(state.phase) });
  const opening = session.open('upload-ref');
  const closing = session.close();
  assert.equal(session.getState().phase, 'closing');
  assert.equal(fake.calls.close.length, 0, 'nothing is closed before the owner answers Open');
  open.release();
  await Promise.all([opening, closing]);
  assert.deepEqual(fake.calls.close, [{ videoSessionId: 'vs-1', generation: '1' }]);
  assert.equal(phases.includes('open'), false, 'a late Open never reopens a closing controller');
  assert.equal(reads, 0);
  assert.equal(session.getState().terminalReason, 'closed-during-open');
  assert.equal(labVideoSessionSummary(session.getState()).ending, 'closed');

  // An Open that fails after Close has nothing to close and keeps its reason.
  const failing = fakeVideoSessions({ openError: Object.assign(new Error('no loadout'), { reasonCode: 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED' }) });
  const failingOpen = gated(failing.client.open);
  const refused = createLabVideoSessionController({ client: { ...failing.client, open: failingOpen.call }, now: () => new Date(), onState: () => {} });
  const refusedOpening = refused.open('upload-ref');
  const refusedClosing = refused.close();
  failingOpen.release();
  await assert.rejects(() => refusedOpening, /no loadout/u);
  await refusedClosing;
  assert.equal(failing.calls.close.length, 0);
  assert.equal(refused.getState().terminalReason, 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED');

  // Closed while the reference was still uploading: Open never reaches the owner.
  const early = fakeVideoSessions();
  const idle = createLabVideoSessionController({ client: early.client, now: () => new Date(), onState: () => {} });
  await idle.close();
  await idle.open('upload-ref');
  assert.equal(early.calls.open.length, 0);
  assert.equal(idle.getState().terminalReason, 'closed-before-open');
});

test('closing a direct AI Realtime Session while Open is pending closes the returned Session without subscribing', async () => {
  const { createLabRealtimeController, labRealtimeSessionSummary } = await load('lab/lab-only/ai-realtime-session.js');
  const options = { instruction: '', turnDetection: 'manual', audioOutputEnabled: false };
  const fake = fakeRealtime();
  const open = gated(fake.client.open);
  let subscribed = 0;
  const subscribe = fake.client.subscribe;
  const client = { ...fake.client, open: open.call, subscribe: async (scope) => { subscribed += 1; return subscribe(scope); } };
  const phases = [];
  const session = createLabRealtimeController({ client, now: () => new Date(), createId: (prefix) => prefix, onState: (state) => phases.push(state.phase) });
  const opening = session.open(options);
  const closing = session.close();
  assert.equal(fake.calls.close.length, 0, 'nothing is closed before the owner answers Open');
  open.release();
  await Promise.all([opening, closing]);
  assert.deepEqual(fake.calls.close, [{ realtimeSessionId: 'rt-1', generation: '1' }]);
  assert.equal(subscribed, 0);
  assert.equal(phases.includes('open'), false, 'a late Open never reopens a closing controller');
  const summary = labRealtimeSessionSummary(session.getState());
  assert.equal(summary.ending, 'closed');
  assert.equal(summary.observed['closed-during-open'], 1);

  // A Close that starts while the event stream attaches cancels that stream.
  const attaching = fakeRealtime();
  const attach = gated(attaching.client.subscribe);
  let canceled = 0;
  const late = createLabRealtimeController({
    client: {
      ...attaching.client,
      subscribe: async (scope) => {
        const subscription = await attach.call(scope);
        return { [Symbol.asyncIterator]: () => subscription[Symbol.asyncIterator](), cancel: async () => { canceled += 1; await subscription.cancel(); } };
      },
    },
    now: () => new Date(),
    createId: (prefix) => prefix,
    onState: () => {},
  });
  const lateOpening = late.open(options);
  await waitFor(() => late.getState().phase === 'open', 'Open returned');
  await late.close();
  attach.release();
  await lateOpening;
  assert.equal(canceled, 1);
  assert.equal(late.getState().phase, 'closed');
  assert.equal(attaching.calls.close.length, 1);
});

test('Local-only Lab entries keep their inputs out of a Cloud request and present them as route-limited', async () => {
  const { labTextAnnotateParameters } = await load('lab/lab-only/text-annotate.js');
  const { labImageFaceSwapParameters, labVideoFaceSwapParameters } = await load('lab/lab-only/face-swap.js');
  const media = { name: 'a.png', mimeType: 'image/png', sizeBytes: 1, bytes: new Uint8Array([1]) };
  const cases = [
    [labTextAnnotateParameters, { language: 'en', documents: ['Second document.'] }],
    [labImageFaceSwapParameters, { reference: media, target: media }],
    [labVideoFaceSwapParameters, { reference: media, target: media, noFacePolicy: 'fail' }],
  ];
  for (const [contract, parameters] of cases) {
    assert.deepEqual(contract.project('local', parameters), parameters);
    assert.deepEqual(contract.project('cloud', parameters), {});
    assert.ok(contract.presentation('cloud').every((item) => item.state === 'disabled' && item.unavailableBecause === 'route'));
    assert.ok(contract.presentation('local').every((item) => item.state === 'enabled'));
  }
});
