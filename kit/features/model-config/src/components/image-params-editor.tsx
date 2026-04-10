import type { ImageParamsState, LocalAssetEntry } from '../types.js';
import { COMPANION_SLOTS, IMAGE_RESPONSE_FORMAT_OPTIONS, IMAGE_SIZE_PRESETS } from '../constants.js';
import { CompanionSlotSelector } from './companion-slot-selector.js';
import { FieldInput, FieldRow, FieldSelect, FieldTextarea, SubSectionLabel } from './field-primitives.js';

export type ImageParamsEditorCopy = {
  companionModelsLabel: string;
  parametersLabel: string;
  previewBadgeLabel?: string;
  sizeLabel: string;
  responseFormatLabel: string;
  seedLabel: string;
  seedHint?: string;
  timeoutLabel: string;
  stepsLabel: string;
  cfgScaleLabel: string;
  samplerLabel: string;
  schedulerLabel: string;
  customOptionsLabel: string;
  customOptionsHint?: string;
  defaultPlaceholder?: string;
  randomPlaceholder?: string;
  oneOptionPerLinePlaceholder?: string;
  noneLabel?: string;
};

export type ImageParamsEditorProps = {
  params: ImageParamsState;
  companionSlots: Record<string, string>;
  onParamsChange: (next: ImageParamsState) => void;
  onCompanionSlotsChange: (next: Record<string, string>) => void;
  assets: LocalAssetEntry[];
  assetsLoading?: boolean;
  copy: ImageParamsEditorCopy;
};

export function ImageParamsEditor(props: ImageParamsEditorProps) {
  const { assets, companionSlots, copy, params } = props;

  const updateSlot = (slot: string, value: string) => {
    props.onCompanionSlotsChange({ ...companionSlots, [slot]: value });
  };

  const updateParam = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.companionModelsLabel} previewLabel={copy.previewBadgeLabel} />

      <div className="grid grid-cols-2 gap-3">
        {COMPANION_SLOTS.map((slot) => (
          <CompanionSlotSelector
            key={slot.slot}
            slot={slot}
            value={companionSlots[slot.slot] || ''}
            onChange={(value) => updateSlot(slot.slot, value)}
            assets={assets}
            noneLabel={copy.noneLabel}
          />
        ))}
      </div>

      <SubSectionLabel label={copy.parametersLabel} previewLabel={copy.previewBadgeLabel} />

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.sizeLabel}>
          <FieldSelect
            value={params.size}
            onChange={(value) => updateParam('size', value)}
            options={IMAGE_SIZE_PRESETS.map((item) => ({ value: item, label: item }))}
          />
        </FieldRow>
        <FieldRow label={copy.responseFormatLabel}>
          <FieldSelect
            value={params.responseFormat}
            onChange={(value) => updateParam('responseFormat', value)}
            options={IMAGE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.seedLabel} tooltip={copy.seedHint}>
          <FieldInput
            value={params.seed}
            onChange={(value) => updateParam('seed', value)}
            placeholder={copy.randomPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.timeoutLabel}>
          <FieldInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.stepsLabel}>
          <FieldInput
            value={params.steps}
            onChange={(value) => updateParam('steps', value)}
          />
        </FieldRow>
        <FieldRow label={copy.cfgScaleLabel}>
          <FieldInput
            value={params.cfgScale}
            onChange={(value) => updateParam('cfgScale', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={copy.samplerLabel}>
          <FieldInput
            value={params.sampler}
            onChange={(value) => updateParam('sampler', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
        <FieldRow label={copy.schedulerLabel}>
          <FieldInput
            value={params.scheduler}
            onChange={(value) => updateParam('scheduler', value)}
            placeholder={copy.defaultPlaceholder}
          />
        </FieldRow>
      </div>

      <FieldRow label={copy.customOptionsLabel} tooltip={copy.customOptionsHint}>
        <FieldTextarea
          value={params.optionsText}
          onChange={(value) => updateParam('optionsText', value)}
          placeholder={copy.oneOptionPerLinePlaceholder}
          rows={3}
        />
      </FieldRow>
    </div>
  );
}
