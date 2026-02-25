import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import {
  getRuntimeHookRuntime,
  getRuntimeHttpContext,
} from '@runtime/mod';

export type DataCapabilityHandler = (
  query: Record<string, unknown>,
) => Promise<unknown> | unknown;

export async function registerCoreDataCapability(
  capability: string,
  handler: DataCapabilityHandler,
): Promise<void> {
  await getRuntimeHookRuntime().registerDataProvider({
    modId: 'core:runtime',
    sourceType: 'core',
    capability,
    handler,
  });
}

export async function withRuntimeOpenApiContext<T>(task: () => Promise<T>): Promise<T> {
  return withOpenApiContextLock(getRuntimeHttpContext(), task);
}

