import assert from 'node:assert/strict';
import test from 'node:test';
import { observeNimiRuntimeScenarioJob, type NimiRuntimeScenarioJobClient } from './scenario-jobs.js';
import { ExecutionMode, ScenarioJobStatus, ScenarioType, ReasonCode as RuntimeReasonCode, type ScenarioJob, type SubmitScenarioJobRequest } from './generated.js';

test('explicit observation retrieves a completed Job without submission or replay', async () => {
  let submissions = 0;
  let subscriptions = 0;
  const request = { scenarioType: ScenarioType.MUSIC_GENERATE, executionMode: ExecutionMode.ASYNC_JOB, extensions: [], labels: {}, requestId: 'original', idempotencyKey: 'original' } as SubmitScenarioJobRequest;
  const job = { jobId: 'retained-music', scenarioType: ScenarioType.MUSIC_GENERATE, status: ScenarioJobStatus.COMPLETED, artifacts: [], traceId: 'trace' } as unknown as ScenarioJob;
  const ai = {
    submitScenarioJob: async () => { submissions += 1; throw new Error('must not resubmit'); },
    getScenarioJob: async () => ({ job }),
    subscribeScenarioJobEvents: () => { subscriptions += 1; throw new Error('completed Job needs no subscription'); },
    getScenarioArtifacts: async () => ({ jobId: job.jobId, artifacts: [], traceId: job.traceId }),
  } as unknown as NimiRuntimeScenarioJobClient;
  const result = await observeNimiRuntimeScenarioJob({ ai, scenarioType: request.scenarioType, jobId: job.jobId });
  assert.equal(result.job.jobId, job.jobId);
  assert.equal(submissions, 0);
  assert.equal(subscriptions, 0);
  await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: request.scenarioType, jobId: 'different' }));
  await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: ScenarioType.VOICE_CREATE, jobId: job.jobId }));
});

test('terminal non-success retains the issued Job ID for later owner-scoped queries', async () => {
  for (const status of [ScenarioJobStatus.FAILED, ScenarioJobStatus.CANCELED, ScenarioJobStatus.TIMEOUT]) {
    const job = { jobId: 'issued-audio-job', scenarioType: ScenarioType.SPEECH_SYNTHESIZE, status,
      reasonCode: RuntimeReasonCode.AI_LOCAL_EXECUTION_INFERENCE_FAILED, reasonDetail: 'terminal failure', artifacts: [], traceId: 'trace' } as unknown as ScenarioJob;
    const ai = { getScenarioJob: async () => ({ job }), getScenarioArtifacts: async () => { throw new Error('non-success must not read artifacts'); } } as unknown as NimiRuntimeScenarioJobClient;
    await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: job.scenarioType, jobId: job.jobId }), (error: unknown) => {
      assert.equal((error as { details?: { jobId?: string } }).details?.jobId, job.jobId);
      return true;
    });
  }
});
