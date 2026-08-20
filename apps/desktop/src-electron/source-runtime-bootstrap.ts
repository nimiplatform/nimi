import {
  retrySourceRuntimeTransport,
  sourceRuntimeFailureReason,
  type SourceRuntimeRetryOptions,
} from '../src/shell/shared/source-runtime-retry.js';

export const SOURCE_RUNTIME_START_COMMAND = 'pnpm dev:runtime';

export type DesktopSourceRuntimeStatusProbe = {
  readonly probe: () => Promise<unknown>;
};

export class DesktopSourceRuntimeUnavailableError extends Error {
  readonly reasonCode = 'source-local-development-runtime-unavailable';
  readonly actionHint = 'run_pnpm_dev_runtime';
  readonly runtimeReasonCode: string;

  constructor(cause: unknown) {
    super('source-local-development-runtime-unavailable', { cause });
    this.name = 'DesktopSourceRuntimeUnavailableError';
    this.runtimeReasonCode = runtimeFailureReason(cause);
  }
}

export async function requireDesktopSourceRuntime(
  probe: DesktopSourceRuntimeStatusProbe,
  retryOptions: SourceRuntimeRetryOptions = {},
): Promise<void> {
  try {
    await retrySourceRuntimeTransport(() => probe.probe(), retryOptions);
  } catch (error) {
    throw new DesktopSourceRuntimeUnavailableError(error);
  }
}

export function sourceRuntimeBootstrapFailureMessage(failureCode: string): string {
  return `Source Runtime connection failed (${failureCode}). Start ${SOURCE_RUNTIME_START_COMMAND} first, then restart Desktop.`;
}

function runtimeFailureReason(error: unknown): string {
  return sourceRuntimeFailureReason(error);
}
