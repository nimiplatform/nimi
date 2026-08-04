import { useCallback } from 'react';
import {
  ScenarioJobStatus,
  type NimiRuntimeScenarioJobResult,
} from '@nimiplatform/kit/core/sdk-contract';
import { useGenerationPanel, type UseGenerationPanelResult } from './hooks/use-generation-panel.js';
import type { GenerationRunItem } from './types.js';
import { createRuntimeExecutionUnavailableError } from './runtime-diagnostics.js';

export * from './runtime-ai-consume.js';
export * from './runtime-image-generate.js';
export * from './runtime-identity.js';
export * from './runtime-speech-synthesize.js';
export * from './runtime-speech-transcribe.js';
export * from './runtime-video-generate.js';
export * from './runtime-voice-catalog.js';
export {
  createRuntimeExecutionUnavailableError,
  describeRuntimeGenerationError,
  runtimeUnavailableReasonFromError,
} from './runtime-diagnostics.js';
export type {
  RuntimeExecutionUnavailable,
  RuntimeGenerationUnavailableReason,
} from './runtime-diagnostics.js';

export type RuntimeGenerationMappedStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'canceled';

export type RuntimeGenerationRequestContext<TInput> = {
  readonly input: TInput;
  readonly capabilityContract: string;
};

export type RuntimeGenerationPanelErrorContext<TInput> =
  RuntimeGenerationRequestContext<TInput> & {
    readonly job: null;
    readonly result: null;
  };

export type UseRuntimeGenerationPanelOptions<TInput> = {
  readonly capabilityContract: string;
  readonly input: TInput;
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly triggerEventName?: string;
  readonly canTriggerShortcut?: boolean;
  readonly onError?: (
    error: unknown,
    context: RuntimeGenerationPanelErrorContext<TInput>,
  ) => void;
};

export type UseRuntimeGenerationPanelResult = {
  readonly state: UseGenerationPanelResult;
  readonly statusItems: readonly GenerationRunItem[];
  readonly latestResult: NimiRuntimeScenarioJobResult | null;
  readonly clearStatusItems: () => void;
};

const NO_RUNTIME_STATUS_ITEMS: readonly GenerationRunItem[] = Object.freeze([]);

export function scenarioJobStatusToGenerationStatus(
  status: ScenarioJobStatus,
): RuntimeGenerationMappedStatus {
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
      return 'Submitted to Runtime';
    case ScenarioJobStatus.QUEUED:
      return 'Queued by Runtime';
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

/**
 * Keeps the shared panel contract available without exposing the legacy raw
 * Scenario request seam. Submission fails closed until Runtime admits an
 * owner-driven request that carries no caller execution truth.
 */
export function useRuntimeGenerationPanel<TInput>({
  capabilityContract,
  input,
  disabled = false,
  submitting = false,
  triggerEventName,
  canTriggerShortcut = true,
  onError,
}: UseRuntimeGenerationPanelOptions<TInput>): UseRuntimeGenerationPanelResult {
  const clearStatusItems = useCallback(() => {}, []);
  const state = useGenerationPanel({
    adapter: {
      submit: async () => {
        throw createRuntimeExecutionUnavailableError(capabilityContract);
      },
    },
    input,
    disabled,
    submitting,
    triggerEventName,
    canTriggerShortcut,
    onError: (error) => onError?.(error, {
      input,
      capabilityContract,
      job: null,
      result: null,
    }),
  });

  return {
    state,
    statusItems: NO_RUNTIME_STATUS_ITEMS,
    latestResult: null,
    clearStatusItems,
  };
}

export function copyArtifactBytesToArrayBuffer(
  bytes: Uint8Array | undefined,
): ArrayBuffer | null {
  if (!bytes?.byteLength) {
    return null;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
