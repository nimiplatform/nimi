import type { HookAuditClient, HookMetaClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';

function assertOwnModId(currentModId: string, requestedModId?: string): string {
  const normalizedCurrent = String(currentModId || '').trim();
  const normalizedRequested = String(requestedModId || normalizedCurrent).trim();
  if (!normalizedCurrent || normalizedRequested !== normalizedCurrent) {
    throw new Error('cross-mod metadata access is forbidden');
  }
  return normalizedCurrent;
}

export function createAuditClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookAuditClient {
  return {
    query: (filter) => input.runtime.getAudit({
      ...filter,
      modId: assertOwnModId(input.modId, filter?.modId),
    }),
    stats: (modId) => input.runtime.getAuditStats(assertOwnModId(input.modId, modId)),
  };
}

export function createMetaClient(input: {
  modId: string;
  runtime: RuntimeHookRuntimeFacade;
}): HookMetaClient {
  return {
    listRegistrations: (modId) => input.runtime.listRegistrations(assertOwnModId(input.modId, modId)),
    listCapabilities: (modId) => input.runtime.listModCapabilities(assertOwnModId(input.modId, modId)),
    getPermissions: (modId) => input.runtime.getPermissionDeclaration(assertOwnModId(input.modId, modId)),
  };
}
