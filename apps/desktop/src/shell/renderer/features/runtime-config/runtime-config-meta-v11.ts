import type {
  RuntimeSectionIdV11,
} from './state/v11/types';

export const RUNTIME_SECTION_META: Record<RuntimeSectionIdV11, { name: string; description: string }> = {
  setup: {
    name: 'Model Management & Connectors',
    description: 'Global model/service lifecycle + per-mod dependency setup (no global capability policy)',
  },
};

export const RUNTIME_SECTION_META_V11 = RUNTIME_SECTION_META;

const RESET_LOG_FLAG_KEY = '__nimiRuntimeConfigV11ResetLogged__';

export function wasRuntimeConfigV11ResetLogged(): boolean {
  const root = globalThis as Record<string, unknown>;
  return Boolean(root[RESET_LOG_FLAG_KEY]);
}

export function markRuntimeConfigV11ResetLogged(): void {
  const root = globalThis as Record<string, unknown>;
  root[RESET_LOG_FLAG_KEY] = true;
}
