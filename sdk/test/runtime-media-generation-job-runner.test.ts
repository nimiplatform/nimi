import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runRuntimeAiScenarioJob,
  runRuntimeMediaGenerationJob,
  ScenarioJobStatus,
  type RuntimeAiScenarioJobsModule,
  type RuntimeMediaGenerationJob,
  type RuntimeMediaGenerationJobsModule,
  type RuntimeMediaScenarioArtifact,
} from '../src/runtime/index.js';

function makeJob(status: ScenarioJobStatus, jobId = 'job-1'): RuntimeMediaGenerationJob {
  return { jobId, status } as RuntimeMediaGenerationJob;
}

function makeJobs(options: {
  submitJob?: RuntimeMediaGenerationJob;
  subscribeEvents?: Array<{ job?: RuntimeMediaGenerationJob }>;
  getJob?: RuntimeMediaGenerationJob;
  artifacts?: RuntimeMediaScenarioArtifact[];
}) {
  const calls = {
    submit: 0,
    subscribe: [] as string[],
    get: [] as string[],
    getArtifacts: [] as string[],
    cancel: [] as Array<{ jobId: string; reason?: string }>,
  };
  const jobs: RuntimeMediaGenerationJobsModule = {
    async submit() {
      calls.submit += 1;
      return options.submitJob ?? makeJob(ScenarioJobStatus.SUBMITTED);
    },
    async subscribe(jobId) {
      calls.subscribe.push(jobId);
      return (async function* stream() {
        for (const event of options.subscribeEvents ?? []) {
          yield event;
        }
      })();
    },
    async get(jobId) {
      calls.get.push(jobId);
      return options.getJob ?? makeJob(ScenarioJobStatus.COMPLETED, jobId);
    },
    async cancel(input) {
      calls.cancel.push(input);
      return makeJob(ScenarioJobStatus.CANCELED, input.jobId);
    },
    async getArtifacts(jobId) {
      calls.getArtifacts.push(jobId);
      return { artifacts: options.artifacts ?? [] };
    },
  };
  return { jobs, calls };
}

function makeAiJobs(options: {
  submitJob?: RuntimeMediaGenerationJob;
  getJobs?: RuntimeMediaGenerationJob[];
  artifacts?: RuntimeMediaScenarioArtifact[];
}) {
  const calls = {
    submit: 0,
    get: [] as string[],
    getArtifacts: [] as string[],
    cancel: [] as Array<{ jobId: string; reason?: string }>,
  };
  const queue = [...(options.getJobs ?? [makeJob(ScenarioJobStatus.COMPLETED)])];
  const ai: RuntimeAiScenarioJobsModule = {
    async submitScenarioJob() {
      calls.submit += 1;
      return { job: options.submitJob ?? makeJob(ScenarioJobStatus.SUBMITTED) };
    },
    async getScenarioJob(request) {
      calls.get.push(request.jobId);
      return { job: queue.shift() ?? makeJob(ScenarioJobStatus.COMPLETED, request.jobId) };
    },
    async cancelScenarioJob(request) {
      calls.cancel.push(request);
      return { job: makeJob(ScenarioJobStatus.CANCELED, request.jobId) };
    },
    async getScenarioArtifacts(request) {
      calls.getArtifacts.push(request.jobId);
      return {
        artifacts: options.artifacts ?? [],
        traceId: 'trace-ai',
      };
    },
  };
  return { ai, calls };
}

test('Runtime media generation runner submits, streams, and resolves artifacts after completion', async () => {
  const completedJob = makeJob(ScenarioJobStatus.COMPLETED);
  const artifact = { artifactId: 'artifact-1' } as RuntimeMediaScenarioArtifact;
  const harness = makeJobs({
    subscribeEvents: [{ job: makeJob(ScenarioJobStatus.RUNNING) }, { job: completedJob }],
    artifacts: [artifact],
  });
  const updates: RuntimeMediaGenerationJob[] = [];

  const result = await runRuntimeMediaGenerationJob({
    jobs: harness.jobs,
    request: { modal: 'music', input: { model: 'music-model', prompt: 'test' } },
    onJobUpdate: (job) => updates.push(job),
  });

  assert.equal(harness.calls.submit, 1);
  assert.deepEqual(harness.calls.subscribe, ['job-1']);
  assert.deepEqual(harness.calls.getArtifacts, ['job-1']);
  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
  assert.deepEqual(result.artifacts, [artifact]);
  assert.equal(updates.length, 3);
});

test('Runtime media generation runner polls when the stream ends before terminal state', async () => {
  const harness = makeJobs({
    subscribeEvents: [{ job: makeJob(ScenarioJobStatus.RUNNING) }],
    getJob: makeJob(ScenarioJobStatus.COMPLETED),
  });

  const result = await runRuntimeMediaGenerationJob({
    jobs: harness.jobs,
    request: { modal: 'music', input: { model: 'music-model', prompt: 'test' } },
  });

  assert.deepEqual(harness.calls.get, ['job-1']);
  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
});

test('Runtime media generation runner fails closed on terminal Runtime failure', async () => {
  const harness = makeJobs({
    subscribeEvents: [{
      job: {
        ...makeJob(ScenarioJobStatus.FAILED),
        reasonCode: 'AI_PROVIDER_UNAVAILABLE' as never,
        reasonDetail: 'provider unavailable',
      },
    }],
  });

  await assert.rejects(
    () => runRuntimeMediaGenerationJob({
      jobs: harness.jobs,
      request: { modal: 'music', input: { model: 'music-model', prompt: 'test' } },
    }),
    /provider unavailable/,
  );
  assert.deepEqual(harness.calls.getArtifacts, []);
});

test('Runtime AI scenario job runner polls and resolves artifacts after Runtime completion', async () => {
  const artifact = { artifactId: 'artifact-ai' } as RuntimeMediaScenarioArtifact;
  const harness = makeAiJobs({
    getJobs: [
      makeJob(ScenarioJobStatus.RUNNING),
      { ...makeJob(ScenarioJobStatus.COMPLETED), traceId: 'trace-job' } as RuntimeMediaGenerationJob,
    ],
    artifacts: [artifact],
  });
  const updates: RuntimeMediaGenerationJob[] = [];

  const result = await runRuntimeAiScenarioJob({
    ai: harness.ai,
    request: { input: { text: 'scenario' } },
    pollDelayMs: () => 0,
    onJobUpdate: (job) => updates.push(job),
  });

  assert.equal(harness.calls.submit, 1);
  assert.deepEqual(harness.calls.get, ['job-1', 'job-1']);
  assert.deepEqual(harness.calls.getArtifacts, ['job-1']);
  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
  assert.deepEqual(result.artifacts, [artifact]);
  assert.equal(result.traceId, 'trace-ai');
  assert.equal(updates.length, 3);
});

test('Runtime AI scenario job runner cancels the same Runtime job on caller abort', async () => {
  const controller = new AbortController();
  controller.abort();
  const harness = makeAiJobs({
    getJobs: [makeJob(ScenarioJobStatus.RUNNING)],
  });

  await assert.rejects(
    () => runRuntimeAiScenarioJob({
      ai: harness.ai,
      request: { input: { text: 'scenario' } },
      signal: controller.signal,
      pollDelayMs: () => 0,
    }),
    /aborted/,
  );

  assert.equal(harness.calls.submit, 1);
  assert.deepEqual(harness.calls.get, []);
  assert.deepEqual(harness.calls.cancel, [{ jobId: 'job-1', reason: 'aborted_by_abort_signal' }]);
  assert.deepEqual(harness.calls.getArtifacts, []);
});
