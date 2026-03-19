import type { JsonObject } from '../../internal/utils.js';
import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import { getModSdkHost } from '../host.js';

function requireSettings() {
  const settings = getModSdkHost().settings;
  if (settings) {
    return settings;
  }
  throw createNimiError({
    message: 'mod SDK settings host is not ready',
    reasonCode: ReasonCode.SDK_MOD_HOST_MISSING,
    actionHint: 'ensure_mod_settings_host_initialized',
    source: 'sdk',
  });
}

export function useModSdkRuntimeModSettings(modId: string): JsonObject {
  return requireSettings().useRuntimeModSettings(modId);
}

export function setModSdkRuntimeModSettings(modId: string, settings: JsonObject): void {
  requireSettings().setRuntimeModSettings(modId, settings);
}
