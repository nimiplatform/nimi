import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import type { NimiMachineLoadout } from '@nimiplatform/sdk/runtime';
import { loadoutValidationMessages } from '../src/shell/renderer/features/runtime-config/runtime-loadout-validation.js';
import en from '../src/shell/renderer/locales/en/46-runtimeConfig.json';
import zh from '../src/shell/renderer/locales/zh/46-runtimeConfig.json';

test('validation distinguishes missing selections, missing files and incompatible files in both languages', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: { runtimeConfig: en } }, zh: { translation: { runtimeConfig: zh } } } });
  const axis = { slotId: 'main.diffusion', displayLabel: 'Main model', modelAssetId: 'a', expectedContentId: 'c', recipeCompatible: false, resolution: 'unresolved', presence: 'required', conditionalFeatures: [], reasons: [] } as NimiMachineLoadout['modelAxes'][number];
  const make = (modelAxes: NimiMachineLoadout['modelAxes'], reasons: string[] = []) => ({ validationState: 'blocked' as const, modelAxes, reasons });
  for (const language of ['en', 'zh']) {
    await i18n.changeLanguage(language);
    const missing = loadoutValidationMessages(make([{ ...axis, modelAssetId: '' }]), i18n.t).join(' ');
    assert.match(missing, language === 'en' ? /No model selected/ : /尚未选择模型/);
    const unavailable = loadoutValidationMessages(make([{ ...axis, reasons: ['AI_LOADOUT_MODEL_ASSET_NOT_FOUND'] }]), i18n.t).join(' ');
    assert.match(unavailable, language === 'en' ? /resource is unavailable/ : /模型资源不可用/);
    assert.doesNotMatch(unavailable, /incompatible|不符合/);
    const incompatible = loadoutValidationMessages(make([{ ...axis, reasons: ['AI_LOADOUT_MODEL_CONTRACT_FAILED'] }]), i18n.t).join(' ');
    assert.match(incompatible, language === 'en' ? /incompatible/ : /不符合/);
    const unknown = loadoutValidationMessages(make([{ ...axis, reasons: ['UNKNOWN_REASON'] }]), i18n.t).join(' ');
    assert.doesNotMatch(unknown, /UNKNOWN_REASON|incompatible|不符合|download|下载/);
    assert.match(unknown, language === 'en' ? /not passed validation/ : /尚未完成校验/);
    const optional = { ...axis, slotId: 'optional', modelAssetId: '', presence: 'optional-conditional', resolution: 'not-configured' } as typeof axis;
    assert.equal(loadoutValidationMessages(make([axis, optional]), i18n.t).length, 1);
  }
});
