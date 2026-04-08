import { useTranslation } from 'react-i18next';
import {
  COMPANION_SLOTS,
  IMAGE_SIZE_PRESETS,
  IMAGE_RESPONSE_FORMAT_OPTIONS,
  type ImageParamsState,
  CompanionSlotSelector,
  useLocalAssets,
  FieldRow,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  SubSectionLabel,
} from './capability-settings-shared';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ImageCapabilitySettingsProps = {
  capability: string;
  params: ImageParamsState;
  companionSlots: Record<string, string>;
  onParamsChange: (next: ImageParamsState) => void;
  onCompanionSlotsChange: (next: Record<string, string>) => void;
};

export function ImageCapabilitySettings(props: ImageCapabilitySettingsProps) {
  const { t } = useTranslation();
  const { params, companionSlots } = props;
  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];

  const updateSlot = (slot: string, value: string) => {
    const next = { ...companionSlots, [slot]: value };
    props.onCompanionSlotsChange(next);
  };

  const updateParam = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      {/* Companion Models */}
      <SubSectionLabel label={t('Chat.imageCompanionModels', { defaultValue: 'Companion Models' })} preview />

      <div className="grid grid-cols-2 gap-3">
        {COMPANION_SLOTS.map((slot) => (
          <CompanionSlotSelector
            key={slot.slot}
            slot={slot}
            value={companionSlots[slot.slot] || ''}
            onChange={(value) => updateSlot(slot.slot, value)}
            assets={assets}
          />
        ))}
      </div>

      {/* Parameters */}
      <SubSectionLabel label={t('Chat.imageParameters', { defaultValue: 'Parameters' })} preview />

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSize', { defaultValue: 'Size' })}>
          <FieldSelect
            value={params.size}
            onChange={(v) => updateParam('size', v)}
            options={IMAGE_SIZE_PRESETS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamResponseFormat', { defaultValue: 'Response format' })}>
          <FieldSelect
            value={params.responseFormat}
            onChange={(v) => updateParam('responseFormat', v)}
            options={IMAGE_RESPONSE_FORMAT_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSeed', { defaultValue: 'Seed' })} tooltip={t('Chat.imageParamSeedHint', { defaultValue: 'Optional seed for reproducibility' })}>
          <FieldInput value={params.seed} onChange={(v) => updateParam('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamTimeout', { defaultValue: 'Timeout (ms)' })}>
          <FieldInput value={params.timeoutMs} onChange={(v) => updateParam('timeoutMs', v)} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSteps', { defaultValue: 'Steps' })}>
          <FieldInput value={params.steps} onChange={(v) => updateParam('steps', v)} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamCfgScale', { defaultValue: 'CFG Scale' })}>
          <FieldInput value={params.cfgScale} onChange={(v) => updateParam('cfgScale', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSampler', { defaultValue: 'Sampler' })}>
          <FieldInput value={params.sampler} onChange={(v) => updateParam('sampler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamScheduler', { defaultValue: 'Scheduler' })}>
          <FieldInput value={params.scheduler} onChange={(v) => updateParam('scheduler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>

      <FieldRow label={t('Chat.imageParamCustomOptions', { defaultValue: 'Custom options' })} tooltip={t('Chat.imageParamCustomOptionsHint', { defaultValue: 'One option per line. Example: diffusion_model' })}>
        <FieldTextarea value={params.optionsText} onChange={(v) => updateParam('optionsText', v)} placeholder={t('Chat.placeholderOnePerLine', { defaultValue: 'One option per line' })} rows={3} />
      </FieldRow>
    </div>
  );
}
