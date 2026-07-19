import { vi } from 'vitest';

export type RuntimeScopeRunnerFixture = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export function createRuntimeScopeRunnerFixture(metadata: Record<string, string>) {
  const callSpy = vi.fn<(scopes: readonly string[]) => void>();
  const runner: RuntimeScopeRunnerFixture = async <T>(
    scopes: readonly string[],
    operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
  ): Promise<T> => {
    callSpy(scopes);
    return operation({ metadata });
  };
  return { runner, callSpy };
}
