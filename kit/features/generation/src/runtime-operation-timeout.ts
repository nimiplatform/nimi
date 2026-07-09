export type RuntimeOperationTimeoutInput<T> = {
  readonly capabilityId: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly operation: (signal: AbortSignal | undefined, abortReason: string | undefined) => Promise<T>;
};

export async function withRuntimeOperationTimeout<T>(
  input: RuntimeOperationTimeoutInput<T>,
): Promise<T> {
  if (!input.timeoutMs || input.timeoutMs <= 0) {
    return input.operation(input.signal, input.abortReason);
  }

  const controller = new AbortController();
  const timeoutAbortReason = `${input.capabilityId}_runtime_client_timeout_${input.timeoutMs}ms`;
  const timeoutError = new Error(
    `${input.capabilityId} Runtime call timed out after ${input.timeoutMs}ms; the Runtime request did not complete before the configured client deadline.`,
  );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller.abort(input.abortReason || 'aborted_by_caller');

  if (input.signal?.aborted) {
    abortFromCaller();
  } else {
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(timeoutAbortReason);
        reject(timeoutError);
      }, input.timeoutMs);
    });
    return await Promise.race([
      input.operation(controller.signal, input.abortReason || timeoutAbortReason),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    input.signal?.removeEventListener('abort', abortFromCaller);
  }
}
