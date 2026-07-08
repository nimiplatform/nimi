import { runNimiRuntimeScenarioJob, type NimiRuntimeScenarioJob, type NimiRuntimeScenarioJobClient, type NimiRuntimeScenarioArtifact } from '@nimiplatform/sdk/runtime';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  type ScenarioJobEvent,
} from '@nimiplatform/sdk/runtime/wire-types';

export type TesterRuntimeMediaGenerationRunnerProjection = {
  finalStatus: string;
  updateStatuses: string[];
  artifactCount: number;
  subscribedJobId: string;
  fallbackPollCount: number;
};

function makeJob(status: ScenarioJobStatus, jobId = 'tester-media-job'): NimiRuntimeScenarioJob {
  return {
    jobId,
    scenarioType: ScenarioType.IMAGE_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: 0,
    modelResolved: 'tester-image-model',
    status,
    providerJobId: '',
    reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'tester-media-trace',
    ignoredExtensions: [],
    progressPercent: status === ScenarioJobStatus.RUNNING ? 50 : 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
}

export async function inspectTesterRuntimeMediaGenerationRunnerProjection(): Promise<TesterRuntimeMediaGenerationRunnerProjection> {
  const updateStatuses: string[] = [];
  let subscribedJobId = '';
  let fallbackPollCount = 0;
  const artifact: NimiRuntimeScenarioArtifact = {
    artifactId: 'tester-media-artifact',
    mimeType: 'image/png',
  } as NimiRuntimeScenarioArtifact;
  const ai: NimiRuntimeScenarioJobClient = {
    async submitScenarioJob() {
      return { job: makeJob(ScenarioJobStatus.SUBMITTED) };
    },
    async *subscribeScenarioJobEvents(input) {
      const jobId = input.jobId;
      subscribedJobId = jobId;
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
        sequence: '1',
        traceId: 'tester-media-trace',
        job: makeJob(ScenarioJobStatus.RUNNING, jobId),
      } as ScenarioJobEvent;
    },
    async getScenarioJob(input) {
      fallbackPollCount += 1;
      return { job: makeJob(ScenarioJobStatus.COMPLETED, input.jobId) };
    },
    async cancelScenarioJob(input) {
      return { job: makeJob(ScenarioJobStatus.CANCELED, input.jobId) };
    },
    async getScenarioArtifacts(input) {
      return {
        jobId: input.jobId,
        artifacts: [artifact],
        traceId: 'tester-media-trace',
      };
    },
  };

  const result = await runNimiRuntimeScenarioJob({
    ai,
    request: {
      scenarioType: ScenarioType.IMAGE_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      requestId: 'tester-media-request',
      idempotencyKey: 'tester-media-idem',
      labels: {},
      extensions: [],
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
