import { useCallback, useState } from 'react';
import {
  getPlatformClient,
  runRuntimeMediaGenerationJob,
  ScenarioJobStatus,
  type Runtime,
  type RuntimeMediaGenerationJob,
  type RuntimeMediaGenerationJobResult,
  type RuntimeMediaGenerationSubmitRequest,
  type RuntimeMediaScenarioArtifact,
} from '@nimiplatform/kit/core/sdk-contract';
import { useGenerationPanel, type UseGenerationPanelResult } from './hooks/use-generation-panel.js';
import type { GenerationRunItem } from './types.js';
export type RuntimeGenerationSubmitRequest = RuntimeMediaGenerationSubmitRequest;
export type RuntimeScenarioJob = RuntimeMediaGenerationJob;
export type RuntimeScenarioArtifact = RuntimeMediaScenarioArtifact;
export type RuntimeGenerationMappedStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'canceled';

export type RuntimeGenerationJobResult = RuntimeMediaGenerationJobResult;

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
      progressValue: job.status === ScenarioJobStatus.RUNNING && typeof job.progressPercent === 'number'
        ? job.progressPercent
        : undefined,
      progressLabel: job.status === ScenarioJobStatus.RUNNING && typeof job.progressPercent === 'number'
        ? `${Math.round(job.progressPercent)}%`
        : scenarioJobStatusLabel(job.status),
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
          result = await runRuntimeMediaGenerationJob({
            jobs: resolvedRuntime.media.jobs,
            request,
            onJobUpdate: (job) => {
              latestJob = job;
              upsertStatusItem(job);
              onJobUpdate?.({ input: nextInput, job });
            },
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
