import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, SelectField, TextareaField, TextField, Toggle } from '@nimiplatform/kit/ui';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useTesterRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import type { TesterCapabilityId } from '../tester-capabilities.js';
import {
  MAX_TESTER_ARTIFACT_UPLOAD_BYTES,
  MAX_TESTER_AUDIO_UPLOAD_BYTES,
  type TesterCapabilityParameterState,
  type TesterEmbeddingParameters,
  type TesterImageGenerationParameters,
  type TesterSpeechSynthesizeParameters,
  type TesterSpeechTranscribeParameters,
  type TesterTextGenerationParameters,
  type TesterVideoGenerationParameters,
} from '../tester-capability-parameters.js';
import type { TesterRunTargetSource } from '../tester-run-target.js';

const TESTER_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type TesterImageMimeType = typeof TESTER_IMAGE_MIME_TYPES[number];

function isTesterImageMimeType(value: string): value is TesterImageMimeType {
  return TESTER_IMAGE_MIME_TYPES.includes(value as TesterImageMimeType);
}

type ParameterPanelProps<TCapabilityId extends TesterCapabilityId = TesterCapabilityId> = {
  capabilityId: TCapabilityId;
  source: TesterRunTargetSource;
  parameters: TesterCapabilityParameterState[TCapabilityId];
  disabled: boolean;
  onChange: (parameters: TesterCapabilityParameterState[TCapabilityId]) => void;
};

type ParameterFieldProps = {
  label: string;
  cloudOnly?: boolean;
  source?: TesterRunTargetSource;
  children: ReactNode;
};

function ParameterField({ label, cloudOnly = false, source, children }: ParameterFieldProps) {
  const { t } = useTranslation();
  return (
    <label className="studio-parameters__field">
      <span className="studio-parameters__label">
        {label}
        {cloudOnly ? <em>{t('Studio.parameters.cloudOnly')}</em> : null}
      </span>
      {children}
      {cloudOnly && source === 'local' ? (
        <small>{t('Studio.parameters.localRejectHint')}</small>
      ) : null}
    </label>
  );
}

function optionalText<T extends object>(current: T, key: keyof T, value: string): T {
  if (value.length > 0) return { ...current, [key]: value };
  const next = { ...current };
  delete next[key];
  return next;
}

function optionalNumber<T extends object>(current: T, key: keyof T, value: string): T {
  if (value !== '' && Number.isFinite(Number(value))) return { ...current, [key]: Number(value) };
  const next = { ...current };
  delete next[key];
  return next;
}

function NumberParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
  min,
  max,
  step = 'any',
  cloudOnly,
  source,
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
  cloudOnly?: boolean;
  source?: TesterRunTargetSource;
}) {
  const value = current[field];
  return (
    <ParameterField label={label} cloudOnly={cloudOnly} source={source}>
      <TextField
        type="number"
        value={typeof value === 'number' ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(optionalNumber(current, field, event.currentTarget.value))}
      />
    </ParameterField>
  );
}

function TextParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
  placeholder,
  cloudOnly,
  source,
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
  placeholder?: string;
  cloudOnly?: boolean;
  source?: TesterRunTargetSource;
}) {
  const value = current[field];
  return (
    <ParameterField label={label} cloudOnly={cloudOnly} source={source}>
      <TextField
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(optionalText(current, field, event.currentTarget.value))}
      />
    </ParameterField>
  );
}

function BooleanParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
  cloudOnly,
  source,
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
  cloudOnly?: boolean;
  source?: TesterRunTargetSource;
}) {
  return (
    <ParameterField label={label} cloudOnly={cloudOnly} source={source}>
      <Toggle
        checked={current[field] === true}
        disabled={disabled}
        ariaLabel={label}
        onChange={(checked) => onChange({ ...current, [field]: checked })}
      />
    </ParameterField>
  );
}

