import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button, SelectField } from '@nimiplatform/kit/ui';
import { Upload } from 'lucide-react';

import {
  StudioBooleanParameter,
  StudioNumberParameter,
  StudioParameterField,
  StudioParameterPanelFrame,
  StudioRouteAwareParameterFields,
  StudioTextParameter,
  type StudioParameterFieldDefinition,
  type StudioParameterPanelProps,
  type StudioParameterTranslate,
} from '../../ai-studio-core/parameter-fields.js';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import {
  MAX_STUDIO_AUDIO_UPLOAD_BYTES,
  MAX_STUDIO_VOICE_REFERENCE_AUDIO_BYTES,
  type StudioSpeechSynthesizeParameters,
  type StudioSpeechTranscribeParameters,
  type StudioVoiceCreateParameters,
} from './parameters.js';

function SpeechSynthesizeFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost();
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioSpeechSynthesizeParameters;
  const update = props.onChange as (next: StudioSpeechSynthesizeParameters) => void;
  const effectiveVoiceKind = (props.contract.project(
    props.source,
    parameters,
  ) as StudioSpeechSynthesizeParameters).voiceKind;
  const [voices, setVoices] = useState<readonly { voiceAssetId: string; creationSource: string; status: string }[]>([]);
  const [voiceError, setVoiceError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void host.sdk.listLocalAppVoiceAssets().then(
      (assets) => { if (!cancelled) setVoices(assets); },
      (error) => { if (!cancelled) setVoiceError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { cancelled = true; };
  }, [host]);
  const textField = (field: keyof StudioSpeechSynthesizeParameters, label: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const numberField = (field: keyof StudioSpeechSynthesizeParameters, label: string, min?: number): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioNumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} min={min} />,
  });
  const voiceSourceLabel = t('Studio.parameters.fields.voiceSource');
  const timingModeLabel = t('Studio.parameters.fields.timingMode');
  const fields: StudioParameterFieldDefinition[] = [
    {
      field: 'voiceKind',
      label: voiceSourceLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={voiceSourceLabel}>
          <SelectField
            value={parameters.voiceKind}
            placeholder={t('Studio.parameters.runtimeDefault')}
            disabled={props.disabled || routeDisabled}
            options={[
              { value: 'preset', label: t('Studio.parameters.voicePreset') },
              { value: 'asset', label: t('Studio.parameters.voiceAsset') },
            ]}
            onValueChange={(value) => update({ ...parameters, voiceKind: value as 'preset' | 'asset' })}
          />
        </StudioParameterField>
      ),
    },
    ...(effectiveVoiceKind === 'preset' ? [textField('voicePreset', t('Studio.parameters.fields.voicePreset'))] : []),
    ...(effectiveVoiceKind === 'asset' ? [{
      field: 'voiceAssetId',
      label: t('Studio.parameters.fields.voiceAsset'),
      render: (routeDisabled: boolean) => (
        <StudioParameterField label={t('Studio.parameters.fields.voiceAsset')}>
          <SelectField
            value={parameters.voiceAssetId}
            placeholder={voices.length ? t('Studio.parameters.selectVoiceAsset') : t('Studio.parameters.noVoiceAssets')}
            disabled={props.disabled || routeDisabled || voices.length === 0}
            options={voices.map((voice) => ({ value: voice.voiceAssetId, label: `${voice.voiceAssetId} · ${voice.creationSource} · ${voice.status}` }))}
            onValueChange={(voiceAssetId) => update({ ...parameters, voiceAssetId })}
          />
          {voiceError ? <small>{voiceError}</small> : null}
        </StudioParameterField>
      ),
    }] : []),
    textField('language', t('Studio.parameters.fields.language')),
    textField('audioFormat', t('Studio.parameters.fields.audioFormat')),
    numberField('sampleRateHz', t('Studio.parameters.fields.sampleRateHz'), 0),
    numberField('speed', t('Studio.parameters.fields.speed')),
    numberField('pitch', t('Studio.parameters.fields.pitch')),
    numberField('volume', t('Studio.parameters.fields.volume')),
    textField('emotion', t('Studio.parameters.fields.emotion')),
    {
      field: 'timingMode',
      label: timingModeLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={timingModeLabel}>
          <SelectField
            value={parameters.timingMode}
            placeholder={t('Studio.parameters.runtimeDefault')}
            disabled={props.disabled || routeDisabled}
            options={['unspecified', 'none', 'word', 'char'].map((value) => ({ value, label: value }))}
            onValueChange={(timingMode) => update({ ...parameters, timingMode: timingMode as StudioSpeechSynthesizeParameters['timingMode'] })}
          />
        </StudioParameterField>
      ),
    },
  ];
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

