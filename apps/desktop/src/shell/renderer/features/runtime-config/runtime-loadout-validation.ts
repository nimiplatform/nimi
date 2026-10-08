import { normalizeNimiRuntimeReasonCode, type NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import { localizedAssetUnhealthyReason } from './runtime-config-reason-messages.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.model-preparation-status-ownership
// Explain owner-provided validation facts; unknown reasons never imply a download.
function validationReasonMessage(reason: string, t: TFunction): string {
  switch (normalizeNimiRuntimeReasonCode(reason)) {
    case 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND': return t('runtimeConfig.localModels.validation.assetUnavailable');
    case 'AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH': return t('runtimeConfig.localModels.validation.contentMismatch');
    case 'AI_LOADOUT_MODEL_CONTRACT_FAILED': return t('runtimeConfig.localModels.validation.incompatible');
    default: return localizedAssetUnhealthyReason(reason, t);
  }
}

export function loadoutValidationMessages(loadout: Pick<NimiMachineLoadout, 'validationState' | 'modelAxes' | 'reasons'>, t: TFunction): string[] {
  if (loadout.validationState === 'configured') return [];
  const messages: string[] = [];
  const axisReasons = new Set<string>();
  for (const axis of loadout.modelAxes) {
    if (axis.presence === 'optional-conditional' && axis.resolution === 'not-configured') continue;
    const key = loadoutSlotLabelKey(axis.slotId);
    const slot = key ? t(key, { defaultValue: axis.displayLabel }) : axis.displayLabel;
    const reasons = axis.reasons.map((reason) => {
      axisReasons.add(reason);
      return validationReasonMessage(reason, t);
    }).filter(Boolean);
    if (!axis.modelAssetId && axis.presence === 'required') {
      messages.push(t('runtimeConfig.localModels.validation.chooseModel', { slot }));
    } else if (reasons.length === 0 && (axis.resolution === 'unresolved' || (axis.modelAssetId && !axis.recipeCompatible))) {
      messages.push(t('runtimeConfig.localModels.validation.unresolved', { slot }));
    }
    messages.push(...reasons.map((message) => `${slot}: ${message}`));
  }
  for (const reason of loadout.reasons) {
    if (axisReasons.has(reason)) continue;
    const message = validationReasonMessage(reason, t);
    if (message) messages.push(message);
  }
  if (!messages.length) messages.push(t('runtimeConfig.localModels.validation.review'));
  return [...new Set(messages)];
}
