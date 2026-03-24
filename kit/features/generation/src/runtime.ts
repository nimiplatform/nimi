import { getPlatformClient } from '@nimiplatform/sdk';
import { useCallback, useState } from 'react';
import { ScenarioJobStatus, type Runtime } from '@nimiplatform/sdk/runtime';
import { useGenerationPanel, type UseGenerationPanelResult } from './hooks/use-generation-panel.js';
import type { GenerationRunItem } from './types.js';
export type RuntimeGenerationSubmitRequest = Parameters<Runtime['media']['jobs']['submit']>[0];
export type RuntimeScenarioJob = Awaited<ReturnType<Runtime['media']['jobs']['submit']>>;
export type RuntimeScenarioArtifact = Awaited<ReturnType<Runtime['media']['jobs']['getArtifacts']>>['artifacts'][number];
export type RuntimeGenerationMappedStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'canceled';

export type RuntimeGenerationJobResult = {
  job: RuntimeScenarioJob;
  artifacts: RuntimeScenarioArtifact[];
};

export type RuntimeGenerationRequestContext<TInput> = {
  input: TInput;
};

export type RuntimeGenerationPanelStatusContext<TInput> = {
  input: TInput;
  job: RuntimeScenarioJob;
};

export type RuntimeGenerationPanelErrorContext<TInput> = {
  input: TInput;
  job: RuntimeScenarioJob | null;
  result: RuntimeGenerationJobResult | null;
};

export type UseRuntimeGenerationPanelOptions<TInput> = {
  runtime?: Runtime;
  input: TInput;
  resolveRequest: (
    context: RuntimeGenerationRequestContext<TInput>,
  ) => RuntimeGenerationSubmitRequest;
  disabled?: boolean;
  submitting?: boolean;
  triggerEventName?: string;
  canTriggerShortcut?: boolean;
  maxStatusItems?: number;
  getStatusLabel?: (
    context: RuntimeGenerationPanelStatusContext<TInput>,
  ) => string;
  onJobUpdate?: (
    context: RuntimeGenerationPanelStatusContext<TInput>,
  ) => void;
  onCompleted?: (
    result: RuntimeGenerationJobResult,
    context: RuntimeGenerationRequestContext<TInput>,
  ) => Promise<void> | void;
  onError?: (
    error: unknown,
    context: RuntimeGenerationPanelErrorContext<TInput>,
  ) => void;
};

export type UseRuntimeGenerationPanelResult = {
  state: UseGenerationPanelResult;
  statusItems: readonly GenerationRunItem[];
  latestResult: RuntimeGenerationJobResult | null;
  clearStatusItems: () => void;
};

export function scenarioJobStatusToGenerationStatus(status: ScenarioJobStatus): RuntimeGenerationMappedStatus {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
    case ScenarioJobStatus.QUEUED:
      return 'pending';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'completed';
    case ScenarioJobStatus.TIMEOUT:
      return 'timeout';
    case ScenarioJobStatus.CANCELED:
      return 'canceled';
    case ScenarioJobStatus.FAILED:
    default:
      return 'failed';
  }
}

export function scenarioJobStatusLabel(status: ScenarioJobStatus): string {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'Submitted to runtime';
    case ScenarioJobStatus.QUEUED:
      return 'Queued by runtime';
    case ScenarioJobStatus.RUNNING:
      return 'Generating output';
    case ScenarioJobStatus.COMPLETED:
      return 'Completed';
    case ScenarioJobStatus.TIMEOUT:
      return 'Timed out';
    case ScenarioJobStatus.CANCELED:
      return 'Canceled';
    case ScenarioJobStatus.FAILED:
    default:
      return 'Failed';
  }
}

