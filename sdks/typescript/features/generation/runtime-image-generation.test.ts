import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  VideoContentType,
} from '../../core-generated/runtime-typed-client';
import { runNimiRuntimeImageGeneration, runNimiRuntimeVideoGeneration } from './index';

test('runNimiRuntimeImageGeneration submits an image scenario job and returns image artifacts', async () => {
  const submitted: any[] = [];
  let terminalGets = 0;
  const artifact = {
    artifactId: 'artifact-image-1',
    mimeType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
  const runtime = {
    async submitScenarioJob(request: any, options: any) {
      submitted.push({ request, options });
      return {
        job: {
          jobId: 'job-image-1',
          status: ScenarioJobStatus.SUBMITTED,
          scenarioType: ScenarioType.IMAGE_GENERATE,
          artifacts: [],
        },
      };
    },
    async getScenarioJob() {
      terminalGets += 1;
      return {
        job: {
          jobId: 'job-image-1', status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.IMAGE_GENERATE, artifacts: [artifact], traceId: 'trace-image-1',
        },
      };
    },
    async cancelScenarioJob() {
      throw new Error('cancel should not be called');
    },
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-image-1',
        job: {
          jobId: 'job-image-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.IMAGE_GENERATE,
          artifacts: [artifact],
          traceId: 'trace-image-1',
        },
      };
    },
    async getScenarioArtifacts() {
      return {
        traceId: 'trace-artifacts-1',
        artifacts: [artifact],
        output: {
          output: {
            oneofKind: 'imageGenerate',
            imageGenerate: {
              artifacts: [artifact],
            },
          },
        },
      };
    },
  };

  const result = await runNimiRuntimeImageGeneration({
    runtime,
    head: {
      appId: 'nimi.local-gateway.openai-compatible',
      subjectUserId: 'local-user',
    },
    prompt: 'Song dynasty scholar portrait',
    negativePrompt: 'low quality',
    size: '1024x1024',
    seed: 42,
    referenceImageArtifactId: 'artifact-image-source-1',
    maskArtifactId: 'artifact-image-mask-1',
    strength: 0.7,
    responseFormat: 'b64_json',
    requestId: 'request-image-1',
    idempotencyKey: 'idem-image-1',
    labels: { gateway: 'openai-compatible' },
  });

  assert.equal(result.job.jobId, 'job-image-1');
  assert.equal(result.traceId, 'trace-artifacts-1');
  assert.deepEqual(result.artifacts, [artifact]);
  assert.equal(submitted.length, 1);
  assert.equal(terminalGets, 1);
  assert.equal(submitted[0].request.scenarioType, ScenarioType.IMAGE_GENERATE);
  assert.equal(submitted[0].request.executionMode, ExecutionMode.ASYNC_JOB);
  assert.deepEqual(submitted[0].request.head, {
    appId: 'nimi.local-gateway.openai-compatible',
    subjectUserId: 'local-user',
    timeoutMs: 0,
  });
  assert.equal(submitted[0].request.spec.spec.oneofKind, 'imageGenerate');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.prompt, 'Song dynasty scholar portrait');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.negativePrompt, 'low quality');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.size, '1024x1024');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.n, undefined);
  assert.equal(submitted[0].request.spec.spec.imageGenerate.seed, '42');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.referenceImageArtifactId, 'artifact-image-source-1');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.maskArtifactId, 'artifact-image-mask-1');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.strength, 0.7);
  assert.equal(submitted[0].request.spec.spec.imageGenerate.responseFormat, 'b64_json');
  assert.equal(submitted[0].request.labels.gateway, 'openai-compatible');
  assert.equal(submitted[0].options.metadata['x-nimi-idempotency-key'], 'idem-image-1');
});

