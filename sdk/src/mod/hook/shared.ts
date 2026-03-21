import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import {
  resolveModRuntimeContext,
} from '../internal/runtime-access.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';

export function normalizeHookModId(modId: string): string {
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) {
    throw createNimiError({
      message: 'hook client mod id is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_non_empty_mod_id',
      source: 'sdk',
    });
  }
  return normalizedModId;
}

export function getHookRuntimes(input?: ModRuntimeContextInput) {
  return resolveModRuntimeContext(input);
}