function SpeechTranscribeFields(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioSpeechTranscribeParameters;
  const update = props.onChange as (next: StudioSpeechTranscribeParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > MAX_STUDIO_AUDIO_UPLOAD_BYTES) {
      setFileError(t('Studio.parameters.audioFileTooLarge'));
      return;
    }
    const mimeType = file.type || 'application/octet-stream';
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFileError('');
    update({ ...parameters, audioFile: { name: file.name, mimeType, sizeBytes: file.size, bytes }, mimeType });
  }
  const textField = (field: keyof StudioSpeechTranscribeParameters, label: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const booleanField = (field: keyof StudioSpeechTranscribeParameters, label: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioBooleanParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const audioFileLabel = t('Studio.parameters.fields.audioFile');
  const fields: StudioParameterFieldDefinition[] = [
    {
      field: 'audioFile',
      label: audioFileLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={audioFileLabel}>
          <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" disabled={props.disabled || routeDisabled} onChange={(event) => void selectFile(event)} />
          <div className="studio-parameters__file-row">
            <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
              {t('Studio.parameters.chooseAudioFile')}
            </Button>
            {parameters.audioFile ? <span>{parameters.audioFile.name}</span> : null}
            {parameters.audioFile ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => { const next = { ...parameters }; delete next.audioFile; update(next); }}>{t('Studio.parameters.removeFile')}</Button> : null}
          </div>
          {fileError ? <small>{fileError}</small> : null}
        </StudioParameterField>
      ),
    },
    textField('mimeType', t('Studio.parameters.fields.mimeType')),
    textField('language', t('Studio.parameters.fields.language')),
    booleanField('timestamps', t('Studio.parameters.fields.timestamps')),
    booleanField('diarization', t('Studio.parameters.fields.diarization')),
    {
      field: 'speakerCount',
      label: t('Studio.parameters.fields.speakerCount'),
      render: (routeDisabled) => <StudioNumberParameter current={parameters} field="speakerCount" label={t('Studio.parameters.fields.speakerCount')} onChange={update} disabled={props.disabled || routeDisabled} min={0} step={1} />,
    },
    textField('prompt', t('Studio.parameters.fields.transcriptionPrompt')),
    textField('responseFormat', t('Studio.parameters.fields.responseFormat')),
  ];
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

function VoiceCreateFields(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioVoiceCreateParameters;
  const update = props.onChange as (next: StudioVoiceCreateParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const creationSource = parameters.creationSource ?? 'reference-audio';
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_STUDIO_VOICE_REFERENCE_AUDIO_BYTES) {
      setFileError(t('Studio.parameters.voiceReferenceFileTooLarge'));
      return;
    }
    const mimeType = file.type || 'application/octet-stream';
    if (!mimeType.startsWith('audio/')) {
      setFileError(t('Studio.parameters.voiceReferenceMimeUnsupported'));
      return;
    }
    setFileError('');
    update({
      ...parameters,
      referenceAudioFile: {
        name: file.name,
        mimeType,
        sizeBytes: file.size,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    });
  }
  const textField = (field: keyof StudioVoiceCreateParameters, label: string, placeholder?: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const sourceLabel = t('Studio.parameters.fields.creationSource');
  const fields: StudioParameterFieldDefinition[] = [
    {
      field: 'creationSource',
      label: sourceLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={sourceLabel}>
          <SelectField
            value={creationSource}
            disabled={props.disabled || routeDisabled}
            options={[
              { value: 'reference-audio', label: t('Studio.parameters.voiceSourceReferenceAudio') },
              { value: 'text-description', label: t('Studio.parameters.voiceSourceTextDescription') },
            ]}
            onValueChange={(value) => update({ ...parameters, creationSource: value as StudioVoiceCreateParameters['creationSource'] })}
          />
        </StudioParameterField>
      ),
    },
    ...(creationSource === 'reference-audio' ? [
      {
        field: 'referenceAudioFile',
        label: t('Studio.parameters.fields.referenceAudioFile'),
        render: (routeDisabled: boolean) => (
          <StudioParameterField label={t('Studio.parameters.fields.referenceAudioFile')}>
            <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" disabled={props.disabled || routeDisabled} onChange={(event) => void selectFile(event)} />
            <div className="studio-parameters__file-row">
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
                {t('Studio.parameters.chooseAudioFile')}
              </Button>
              {parameters.referenceAudioFile ? <span>{parameters.referenceAudioFile.name}</span> : null}
              {parameters.referenceAudioFile ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => { const next = { ...parameters }; delete next.referenceAudioFile; update(next); }}>{t('Studio.parameters.removeFile')}</Button> : null}
            </div>
            {fileError ? <small>{fileError}</small> : null}
          </StudioParameterField>
        ),
      },
      textField('languageHints', t('Studio.parameters.fields.languageHints'), 'zh, en'),
    ] : [
      textField('previewText', t('Studio.parameters.fields.previewText')),
      textField('language', t('Studio.parameters.fields.language'), 'zh'),
    ]),
    textField('preferredName', t('Studio.parameters.fields.preferredName')),
  ];
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

export function StudioVoiceParameterPanel(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  let fields = null;
  if (props.capabilityId === 'audio.synthesize') fields = <SpeechSynthesizeFields {...props} />;
  else if (props.capabilityId === 'audio.transcribe') fields = <SpeechTranscribeFields {...props} />;
  else if (props.capabilityId === 'voice.create') fields = <VoiceCreateFields {...props} />;
  if (!fields) return null;
  return (
    <StudioParameterPanelFrame
      translate={translate}
      disabled={props.disabled}
      onReset={() => props.onChange(props.contract.initial())}
    >
      {fields}
    </StudioParameterPanelFrame>
  );
}
