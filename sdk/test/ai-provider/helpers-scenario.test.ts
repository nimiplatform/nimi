import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeScenarioJob,
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
import { textEmbedOutput } from '../helpers/runtime-ai-shapes.js';

const DEFAULTS: RuntimeDefaults = {
  appId: 'nimi.ai.provider.helpers-scenario.test',
  routePolicy: 'cloud',
  timeoutMs: 1000,
};

function createScenarioRuntime(input: {
  getScenarioJob: () => Promise<{ job?: Record<string, unknown> }>;
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
      getScenarioArtifacts: async () => ({
        artifacts: [],
        traceId: 'trace-scenario-test',
      }),
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
