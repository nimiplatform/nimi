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
): Promise<void> {
  try {
    await probe.probe();
  } catch (error) {
    throw new DesktopSourceRuntimeUnavailableError(error);
  }
}

export function sourceRuntimeBootstrapFailureMessage(failureCode: string): string {
  return `Source Runtime connection failed (${failureCode}). Start ${SOURCE_RUNTIME_START_COMMAND} first, then restart Desktop.`;
}

function runtimeFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'runtime-service-error-unclassified';
  for (const key of ['reasonCode', 'code', 'message'] as const) {
    const value = (error as Readonly<Record<string, unknown>>)[key];
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) {
      return value;
    }
  }
  return 'runtime-service-error-unclassified';
}
