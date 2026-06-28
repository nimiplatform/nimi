import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  FallbackPolicy,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
} from '../../core-generated/runtime-typed-client';
import type { RuntimeDurableTargetRef } from '../../core-generated/runtime-protobuf/runtime/v1/runtime_target_identity';
import { runNimiRuntimeImageGeneration } from './index';

const targetRef: RuntimeDurableTargetRef = {
  target: {
    oneofKind: 'localRuntime',
    localRuntime: {
      version: 'v2',
      ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:image:z-image-turbo' },
    },
  },
};

test('runNimiRuntimeImageGeneration submits an image scenario job and returns image artifacts', async () => {
  const submitted: any[] = [];
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
      throw new Error('terminal event should avoid polling');
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
      routePolicy: 'local',
      targetRef,
    },
    prompt: 'Song dynasty scholar portrait',
    negativePrompt: 'low quality',
    size: '1024x1024',
    seed: 42,
    responseFormat: 'b64_json',
    requestId: 'request-image-1',
    idempotencyKey: 'idem-image-1',
    labels: { gateway: 'openai-compatible' },
  });

  assert.equal(result.job.jobId, 'job-image-1');
  assert.equal(result.traceId, 'trace-artifacts-1');
  assert.deepEqual(result.artifacts, [artifact]);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].request.scenarioType, ScenarioType.IMAGE_GENERATE);
  assert.equal(submitted[0].request.executionMode, ExecutionMode.ASYNC_JOB);
  assert.equal(submitted[0].request.head.appId, 'nimi.local-gateway.openai-compatible');
  assert.equal(submitted[0].request.head.fallback, FallbackPolicy.DENY);
  assert.deepEqual(submitted[0].request.head.targetRef, targetRef);
  assert.equal(submitted[0].request.spec.spec.oneofKind, 'imageGenerate');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.prompt, 'Song dynasty scholar portrait');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.negativePrompt, 'low quality');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.size, '1024x1024');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.n, 1);
  assert.equal(submitted[0].request.spec.spec.imageGenerate.seed, '42');
  assert.equal(submitted[0].request.spec.spec.imageGenerate.responseFormat, 'b64_json');
  assert.equal(submitted[0].request.labels.gateway, 'openai-compatible');
  assert.equal(submitted[0].options.metadata['x-nimi-idempotency-key'], 'idem-image-1');
});
