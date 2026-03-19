import { withRealmContextLock } from '@nimiplatform/sdk';
import type { Realm } from '@nimiplatform/sdk/realm';
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

export async function withRuntimeOpenApiContext<T>(task: (realm: Realm) => Promise<T>): Promise<T> {
  return withRealmContextLock(getRuntimeHttpContext(), task);
}
