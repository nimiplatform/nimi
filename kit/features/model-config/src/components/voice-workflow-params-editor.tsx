import type { VoiceWorkflowParamsState, LocalAssetEntry } from '../types.js';
import { FieldInput, FieldRow, FieldSelect, FieldTextarea, SubSectionLabel } from './field-primitives.js';

export type VoiceWorkflowParamsEditorCopy = {
  parametersLabel: string;
  cloneParametersLabel?: string;
  designParametersLabel?: string;
  previewBadgeLabel?: string;
  referenceAssetLabel: string;
  referenceAssetHint?: string;
  referenceTextLabel: string;
  voiceDesignPromptLabel: string;
  voiceDesignPromptHint?: string;
  previewTextLabel?: string;
  languageLabel?: string;
  preferredNameLabel?: string;
  durationLabel: string;
  seedLabel: string;
  seedHint?: string;
  timeoutLabel: string;
  defaultPlaceholder?: string;
  referenceTextPlaceholder?: string;
  voiceDesignPromptPlaceholder?: string;
  previewTextPlaceholder?: string;
  languagePlaceholder?: string;
  preferredNamePlaceholder?: string;
  referenceAssetPlaceholder?: string;
  randomPlaceholder?: string;
  noneLabel?: string;
};

export type VoiceWorkflowParamsEditorMode = 'voice_clone' | 'voice_design';

export type VoiceWorkflowParamsEditorProps = {
  params: VoiceWorkflowParamsState;
  onParamsChange: (next: VoiceWorkflowParamsState) => void;
  assets?: LocalAssetEntry[];
  assetsLoading?: boolean;
  copy: VoiceWorkflowParamsEditorCopy;
  mode: VoiceWorkflowParamsEditorMode;
};

