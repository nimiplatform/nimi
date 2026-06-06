import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectArtifacts,
  executeScenarioJob,
  selectArtifactsFromScenarioOutput,
  toEmbeddingVectors,
  toEmbeddingVectorsFromScenarioOutput,
} from '../../src/ai-provider/helpers-scenario.js';
import type { RuntimeDefaults, RuntimeForAiProvider } from '../../src/ai-provider/types.js';
import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import {
  ScenarioJobStatus,
  type RuntimeAiSubmitScenarioJobRequestInput,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { imageGenerateOutput, textEmbedOutput } from '../helpers/runtime-ai-shapes.js';

const DEFAULTS: RuntimeDefaults = {
  appId: 'nimi.ai.provider.helpers-scenario.test',
  routePolicy: 'cloud',
  timeoutMs: 1000,
};

function createScenarioRuntime(input: {
  getScenarioJob: () => Promise<{ job?: Record<string, unknown> }>;
  getScenarioArtifacts?: () => Promise<Record<string, unknown>>;
}): RuntimeForAiProvider {
  return {
    ai: {
      executeScenario: async () => {
        throw new Error('not used in test');
      },
      streamScenario: async () => {
        throw new Error('not used in test');
      },
      submitScenarioJob: async () => ({
        job: {
          jobId: 'job-1',
        },
      }),
      getScenarioJob: input.getScenarioJob,
      cancelScenarioJob: async () => ({
        canceled: true,
      }),
      subscribeScenarioJobEvents: async () => {
        throw new Error('not used in test');
      },
      getScenarioArtifacts: input.getScenarioArtifacts ?? (async () => ({
        artifacts: [],
        traceId: 'trace-scenario-test',
      })),
    },
  } as RuntimeForAiProvider;
}

test('executeScenarioJob fails closed when scenario job response is missing reasonCode', async () => {
  const runtime = createScenarioRuntime({
    getScenarioJob: async () => ({
      job: {
        status: ScenarioJobStatus.FAILED,
        reasonDetail: 'missing reason code',
      },
    }),
  });

  await assert.rejects(
    () => executeScenarioJob(
      runtime,
      DEFAULTS,
      {} as RuntimeAiSubmitScenarioJobRequestInput,
      1000,
    ),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.match(error.message, /missing reasonCode/);
      return true;
    },
  );
});

test('executeScenarioJob preserves runtime scenario reasonCode when present', async () => {
  const runtime = createScenarioRuntime({
    getScenarioJob: async () => ({
      job: {
        status: ScenarioJobStatus.TIMEOUT,
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        reasonDetail: 'provider timed out',
      },
    }),
  });

  await assert.rejects(
    () => executeScenarioJob(
      runtime,
      DEFAULTS,
      {} as RuntimeAiSubmitScenarioJobRequestInput,
      1000,
    ),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
      assert.equal(error.message, 'provider timed out');
      return true;
    },
  );
});

test('executeScenarioJob preserves structured reason details from scenario jobs', async () => {
  const runtime = createScenarioRuntime({
    getScenarioJob: async () => ({
      job: {
        status: ScenarioJobStatus.FAILED,
        reasonCode: 202,
        reasonDetail: 'provider request failed',
        traceId: 'trace-scenario-details',
        reasonMetadata: Struct.fromJson({
          provider_message: 'dial tcp 127.0.0.1:8321: connect: connection refused',
        } as never),
      },
    }),
  });

  await assert.rejects(
    () => executeScenarioJob(
      runtime,
      DEFAULTS,
      {} as RuntimeAiSubmitScenarioJobRequestInput,
      1000,
    ),
    (error: Error & { reasonCode?: string; traceId?: string; details?: Record<string, unknown> }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_PROVIDER_UNAVAILABLE);
      assert.equal(error.traceId, 'trace-scenario-details');
      assert.deepEqual(error.details, {
        provider_message: 'dial tcp 127.0.0.1:8321: connect: connection refused',
      });
      return true;
    },
  );
});

test('executeScenarioJob reports aborts with OPERATION_ABORTED', async () => {
  const runtime = createScenarioRuntime({
    getScenarioJob: async () => ({
      job: {
        status: ScenarioJobStatus.RUNNING,
      },
    }),
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => executeScenarioJob(
      runtime,
      DEFAULTS,
      {} as RuntimeAiSubmitScenarioJobRequestInput,
      1000,
      controller.signal,
    ),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.OPERATION_ABORTED);
      return true;
    },
  );
});

