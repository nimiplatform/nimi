import {
  getHookRuntimeFacade,
  getRuntimeHost,
} from '../internal/runtime-access';

export function normalizeHookModId(modId: string): string {
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) {
    throw new Error('HOOK_CLIENT_MOD_ID_REQUIRED');
  }
  return normalizedModId;
}

export function getHookRuntimes() {
  return {
    runtimeHost: getRuntimeHost(),
    runtime: getHookRuntimeFacade(),
  };
}
