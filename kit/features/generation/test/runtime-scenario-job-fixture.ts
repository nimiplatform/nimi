import {
  ExecutionMode,
  RuntimeReasonCode,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';

type ScenarioJobFixtureInput = Pick<ScenarioJob, 'jobId' | 'scenarioType' | 'status'>
  & Partial<Omit<ScenarioJob, 'jobId' | 'scenarioType' | 'status'>>;

export function createScenarioJobFixture(input: ScenarioJobFixtureInput): ScenarioJob {
  const { jobId, scenarioType, status, ...overrides } = input;
  return {
    jobId,
    scenarioType,
    status,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: 0,
    modelResolved: '',
    providerJobId: '',
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: '',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
    ...overrides,
  };
}