export function createVoiceWorkflowEditorCopy(
  t: (key: string, vars?: Record<string, string | number>) => string,
): VoiceWorkflowParamsEditorCopy {
  return {
    parametersLabel: t('ModelConfig.editor.voiceWorkflow.parametersLabel'),
    cloneParametersLabel: t('ModelConfig.editor.voiceWorkflow.cloneParametersLabel', { defaultValue: 'Voice clone parameters' }),
    designParametersLabel: t('ModelConfig.editor.voiceWorkflow.designParametersLabel', { defaultValue: 'Voice design parameters' }),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    referenceAssetLabel: t('ModelConfig.editor.voiceWorkflow.referenceAssetLabel'),
    referenceAssetHint: t('ModelConfig.editor.voiceWorkflow.referenceAssetHint'),
    referenceTextLabel: t('ModelConfig.editor.voiceWorkflow.referenceTextLabel'),
    voiceDesignPromptLabel: t('ModelConfig.editor.voiceWorkflow.voiceDesignPromptLabel'),
    voiceDesignPromptHint: t('ModelConfig.editor.voiceWorkflow.voiceDesignPromptHint'),
    previewTextLabel: t('ModelConfig.editor.voiceWorkflow.previewTextLabel', { defaultValue: 'Preview text' }),
    languageLabel: t('ModelConfig.editor.voiceWorkflow.languageLabel', { defaultValue: 'Language' }),
    preferredNameLabel: t('ModelConfig.editor.voiceWorkflow.preferredNameLabel', { defaultValue: 'Preferred name' }),
    durationLabel: t('ModelConfig.editor.voiceWorkflow.durationLabel'),
    seedLabel: t('ModelConfig.editor.common.seedLabel'),
    seedHint: t('ModelConfig.editor.common.seedHint'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    referenceTextPlaceholder: t('ModelConfig.editor.voiceWorkflow.referenceTextPlaceholder'),
    voiceDesignPromptPlaceholder: t('ModelConfig.editor.voiceWorkflow.voiceDesignPromptPlaceholder'),
    previewTextPlaceholder: t('ModelConfig.editor.voiceWorkflow.previewTextPlaceholder', { defaultValue: 'Text used to audition the designed voice' }),
    languagePlaceholder: t('ModelConfig.editor.voiceWorkflow.languagePlaceholder', { defaultValue: 'Language (optional)' }),
    preferredNamePlaceholder: t('ModelConfig.editor.voiceWorkflow.preferredNamePlaceholder', { defaultValue: 'Preferred voice asset name' }),
    referenceAssetPlaceholder: t('ModelConfig.editor.voiceWorkflow.referenceAssetPlaceholder'),
    randomPlaceholder: t('ModelConfig.editor.common.randomPlaceholder'),
    noneLabel: t('ModelConfig.editor.common.noneLabel'),
  };
}

export function VoiceWorkflowParamsEditor(props: VoiceWorkflowParamsEditorProps) {
  const { assets, copy, params } = props;

  const updateParam = <K extends keyof VoiceWorkflowParamsState>(
    key: K,
    value: VoiceWorkflowParamsState[K],
  ) => {
    props.onParamsChange({ ...params, [key]: value });
  };

  const assetOptions = assets && assets.length > 0
    ? [
      { value: '', label: copy.noneLabel || '' },
      ...assets.map((asset) => ({
        value: asset.localAssetId,
        label: `${asset.engine || 'voice'} · ${asset.localAssetId}`,
      })),
    ]
    : null;
  const isClone = props.mode === 'voice_clone';
  const parametersLabel = isClone
    ? (copy.cloneParametersLabel || copy.parametersLabel)
    : (copy.designParametersLabel || copy.parametersLabel);

  return (
    <div className="space-y-3">
      <SubSectionLabel label={parametersLabel} previewLabel={copy.previewBadgeLabel} />

      {isClone ? (
        <>
          <FieldRow label={copy.referenceAssetLabel} tooltip={copy.referenceAssetHint}>
            {assetOptions ? (
              <FieldSelect
                value={params.referenceAssetId}
                onChange={(value) => updateParam('referenceAssetId', value)}
                options={assetOptions}
                placeholder={copy.referenceAssetPlaceholder}
              />
            ) : (
              <FieldInput
                value={params.referenceAssetId}
                onChange={(value) => updateParam('referenceAssetId', value)}
                placeholder={copy.referenceAssetPlaceholder}
              />
            )}
          </FieldRow>

          <FieldRow label={copy.referenceTextLabel}>
            <FieldTextarea
              value={params.referenceText}
              onChange={(value) => updateParam('referenceText', value)}
              placeholder={copy.referenceTextPlaceholder}
              rows={3}
            />
          </FieldRow>
        </>
      ) : (
        <>
          <FieldRow label={copy.voiceDesignPromptLabel} tooltip={copy.voiceDesignPromptHint}>
            <FieldTextarea
              value={params.voiceDesignPrompt}
              onChange={(value) => updateParam('voiceDesignPrompt', value)}
              placeholder={copy.voiceDesignPromptPlaceholder}
              rows={3}
            />
          </FieldRow>

          <FieldRow label={copy.previewTextLabel || 'Preview text'}>
            <FieldTextarea
              value={params.previewText}
              onChange={(value) => updateParam('previewText', value)}
              placeholder={copy.previewTextPlaceholder}
              rows={3}
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={copy.languageLabel || 'Language'}>
              <FieldInput
                value={params.language}
                onChange={(value) => updateParam('language', value)}
                placeholder={copy.languagePlaceholder}
              />
            </FieldRow>
            <FieldRow label={copy.preferredNameLabel || 'Preferred name'}>
              <FieldInput
                value={params.preferredName}
                onChange={(value) => updateParam('preferredName', value)}
                placeholder={copy.preferredNamePlaceholder}
              />
            </FieldRow>
          </div>
        </>
      )}

      <FieldRow label={copy.timeoutLabel}>
          <FieldInput
            value={params.timeoutMs}
            onChange={(value) => updateParam('timeoutMs', value)}
            placeholder={copy.defaultPlaceholder}
          />
      </FieldRow>
    </div>
  );
}
