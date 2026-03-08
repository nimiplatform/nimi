import type { HookAuditClient, HookMetaClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';

export function createAuditClient(input: {
  runtime: RuntimeHookRuntimeFacade;
}): HookAuditClient {
  return {
    query: (filter) => input.runtime.getAudit(filter),
    stats: (modId) => input.runtime.getAuditStats(modId),
  };
}

export function createMetaClient(input: {
  runtime: RuntimeHookRuntimeFacade;
}): HookMetaClient {
  return {
    listRegistrations: (modId) => input.runtime.listRegistrations(modId),
    listCapabilities: (modId) => input.runtime.listModCapabilities(modId),
    getPermissions: (modId) => input.runtime.getPermissionDeclaration(modId),
  };
}
