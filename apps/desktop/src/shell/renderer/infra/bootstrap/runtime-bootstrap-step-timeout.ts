import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { safeErrorMessage } from './runtime-bootstrap-utils';

export const NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS = 5_000;

function createBootstrapStepTimeoutError(step: string, timeoutMs: number): Error {
  return new Error(`${step} timed out after ${timeoutMs}ms`);
}

export async function withBootstrapStepTimeout<T>(
  step: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createBootstrapStepTimeoutError(step, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function startNonCriticalBootstrapStep(input: {
  flowId: string;
  step: string;
  task: Promise<unknown>;
  timeoutMs?: number;
}): void {
  void withBootstrapStepTimeout(
    input.step,
    input.task,
    input.timeoutMs ?? NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  ).catch((error) => {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:non-critical-step-deferred',
      flowId: input.flowId,
      details: {
        step: input.step,
        error: safeErrorMessage(error),
      },
    });
  });
}