test('executeScenarioJob fails closed when runtime artifact metadata is incomplete', async () => {
  const runtime = createScenarioRuntime({
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-artifact-missing',
        status: ScenarioJobStatus.COMPLETED,
        traceId: 'trace-artifact-missing',
        modelResolved: 'image/default',
      },
    }),
    getScenarioArtifacts: async () => ({
      artifacts: [{
        artifactId: '',
        mimeType: 'image/png',
        bytes: Uint8Array.from([1]),
      }],
      traceId: 'trace-artifact-missing',
      output: imageGenerateOutput('image-1') as unknown as Record<string, unknown>,
    }),
  });

  await assert.rejects(
    () => executeScenarioJob(
      runtime,
      DEFAULTS,
      {} as RuntimeAiSubmitScenarioJobRequestInput,
      1000,
    ),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.match(error.message, /missing stable metadata/);
      return true;
    },
  );
});

test('collectArtifacts fails closed instead of synthesizing artifact ids', async () => {
  async function* chunks(): AsyncIterable<Record<string, unknown>> {
    yield {
      mimeType: 'image/png',
      traceId: 'trace-stream',
      modelResolved: 'image/default',
      chunk: Uint8Array.from([1]),
    };
  }

  await assert.rejects(
    () => collectArtifacts(chunks()),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.match(error.message, /missing artifactId/);
      return true;
    },
  );
});

test('collectArtifacts fails closed when stream artifact metadata remains incomplete', async () => {
  async function* chunks(): AsyncIterable<Record<string, unknown>> {
    yield {
      artifactId: 'image-stream-1',
      mimeType: 'image/png',
      chunk: Uint8Array.from([1]),
    };
  }

  await assert.rejects(
    () => collectArtifacts(chunks()),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.match(error.message, /missing stable metadata/);
      return true;
    },
  );
});

test('collectArtifacts preserves explicit runtime artifact metadata', async () => {
  async function* chunks(): AsyncIterable<Record<string, unknown>> {
    yield {
      artifactId: 'image-stream-1',
      mimeType: 'image/png',
      traceId: 'trace-stream',
      modelResolved: 'image/default',
      chunk: Uint8Array.from([1, 2]),
    };
    yield {
      artifactId: 'image-stream-1',
      chunk: Uint8Array.from([3]),
    };
  }

  const artifacts = await collectArtifacts(chunks());
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.artifactId, 'image-stream-1');
  assert.equal(artifacts[0]?.mimeType, 'image/png');
  assert.equal(artifacts[0]?.traceId, 'trace-stream');
  assert.equal(artifacts[0]?.modelResolved, 'image/default');
  assert.deepEqual([...artifacts[0]!.bytes], [1, 2, 3]);
});

test('selectArtifactsFromScenarioOutput requires typed media output artifacts', () => {
  assert.throws(
    () => selectArtifactsFromScenarioOutput({
      artifacts: [{
        artifactId: 'image-1',
        mimeType: 'image/png',
        bytes: Uint8Array.from([1]),
        traceId: 'trace-image',
        modelResolved: 'image/default',
      }],
      traceId: 'trace-image',
      modelResolved: 'image/default',
      output: undefined,
    }, 'imageGenerate'),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.match(error.message, /missing typed imageGenerate result/);
      return true;
    },
  );
});

test('toEmbeddingVectors filters non-ProtoValue entries from loose vectors', () => {
  const vectors = toEmbeddingVectors([
    {
      values: [
        { kind: { oneofKind: 'numberValue', numberValue: 1 } },
        { kind: { oneofKind: 'stringValue', stringValue: 'ignored' } },
        { kind: null },
        { nope: true },
      ],
    },
  ]);

  assert.deepEqual(vectors, [[1]]);
});

test('toEmbeddingVectorsFromScenarioOutput keeps typed scenario outputs working', () => {
  assert.deepEqual(
    toEmbeddingVectorsFromScenarioOutput(textEmbedOutput([[1, 2], [3]])),
    [[1, 2], [3]],
  );
  assert.deepEqual(toEmbeddingVectorsFromScenarioOutput(undefined), []);
});

test('ReasonCode no longer exports dead fallback policy error code', () => {
  assert.equal('SDK_RUNTIME_AI_FALLBACK_POLICY_REQUIRED' in ReasonCode, false);
});
