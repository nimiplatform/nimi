import type { ImageParamsState, ModelConfigProfileCapabilitySummary } from '../types.js';
import type { ModelConfigLocalAssetDescriptor } from '@nimiplatform/kit/core/model-config';
import type { NimiAIConfigComponentSelection } from '@nimiplatform/kit/core/sdk-contract';
import {
  IMAGE_RESPONSE_FORMAT_OPTIONS,
  IMAGE_SIZE_PRESETS,
} from '../constants.js';
import { FieldInput, FieldRow, FieldSelect, SubSectionLabel } from './field-primitives.js';
import { CompanionSlotSelector } from './companion-slot-selector.js';

export type ImageParamsEditorCopy = {
  companionModelsLabel: string;
  parametersLabel: string;
  sizeLabel: string;
  responseFormatLabel: string;
  seedLabel: string;
  seedHint?: string;
  timeoutLabel: string;
  stepsLabel: string;
  cfgScaleLabel: string;
  samplerLabel: string;
  schedulerLabel: string;
  defaultPlaceholder?: string;
  randomPlaceholder?: string;
  noneLabel?: string;
  requiredLabel?: string;
  requiredSetupPlaceholder?: string;
  setupPendingLabel?: string;
  mainModelLabel?: string;
  compositionRuntimeOwnedHint?: string;
  compositionUnavailableHint?: string;
  componentPickerTitle?: string;
  componentSearchPlaceholder?: string;
  componentLoadingLabel?: string;
  componentEmptyLabel?: string;
  componentSelectedLabel?: string;
  currentUnavailableLabel?: string;
};

export type ImageParamsEditorProps = {
  params: ImageParamsState;
  onParamsChange: (next: ImageParamsState) => void;
  profileComposition?: ModelConfigProfileCapabilitySummary | null;
  selectedComponents?: readonly NimiAIConfigComponentSelection[];
  componentCandidates?: readonly ModelConfigLocalAssetDescriptor[];
  componentsLoading?: boolean;
  onComponentsChange?: (next: readonly NimiAIConfigComponentSelection[]) => void;
  copy: ImageParamsEditorCopy;
};

export function ImageParamsEditor(props: ImageParamsEditorProps) {
  const { copy, params, profileComposition } = props;
  const selectedComponents = props.selectedComponents || [];
  const renderedComponents = [...selectedComponents]
    .sort((left, right) => left.order - right.order);

  const updateParam = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <SubSectionLabel label={copy.companionModelsLabel} />

      {profileComposition?.modelLabel ? (
        <div
          data-nimi-image-profile-provenance="portable"
          className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-3 text-xs">
            <span className="text-[var(--nimi-text-muted)]">{copy.mainModelLabel ?? 'Main model'}</span>
            <span className="break-all text-right font-medium text-[var(--nimi-text-primary)]">
              {profileComposition.modelLabel}
            </span>
          </div>
        </div>
      ) : null}

      {renderedComponents.length > 0 ? (
        <div data-nimi-image-component-slots={renderedComponents.length} className="space-y-3">
          {renderedComponents.map((selection) => (
            <CompanionSlotSelector
              key={selection.occurrenceId}
              slot={selection}
              value={selection}
              candidates={props.componentCandidates || []}
              loading={props.componentsLoading}
              copy={{
                dialogTitle: copy.componentPickerTitle,
                searchPlaceholder: copy.componentSearchPlaceholder,
                loadingLabel: copy.componentLoadingLabel,
                emptyLabel: copy.componentEmptyLabel,
                selectedLabel: copy.componentSelectedLabel,
                currentUnavailableLabel: copy.currentUnavailableLabel,
                requiredLabel: copy.requiredLabel,
              }}
              onChange={(nextSelection) => {
                if (!props.onComponentsChange) return;
                props.onComponentsChange(selectedComponents.map((current) => (
                  current.occurrenceId === selection.occurrenceId ? nextSelection : current
                )));
              }}
            />
          ))}
          {profileComposition ? (
            <p className="text-[10px] leading-relaxed text-[var(--nimi-text-muted)]">
              {copy.compositionRuntimeOwnedHint
                ?? 'Component slots came from the applied AI Profile. Changes are saved only to this AI configuration.'}
            </p>
          ) : null}
        </div>
      ) : (
        <p
          data-nimi-image-component-slots="0"
          className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]"
        >
          {copy.compositionUnavailableHint
            ?? 'Apply an AI Profile with component slots before configuring this workflow.'}
        </p>
      )}

      <SubSectionLabel label={copy.parametersLabel} />

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

    </div>
  );
}
