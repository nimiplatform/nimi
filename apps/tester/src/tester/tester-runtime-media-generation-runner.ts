import {
  runRuntimeMediaGenerationJob,
  ScenarioJobEventType,
  ScenarioJobStatus,
  type RuntimeMediaGenerationJob,
  type RuntimeMediaGenerationJobsModule,
  type RuntimeMediaScenarioArtifact,
  type ScenarioJobEvent,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeMediaGenerationRunnerProjection = {
  finalStatus: string;
  updateStatuses: string[];
  artifactCount: number;
  subscribedJobId: string;
  fallbackPollCount: number;
};

function makeJob(status: ScenarioJobStatus, jobId = 'tester-media-job'): RuntimeMediaGenerationJob {
  return { jobId, status } as RuntimeMediaGenerationJob;
}

export async function inspectTesterRuntimeMediaGenerationRunnerProjection(): Promise<TesterRuntimeMediaGenerationRunnerProjection> {
  const updateStatuses: string[] = [];
  let subscribedJobId = '';
  let fallbackPollCount = 0;
  const artifact: RuntimeMediaScenarioArtifact = {
    artifactId: 'tester-media-artifact',
    mimeType: 'image/png',
  } as RuntimeMediaScenarioArtifact;
  const jobs: RuntimeMediaGenerationJobsModule = {
    async submit() {
      return makeJob(ScenarioJobStatus.SUBMITTED);
    },
    async subscribe(jobId) {
      subscribedJobId = jobId;
      return (async function* stream(): AsyncIterable<ScenarioJobEvent> {
        yield {
          eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
          sequence: '1',
          traceId: 'tester-media-trace',
          job: makeJob(ScenarioJobStatus.RUNNING, jobId),
        } as ScenarioJobEvent;
      })();
    },
    async get(jobId) {
      fallbackPollCount += 1;
      return makeJob(ScenarioJobStatus.COMPLETED, jobId);
    },
    async cancel(input) {
      return makeJob(ScenarioJobStatus.CANCELED, input.jobId);
    },
    async getArtifacts() {
      return { artifacts: [artifact] };
    },
  };

  const result = await runRuntimeMediaGenerationJob({
    jobs,
    request: {
      modal: 'image',
      input: {
        model: 'tester-image-model',
        prompt: 'tester media generation runner',
      },
    },
    onJobUpdate: (job) => {
      updateStatuses.push(ScenarioJobStatus[job.status] || String(job.status));
    },
  });

  return {
    finalStatus: ScenarioJobStatus[result.job.status] || String(result.job.status),
    updateStatuses,
    artifactCount: result.artifacts.length,
    subscribedJobId,
    fallbackPollCount,
  };
}