export async function submitRuntimeGenerationJobAndWait(
  runtime: Runtime,
  request: RuntimeGenerationSubmitRequest,
  onUpdate: (job: RuntimeScenarioJob) => void,
): Promise<RuntimeGenerationJobResult> {
  const submitted = await runtime.media.jobs.submit(request);
  onUpdate(submitted);

  const events = await runtime.media.jobs.subscribe(submitted.jobId);
  let terminalJob = submitted;
  for await (const event of events) {
    if (!event.job) {
      continue;
    }
    terminalJob = event.job;
    onUpdate(event.job);
    if (isTerminalScenarioJobStatus(event.job.status)) {
      break;
    }
  }

  if (!isTerminalScenarioJobStatus(terminalJob.status)) {
    terminalJob = await runtime.media.jobs.get(submitted.jobId);
    onUpdate(terminalJob);
  }

  const artifacts = await runtime.media.jobs.getArtifacts(submitted.jobId);
  return {
    job: terminalJob,
    artifacts: artifacts.artifacts,
  };
}

export async function submitPlatformGenerationJobAndWait(
  request: RuntimeGenerationSubmitRequest,
  onUpdate: (job: RuntimeScenarioJob) => void,
): Promise<RuntimeGenerationJobResult> {
  return submitRuntimeGenerationJobAndWait(getPlatformClient().runtime, request, onUpdate);
}

export function useRuntimeGenerationPanel<TInput>({
  runtime,
  input,
  resolveRequest,
  disabled = false,
  submitting = false,
  triggerEventName,
  canTriggerShortcut = true,
  maxStatusItems = 6,
  getStatusLabel = ({ job }) => scenarioJobStatusLabel(job.status),
  onJobUpdate,
  onCompleted,
  onError,
}: UseRuntimeGenerationPanelOptions<TInput>): UseRuntimeGenerationPanelResult {
  const [statusItems, setStatusItems] = useState<readonly GenerationRunItem[]>([]);
  const [latestResult, setLatestResult] = useState<RuntimeGenerationJobResult | null>(null);

  const clearStatusItems = useCallback(() => {
    setStatusItems([]);
  }, []);

  const upsertStatusItem = useCallback((job: RuntimeScenarioJob) => {
    const nextItem: GenerationRunItem = {
      runId: job.jobId,
      status: scenarioJobStatusToGenerationStatus(job.status),
      label: getStatusLabel({ input, job }),
      error: job.reasonDetail || undefined,
      progressValue: job.status === ScenarioJobStatus.RUNNING ? 50 : undefined,
      progressLabel: scenarioJobStatusLabel(job.status),
    };

    setStatusItems((current) => {
      const withoutCurrent = current.filter((item) => item.runId !== job.jobId);
      return [nextItem, ...withoutCurrent].slice(0, maxStatusItems);
    });
  }, [getStatusLabel, input, maxStatusItems]);

  const state = useGenerationPanel({
    adapter: {
      submit: async (nextInput: TInput) => {
        const requestContext = { input: nextInput };
        const resolvedRuntime = runtime ?? getPlatformClient().runtime;
        const request = resolveRequest(requestContext);
        let latestJob: RuntimeScenarioJob | null = null;
        let result: RuntimeGenerationJobResult | null = null;

        try {
          result = await submitRuntimeGenerationJobAndWait(resolvedRuntime, request, (job) => {
            latestJob = job;
            upsertStatusItem(job);
            onJobUpdate?.({ input: nextInput, job });
          });
          setLatestResult(result);
          await onCompleted?.(result, requestContext);
        } catch (error) {
          onError?.(error, {
            input: nextInput,
            job: latestJob,
            result,
          });
          throw error;
        }
      },
    },
    input,
    disabled,
    submitting,
    triggerEventName,
    canTriggerShortcut,
  });

  return {
    state,
    statusItems,
    latestResult,
    clearStatusItems,
  };
}

export function copyArtifactBytesToArrayBuffer(bytes: Uint8Array | undefined): ArrayBuffer | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isTerminalScenarioJobStatus(status: ScenarioJobStatus): boolean {
  return status === ScenarioJobStatus.COMPLETED
    || status === ScenarioJobStatus.FAILED
    || status === ScenarioJobStatus.CANCELED
    || status === ScenarioJobStatus.TIMEOUT;
}
