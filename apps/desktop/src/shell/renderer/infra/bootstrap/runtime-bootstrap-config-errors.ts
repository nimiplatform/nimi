export const RUNTIME_CONFIG_MANUAL_RESTART_REQUIRED = 'RUNTIME_CONFIG_MANUAL_RESTART_REQUIRED';

export function createRuntimeConfigManualRestartRequiredError(message: string): Error {
  const error = new Error(message);
  error.name = 'RuntimeConfigManualRestartRequiredError';
  (error as Error & { code: string }).code = RUNTIME_CONFIG_MANUAL_RESTART_REQUIRED;
  return error;
}

export function isRuntimeConfigManualRestartRequiredError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === RUNTIME_CONFIG_MANUAL_RESTART_REQUIRED,
  );
}
