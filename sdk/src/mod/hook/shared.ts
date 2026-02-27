import {
  resolveModRuntimeContext,
} from '../internal/runtime-access';
import type { ModRuntimeContextInput } from '../types/runtime-mod';

export function normalizeHookModId(modId: string): string {
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) {
    throw new Error('HOOK_CLIENT_MOD_ID_REQUIRED');
  }
  return normalizedModId;
}

export function getHookRuntimes(input?: ModRuntimeContextInput) {
  return resolveModRuntimeContext(input);
}