test('runNimiRuntimeImageGeneration rejects reference URL and artifact custody carriers together', async () => {
  let submitCalls = 0;
  await assert.rejects(
    () => runNimiRuntimeImageGeneration({
      runtime: {
        async submitScenarioJob() {
          submitCalls += 1;
          throw new Error('submit must not be reached');
        },
      } as any,
      head: { appId: 'app.test' },
      prompt: 'edit this image',
      referenceImages: ['https://example.test/reference.png'],
      referenceImageArtifactId: 'artifact-image-source-1',
      requestId: 'request-image-xor',
      idempotencyKey: 'idem-image-xor',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_GENERATION_SCENARIO_INVALID',
  );
  assert.equal(submitCalls, 0);
});

test('runNimiRuntimeImageGeneration rejects a non-canonical artifact custody identifier', async () => {
  await assert.rejects(
    () => runNimiRuntimeImageGeneration({
      runtime: {} as any,
      head: { appId: 'app.test' },
      prompt: 'edit this image',
      referenceImageArtifactId: ' artifact-image-source-1 ',
      requestId: 'request-image-artifact-invalid',
      idempotencyKey: 'idem-image-artifact-invalid',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_GENERATION_SCENARIO_INVALID',
  );
});

test('runNimiRuntimeImageGeneration rejects ambiguous or source-less mask custody', async () => {
  for (const input of [
    {
      referenceImageArtifactId: 'artifact-image-source-1',
      mask: 'https://example.test/mask.png',
      maskArtifactId: 'artifact-image-mask-1',
    },
    { maskArtifactId: 'artifact-image-mask-1' },
    { strength: 0.5 },
  ]) {
    await assert.rejects(
      () => runNimiRuntimeImageGeneration({
        runtime: {} as any,
        head: { appId: 'app.test' },
        prompt: 'edit this image',
        ...input,
        requestId: 'request-image-mask-invalid',
        idempotencyKey: 'idem-image-mask-invalid',
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_GENERATION_SCENARIO_INVALID',
    );
  }
});

test('runNimiRuntimeVideoGeneration submits a video scenario job and returns video artifacts', async () => {
  const submitted: any[] = [];
  let terminalGets = 0;
  const artifact = {
    artifactId: 'artifact-video-1',
    mimeType: 'video/mp4',
    uri: 'runtime-artifact://artifact-video-1',
    bytes: new Uint8Array(),
  };
  const runtime = {
    async submitScenarioJob(request: any, options: any) {
      submitted.push({ request, options });
      return {
        job: {
          jobId: 'job-video-1',
          status: ScenarioJobStatus.SUBMITTED,
          scenarioType: ScenarioType.VIDEO_GENERATE,
          artifacts: [],
        },
      };
    },
    async getScenarioJob() {
      terminalGets += 1;
      return {
        job: {
          jobId: 'job-video-1', status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.VIDEO_GENERATE, artifacts: [artifact], traceId: 'trace-video-1',
        },
      };
    },
    async cancelScenarioJob() {
      throw new Error('cancel should not be called');
    },
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-video-1',
        job: {
          jobId: 'job-video-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.VIDEO_GENERATE,
          artifacts: [artifact],
          traceId: 'trace-video-1',
        },
      };
    },
    async getScenarioArtifacts() {
      return {
        traceId: 'trace-artifacts-video-1',
        artifacts: [artifact],
        output: {
          output: {
            oneofKind: 'videoGenerate',
            videoGenerate: {
              artifacts: [artifact],
            },
          },
        },
      };
    },
  };

  const result = await runNimiRuntimeVideoGeneration({
    runtime,
    head: {
      appId: 'nimi.local-gateway.openai-compatible',
      subjectUserId: 'local-user',
      timeoutMs: 123000,
    },
    mode: 't2v',
    prompt: 'Generate a moving product shot',
    negativePrompt: 'blur',
    content: [
      { type: 'text', role: 'prompt', text: 'Generate a moving product shot' },
      { type: 'artifact-ref', role: 'first-frame', artifactId: 'artifact-image-source-1' },
    ],
    options: {
      ratio: '9:16',
      durationSec: 6,
      resolution: '720p',
      fps: 24,
      seed: '42',
      cameraFixed: true,
      generateAudio: true,
    },
    requestId: 'request-video-1',
    idempotencyKey: 'idem-video-1',
    labels: { gateway: 'openai-compatible' },
  });

  assert.equal(result.job.jobId, 'job-video-1');
  assert.equal(result.traceId, 'trace-artifacts-video-1');
  assert.deepEqual(result.artifacts, [artifact]);
  assert.equal(submitted.length, 1);
  assert.equal(terminalGets, 1);
  assert.equal(submitted[0].request.scenarioType, ScenarioType.VIDEO_GENERATE);
  assert.equal(submitted[0].request.executionMode, ExecutionMode.ASYNC_JOB);
  assert.deepEqual(submitted[0].request.head, {
    appId: 'nimi.local-gateway.openai-compatible',
    subjectUserId: 'local-user',
    timeoutMs: 123000,
  });
  assert.equal(submitted[0].request.spec.spec.oneofKind, 'videoGenerate');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.prompt, 'Generate a moving product shot');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.negativePrompt, 'blur');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.mode, 1);
  assert.equal(submitted[0].request.spec.spec.videoGenerate.content[1].type, VideoContentType.ARTIFACT_REF);
  assert.equal(submitted[0].request.spec.spec.videoGenerate.content[1].artifactRef.artifactId, 'artifact-image-source-1');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.ratio, '9:16');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.durationSec, 6);
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.resolution, '720p');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.fps, 24);
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.seed, '42');
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.cameraFixed, true);
  assert.equal(submitted[0].request.spec.spec.videoGenerate.options.generateAudio, true);
  assert.equal(submitted[0].options.metadata['x-nimi-idempotency-key'], 'idem-video-1');
});
