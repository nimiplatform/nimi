import type { TFunction } from 'i18next';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';

/**
 * Chat settings capability copy. `text.generate` keeps its Chat-specific
 * wording; every other capability row shows its real Runtime capability label
 * (or the caller-supplied fallback) — never a hardcoded "Text generation".
 */

export function resolveChatSettingsCapabilityLabel(
  capabilityContract: string,
  fallback: string | undefined,
  t: TFunction,
): string {
  return capabilityContract === 'text.generate'
    ? t('Chat.settingsTextCapability', { defaultValue: 'Text generation' })
    : displayRuntimeConfigCapabilityLabel(capabilityContract, t) || fallback || capabilityContract;
}

export function resolveChatSettingsCapabilityDescription(
  capabilityContract: string,
  fallback: string | undefined,
  t: TFunction,
): string {
  return capabilityContract === 'text.generate'
    ? t('Chat.settingsTextCapabilityDescription', {
      defaultValue: 'Controls how Nimi Chat resolves text generation.',
    })
    : (fallback || capabilityContract);
}