function TextGenerationFields(props: ParameterPanelProps<'text.generate' | 'chat.stream'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterTextGenerationParameters;
  const update = props.onChange as (next: TesterTextGenerationParameters) => void;
  return (
    <div className="studio-parameters__grid">
      <NumberParameter current={parameters} field="temperature" label={t('Studio.parameters.fields.temperature')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="topP" label={t('Studio.parameters.fields.topP')} onChange={update} disabled={props.disabled} min={0} max={1} />
      <NumberParameter current={parameters} field="maxTokens" label={t('Studio.parameters.fields.maxTokens')} onChange={update} disabled={props.disabled} min={0} step={1} />
      <NumberParameter current={parameters} field="topK" label={t('Studio.parameters.fields.topK')} onChange={update} disabled={props.disabled} min={0} step={1} />
      <NumberParameter current={parameters} field="presencePenalty" label={t('Studio.parameters.fields.presencePenalty')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="frequencyPenalty" label={t('Studio.parameters.fields.frequencyPenalty')} onChange={update} disabled={props.disabled} />
      <ParameterField label={t('Studio.parameters.fields.stop')}>
        <TextareaField
          rows={3}
          value={parameters.stop?.join('\n') ?? ''}
          placeholder={t('Studio.parameters.stopPlaceholder')}
          disabled={props.disabled}
          onChange={(event) => {
            const values = event.currentTarget.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
            if (values.length > 0) update({ ...parameters, stop: values });
            else {
              const next = { ...parameters };
              delete next.stop;
              update(next);
            }
          }}
        />
      </ParameterField>
      <NumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled} step={1} />
    </div>
  );
}

function EmbeddingFields(props: ParameterPanelProps<'text.embed'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterEmbeddingParameters;
  const values = parameters.inputs?.length ? parameters.inputs : [''];
  const updateValues = (nextValues: string[]) => {
    if (nextValues.some((value) => value.trim())) props.onChange({ inputs: nextValues });
    else props.onChange({});
  };
  return (
    <div className="studio-parameters__stack">
      {values.map((value, index) => (
        <div className="studio-parameters__repeat" key={index}>
          <TextareaField
            rows={2}
            value={value}
            disabled={props.disabled}
            aria-label={t('Studio.parameters.embeddingInput', { index: index + 1 })}
            placeholder={t('Studio.parameters.embeddingInputPlaceholder')}
            onChange={(event) => updateValues(values.map((entry, itemIndex) => itemIndex === index ? event.currentTarget.value : entry))}
          />
          {values.length > 1 ? (
            <Button type="button" tone="ghost" size="sm" disabled={props.disabled} onClick={() => updateValues(values.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('Studio.parameters.removeInput', { index: index + 1 })}>
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      <Button type="button" tone="ghost" size="sm" disabled={props.disabled} leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => updateValues([...values, ''])}>
        {t('Studio.parameters.addInput')}
      </Button>
    </div>
  );
}

function ImageFields(props: ParameterPanelProps<'image.generate'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterImageGenerationParameters;
  const update = props.onChange as (next: TesterImageGenerationParameters) => void;
  return (
    <div className="studio-parameters__grid">
      <TextParameter current={parameters} field="negativePrompt" label={t('Studio.parameters.fields.negativePrompt')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="count" label={t('Studio.parameters.fields.count')} onChange={update} disabled={props.disabled} min={1} step={1} />
      <TextParameter current={parameters} field="size" label={t('Studio.parameters.fields.size')} placeholder="1024x1024" onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled} step={1} />
      <TextParameter current={parameters} field="aspectRatio" label={t('Studio.parameters.fields.aspectRatio')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <TextParameter current={parameters} field="quality" label={t('Studio.parameters.fields.quality')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <TextParameter current={parameters} field="style" label={t('Studio.parameters.fields.style')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <TextParameter current={parameters} field="referenceImage" label={t('Studio.parameters.fields.referenceImage')} placeholder="https://…" onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="mask" label={t('Studio.parameters.fields.mask')} placeholder="https://…" onChange={update} disabled={props.disabled} />
    </div>
  );
}

function VideoFields(props: ParameterPanelProps<'video.generate'>) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const parameters = props.parameters as TesterVideoGenerationParameters;
  const update = props.onChange as (next: TesterVideoGenerationParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  async function selectReferenceImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_TESTER_ARTIFACT_UPLOAD_BYTES) {
      setUploadError(t('Studio.parameters.imageFileTooLarge'));
      return;
    }
    if (!isTesterImageMimeType(file.type)) {
      setUploadError(t('Studio.parameters.imageFileMimeUnsupported'));
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const result = await rendererHost.sdk.uploadLocalAppArtifact({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
      });
      setUploadedFileName(file.name);
      update({ ...parameters, mode: 'i2v-reference', referenceArtifactId: result.artifactId });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="studio-parameters__grid">
      <ParameterField label={t('Studio.parameters.fields.mode')}>
        <SelectField
          value={parameters.mode ?? 't2v'}
          disabled={props.disabled}
          options={[
            { value: 't2v', label: t('Studio.parameters.videoModeT2v') },
            { value: 'i2v-reference', label: t('Studio.parameters.videoModeReference') },
          ]}
          onValueChange={(value) => update({ ...parameters, mode: value as TesterVideoGenerationParameters['mode'] })}
        />
      </ParameterField>
      {parameters.mode === 'i2v-reference' ? (
        <>
          <TextParameter current={parameters} field="referenceArtifactId" label={t('Studio.parameters.fields.referenceArtifactId')} placeholder="artifact_…" onChange={update} disabled={props.disabled || uploading} />
          <ParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
            <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void selectReferenceImage(event)} />
            <div className="studio-parameters__file-row">
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
                {uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}
              </Button>
              {uploadedFileName ? <span>{uploadedFileName}</span> : null}
            </div>
            {uploadError ? <small>{uploadError}</small> : null}
          </ParameterField>
        </>
      ) : null}
      <TextParameter current={parameters} field="negativePrompt" label={t('Studio.parameters.fields.negativePrompt')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="resolution" label={t('Studio.parameters.fields.resolution')} placeholder="720p" onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="frames" label={t('Studio.parameters.fields.frames')} onChange={update} disabled={props.disabled} min={1} step={1} />
      <NumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled} step={1} />
      <BooleanParameter current={parameters} field="generateAudio" label={t('Studio.parameters.fields.generateAudio')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="ratio" label={t('Studio.parameters.fields.ratio')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <NumberParameter current={parameters} field="durationSec" label={t('Studio.parameters.fields.durationSec')} onChange={update} disabled={props.disabled} min={0} cloudOnly source={props.source} />
      <NumberParameter current={parameters} field="fps" label={t('Studio.parameters.fields.fps')} onChange={update} disabled={props.disabled} min={1} step={1} cloudOnly source={props.source} />
      <BooleanParameter current={parameters} field="cameraFixed" label={t('Studio.parameters.fields.cameraFixed')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <BooleanParameter current={parameters} field="watermark" label={t('Studio.parameters.fields.watermark')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <BooleanParameter current={parameters} field="draft" label={t('Studio.parameters.fields.draft')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <BooleanParameter current={parameters} field="returnLastFrame" label={t('Studio.parameters.fields.returnLastFrame')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <TextParameter current={parameters} field="serviceTier" label={t('Studio.parameters.fields.serviceTier')} onChange={update} disabled={props.disabled} cloudOnly source={props.source} />
      <NumberParameter current={parameters} field="executionExpiresAfterSec" label={t('Studio.parameters.fields.executionExpiresAfterSec')} onChange={update} disabled={props.disabled} min={0} cloudOnly source={props.source} />
    </div>
  );
}

function SpeechSynthesizeFields(props: ParameterPanelProps<'audio.synthesize'>) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const parameters = props.parameters as TesterSpeechSynthesizeParameters;
  const update = props.onChange as (next: TesterSpeechSynthesizeParameters) => void;
  const [voices, setVoices] = useState<readonly { voiceAssetId: string; workflowType: string; status: string }[]>([]);
  const [voiceError, setVoiceError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void rendererHost.sdk.listLocalAppVoiceAssets().then(
      (assets) => { if (!cancelled) setVoices(assets); },
      (error) => { if (!cancelled) setVoiceError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { cancelled = true; };
  }, [rendererHost]);
  return (
    <div className="studio-parameters__grid">
      <ParameterField label={t('Studio.parameters.fields.voiceSource')}>
        <SelectField
          value={parameters.voiceKind}
          placeholder={t('Studio.parameters.runtimeDefault')}
          disabled={props.disabled}
          options={[
            { value: 'preset', label: t('Studio.parameters.voicePreset') },
            { value: 'asset', label: t('Studio.parameters.voiceAsset') },
          ]}
          onValueChange={(value) => update({ ...parameters, voiceKind: value as 'preset' | 'asset' })}
        />
      </ParameterField>
      {parameters.voiceKind === 'preset' ? (
        <TextParameter current={parameters} field="voicePreset" label={t('Studio.parameters.fields.voicePreset')} onChange={update} disabled={props.disabled} />
      ) : null}
      {parameters.voiceKind === 'asset' ? (
        <ParameterField label={t('Studio.parameters.fields.voiceAsset')}>
          <SelectField
            value={parameters.voiceAssetId}
            placeholder={voices.length ? t('Studio.parameters.selectVoiceAsset') : t('Studio.parameters.noVoiceAssets')}
            disabled={props.disabled || voices.length === 0}
            options={voices.map((voice) => ({ value: voice.voiceAssetId, label: `${voice.voiceAssetId} · ${voice.workflowType} · ${voice.status}` }))}
            onValueChange={(voiceAssetId) => update({ ...parameters, voiceAssetId })}
          />
          {voiceError ? <small>{voiceError}</small> : null}
        </ParameterField>
      ) : null}
      <TextParameter current={parameters} field="language" label={t('Studio.parameters.fields.language')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="audioFormat" label={t('Studio.parameters.fields.audioFormat')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="sampleRateHz" label={t('Studio.parameters.fields.sampleRateHz')} onChange={update} disabled={props.disabled} min={0} step={1} />
      <NumberParameter current={parameters} field="speed" label={t('Studio.parameters.fields.speed')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="pitch" label={t('Studio.parameters.fields.pitch')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="volume" label={t('Studio.parameters.fields.volume')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="emotion" label={t('Studio.parameters.fields.emotion')} onChange={update} disabled={props.disabled} />
      <ParameterField label={t('Studio.parameters.fields.timingMode')}>
        <SelectField
          value={parameters.timingMode}
          placeholder={t('Studio.parameters.runtimeDefault')}
          disabled={props.disabled}
          options={['unspecified', 'none', 'word', 'char'].map((value) => ({ value, label: value }))}
          onValueChange={(timingMode) => update({ ...parameters, timingMode: timingMode as TesterSpeechSynthesizeParameters['timingMode'] })}
        />
      </ParameterField>
    </div>
  );
}

function SpeechTranscribeFields(props: ParameterPanelProps<'audio.transcribe'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterSpeechTranscribeParameters;
  const update = props.onChange as (next: TesterSpeechTranscribeParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > MAX_TESTER_AUDIO_UPLOAD_BYTES) {
      setFileError(t('Studio.parameters.audioFileTooLarge'));
      return;
    }
    const mimeType = file.type || 'application/octet-stream';
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFileError('');
    update({ ...parameters, audioFile: { name: file.name, mimeType, sizeBytes: file.size, bytes }, mimeType });
  }
  return (
    <div className="studio-parameters__grid">
      <ParameterField label={t('Studio.parameters.fields.audioFile')}>
        <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" onChange={(event) => void selectFile(event)} />
        <div className="studio-parameters__file-row">
          <Button type="button" tone="ghost" size="sm" disabled={props.disabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
            {t('Studio.parameters.chooseAudioFile')}
          </Button>
          {parameters.audioFile ? <span>{parameters.audioFile.name}</span> : null}
          {parameters.audioFile ? <Button type="button" tone="ghost" size="sm" onClick={() => { const next = { ...parameters }; delete next.audioFile; update(next); }}>{t('Studio.parameters.removeFile')}</Button> : null}
        </div>
        {fileError ? <small>{fileError}</small> : null}
      </ParameterField>
      <TextParameter current={parameters} field="mimeType" label={t('Studio.parameters.fields.mimeType')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="language" label={t('Studio.parameters.fields.language')} onChange={update} disabled={props.disabled} />
      <BooleanParameter current={parameters} field="timestamps" label={t('Studio.parameters.fields.timestamps')} onChange={update} disabled={props.disabled} />
      <BooleanParameter current={parameters} field="diarization" label={t('Studio.parameters.fields.diarization')} onChange={update} disabled={props.disabled} />
      <NumberParameter current={parameters} field="speakerCount" label={t('Studio.parameters.fields.speakerCount')} onChange={update} disabled={props.disabled} min={0} step={1} />
      <TextParameter current={parameters} field="prompt" label={t('Studio.parameters.fields.transcriptionPrompt')} onChange={update} disabled={props.disabled} />
      <TextParameter current={parameters} field="responseFormat" label={t('Studio.parameters.fields.responseFormat')} onChange={update} disabled={props.disabled} />
    </div>
  );
}

export function CapabilityParameterPanel(props: ParameterPanelProps) {
  const { t } = useTranslation();
  let fields: ReactNode = null;
  if (props.capabilityId === 'text.generate' || props.capabilityId === 'chat.stream') fields = <TextGenerationFields {...props as ParameterPanelProps<'text.generate' | 'chat.stream'>} />;
  else if (props.capabilityId === 'text.embed') fields = <EmbeddingFields {...props as ParameterPanelProps<'text.embed'>} />;
  else if (props.capabilityId === 'image.generate') fields = <ImageFields {...props as ParameterPanelProps<'image.generate'>} />;
  else if (props.capabilityId === 'video.generate') fields = <VideoFields {...props as ParameterPanelProps<'video.generate'>} />;
  else if (props.capabilityId === 'audio.synthesize') fields = <SpeechSynthesizeFields {...props as ParameterPanelProps<'audio.synthesize'>} />;
  else if (props.capabilityId === 'audio.transcribe') fields = <SpeechTranscribeFields {...props as ParameterPanelProps<'audio.transcribe'>} />;
  if (!fields) return null;
  return (
    <section className="studio-parameters" aria-label={t('Studio.parameters.title')}>
      <div className="studio-parameters__head">
        <span>{t('Studio.parameters.presenceHint')}</span>
        <Button type="button" tone="ghost" size="sm" disabled={props.disabled} onClick={() => props.onChange((props.capabilityId === 'video.generate' ? { mode: 't2v', generateAudio: true } : {}) as never)}>
          {t('Studio.parameters.reset')}
        </Button>
      </div>
      {fields}
    </section>
  );
}
