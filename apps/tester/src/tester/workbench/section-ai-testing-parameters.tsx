import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, SelectField, TextareaField, TextField, Toggle } from '@nimiplatform/kit/ui';
import { ChevronDown, Plus, Trash2, Upload } from 'lucide-react';
import { useTesterRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import type { TesterCapabilityId } from '../tester-capabilities.js';
import {
  MAX_TESTER_ARTIFACT_UPLOAD_BYTES,
  MAX_TESTER_AUDIO_UPLOAD_BYTES,
  MAX_TESTER_VOICE_REFERENCE_AUDIO_BYTES,
  type TesterCapabilityParameterState,
  type TesterEmbeddingParameters,
  type TesterImageGenerationParameters,
  type TesterSpeechSynthesizeParameters,
  type TesterSpeechTranscribeParameters,
  type TesterTextGenerationParameters,
  type TesterVideoGenerationParameters,
  type TesterVoiceCreateParameters,
} from '../tester-capability-parameters.js';
import { getTesterCapabilityParamPresentation, projectTesterCapabilityParamsForRoute } from '../tester-capability-params.js';
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
  children: ReactNode;
};

type RouteAwareParameterField = {
  field: string;
  label: string;
  render: (routeDisabled: boolean) => ReactNode;
};

function ParameterField({ label, children }: ParameterFieldProps) {
  return (
    <label className="studio-parameters__field">
      <span className="studio-parameters__label">{label}</span>
      {children}
    </label>
  );
}

function RouteAwareParameterFields({
  capabilityId,
  source,
  fields,
  contentClassName = 'studio-parameters__grid',
}: {
  capabilityId: TesterCapabilityId;
  source: TesterRunTargetSource;
  fields: readonly RouteAwareParameterField[];
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  const presentation = new Map(
    getTesterCapabilityParamPresentation(capabilityId, source).map((item) => [item.field, item]),
  );
  const available = fields.filter((field) => presentation.get(field.field)?.state !== 'disabled');
  const routeUnavailable = fields.filter((field) => (
    presentation.get(field.field)?.state === 'disabled'
    && presentation.get(field.field)?.unavailableBecause === 'route'
  ));
  const surfaceUnavailable = fields.filter((field) => (
    presentation.get(field.field)?.state === 'disabled'
    && presentation.get(field.field)?.unavailableBecause === 'local-app-surface'
  ));
  const renderAvailable = (field: RouteAwareParameterField) => {
    const item = presentation.get(field.field);
    if (item?.state === 'fixed') {
      return (
        <ParameterField key={field.field} label={field.label}>
          <span className="studio-parameters__fixed" role="status">
            {t('Studio.parameters.fixedValue', { value: item.fixedValue })}
          </span>
        </ParameterField>
      );
    }
    return <div className="studio-parameters__field-slot" key={field.field}>{field.render(false)}</div>;
  };
  return (
    <>
      <div className={contentClassName}>{available.map(renderAvailable)}</div>
      {routeUnavailable.length > 0 && (source === 'local' || source === 'cloud') ? (
        <details className="studio-parameters__route-group">
          <summary>
            <span>
              <strong>{t(source === 'local' ? 'Studio.parameters.cloudOnlyGroup' : 'Studio.parameters.localOnlyGroup')}</strong>
              <small>{t(source === 'local' ? 'Studio.parameters.switchToCloudHint' : 'Studio.parameters.switchToLocalHint')}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={contentClassName} aria-disabled="true">
            {routeUnavailable.map((field) => (
              <div className="studio-parameters__field-slot" key={field.field}>{field.render(true)}</div>
            ))}
          </div>
        </details>
      ) : null}
      {surfaceUnavailable.length > 0 ? (
        <details className="studio-parameters__route-group">
          <summary>
            <span>
              <strong>{t('Studio.parameters.localAppUnavailableGroup')}</strong>
              <small>{t('Studio.parameters.localAppUnavailableHint')}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={contentClassName} aria-disabled="true">
            {surfaceUnavailable.map((field) => (
              <div className="studio-parameters__field-slot" key={field.field}>{field.render(true)}</div>
            ))}
          </div>
        </details>
      ) : null}
    </>
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
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
}) {
  const value = current[field];
  return (
    <ParameterField label={label}>
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
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const value = current[field];
  return (
    <ParameterField label={label}>
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
}: {
  current: T;
  field: keyof T;
  label: string;
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <ParameterField label={label}>
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
  const numberField = (
    field: keyof TesterTextGenerationParameters,
    label: string,
    options: { min?: number; max?: number; step?: number | 'any' } = {},
  ): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <NumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} {...options} />,
  });
  const stopLabel = t('Studio.parameters.fields.stop');
  const fields: RouteAwareParameterField[] = [
    numberField('temperature', t('Studio.parameters.fields.temperature')),
    numberField('topP', t('Studio.parameters.fields.topP'), { min: 0, max: 1 }),
    numberField('maxTokens', t('Studio.parameters.fields.maxTokens'), { min: 0, step: 1 }),
    numberField('topK', t('Studio.parameters.fields.topK'), { min: 0, step: 1 }),
    numberField('presencePenalty', t('Studio.parameters.fields.presencePenalty')),
    numberField('frequencyPenalty', t('Studio.parameters.fields.frequencyPenalty')),
    {
      field: 'stop',
      label: stopLabel,
      render: (routeDisabled) => (
        <ParameterField label={stopLabel}>
          <TextareaField
            rows={3}
            value={parameters.stop?.join('\n') ?? ''}
            placeholder={t('Studio.parameters.stopPlaceholder')}
            disabled={props.disabled || routeDisabled}
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
      ),
    },
    numberField('seed', t('Studio.parameters.fields.seed'), { step: 1 }),
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
}

function EmbeddingFields(props: ParameterPanelProps<'text.embed'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterEmbeddingParameters;
  const values = parameters.inputs?.length ? parameters.inputs : [''];
  const updateValues = (nextValues: string[]) => {
    if (nextValues.some((value) => value.trim())) props.onChange({ inputs: nextValues });
    else props.onChange({});
  };
  const label = t('Studio.parameters.fields.inputs');
  const fields: RouteAwareParameterField[] = [{
    field: 'inputs',
    label,
    render: (routeDisabled) => (
      <div className="studio-parameters__stack">
        {values.map((value, index) => (
          <div className="studio-parameters__repeat" key={index}>
            <TextareaField
              rows={2}
              value={value}
              disabled={props.disabled || routeDisabled}
              aria-label={t('Studio.parameters.embeddingInput', { index: index + 1 })}
              placeholder={t('Studio.parameters.embeddingInputPlaceholder')}
              onChange={(event) => updateValues(values.map((entry, itemIndex) => itemIndex === index ? event.currentTarget.value : entry))}
            />
            {values.length > 1 ? (
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => updateValues(values.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('Studio.parameters.removeInput', { index: index + 1 })}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => updateValues([...values, ''])}>
          {t('Studio.parameters.addInput')}
        </Button>
      </div>
    ),
  }];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} contentClassName="studio-parameters__stack" />;
}

function ImageFields(props: ParameterPanelProps<'image.generate'>) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const parameters = props.parameters as TesterImageGenerationParameters;
  const update = props.onChange as (next: TesterImageGenerationParameters) => void;
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
      const next = { ...parameters, referenceImageArtifactId: result.artifactId };
      delete next.referenceImage;
      setUploadedFileName(file.name);
      update(next);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }
  const updateReferenceUrl = (next: TesterImageGenerationParameters) => {
    const normalized = { ...next };
    delete normalized.referenceImageArtifactId;
    setUploadedFileName('');
    update(normalized);
  };
  const clearReferenceArtifact = () => {
    const normalized = { ...parameters };
    delete normalized.referenceImageArtifactId;
    setUploadedFileName('');
    setUploadError('');
    update(normalized);
  };
  const textField = (field: keyof TesterImageGenerationParameters, label: string, placeholder?: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <TextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const fields: RouteAwareParameterField[] = [
    textField('negativePrompt', t('Studio.parameters.fields.negativePrompt')),
    {
      field: 'count',
      label: t('Studio.parameters.fields.count'),
      render: (routeDisabled) => <NumberParameter current={parameters} field="count" label={t('Studio.parameters.fields.count')} onChange={update} disabled={props.disabled || routeDisabled} min={1} step={1} />,
    },
    textField('size', t('Studio.parameters.fields.size'), '1024x1024'),
    {
      field: 'seed',
      label: t('Studio.parameters.fields.seed'),
      render: (routeDisabled) => <NumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled || routeDisabled} step={1} />,
    },
    textField('aspectRatio', t('Studio.parameters.fields.aspectRatio')),
    textField('quality', t('Studio.parameters.fields.quality')),
    textField('style', t('Studio.parameters.fields.style')),
    {
      field: 'referenceImage',
      label: t('Studio.parameters.fields.referenceImage'),
      render: (routeDisabled) => <TextParameter current={parameters} field="referenceImage" label={t('Studio.parameters.fields.referenceImage')} placeholder="https://…" onChange={updateReferenceUrl} disabled={props.disabled || routeDisabled || uploading} />,
    },
    {
      field: 'referenceImageArtifactId',
      label: t('Studio.parameters.fields.referenceImageFile'),
      render: (routeDisabled) => (
        <ParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
          <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectReferenceImage(event)} />
          <div className="studio-parameters__file-row">
            <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
              {uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}
            </Button>
            {uploadedFileName ? <span>{uploadedFileName}</span> : null}
            {parameters.referenceImageArtifactId ? (
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Trash2 size={14} aria-hidden="true" />} onClick={clearReferenceArtifact}>
                {t('Studio.parameters.clearReferenceImage')}
              </Button>
            ) : null}
          </div>
          {uploadError ? <small>{uploadError}</small> : null}
        </ParameterField>
      ),
    },
    textField('mask', t('Studio.parameters.fields.mask'), 'https://…'),
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
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
  const textField = (field: keyof TesterVideoGenerationParameters, label: string, placeholder?: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <TextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const numberField = (field: keyof TesterVideoGenerationParameters, label: string, min?: number): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <NumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} min={min} step={1} />,
  });
  const booleanField = (field: keyof TesterVideoGenerationParameters, label: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <BooleanParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const modeLabel = t('Studio.parameters.fields.mode');
  const referenceLabel = t('Studio.parameters.fields.referenceArtifactId');
  const fields: RouteAwareParameterField[] = [
    {
      field: 'mode',
      label: modeLabel,
      render: (routeDisabled) => (
        <ParameterField label={modeLabel}>
          <SelectField
            value={parameters.mode ?? 't2v'}
            disabled={props.disabled || routeDisabled}
            options={[
              { value: 't2v', label: t('Studio.parameters.videoModeT2v') },
              { value: 'i2v-reference', label: t('Studio.parameters.videoModeReference') },
            ]}
            onValueChange={(value) => update({ ...parameters, mode: value as TesterVideoGenerationParameters['mode'] })}
          />
        </ParameterField>
      ),
    },
    ...(parameters.mode === 'i2v-reference' ? [{
      field: 'referenceArtifactId',
      label: referenceLabel,
      render: (routeDisabled: boolean) => (
        <div className="studio-parameters__reference-fields">
          <TextParameter current={parameters} field="referenceArtifactId" label={referenceLabel} placeholder="artifact_…" onChange={update} disabled={props.disabled || routeDisabled || uploading} />
          <ParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
            <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectReferenceImage(event)} />
            <div className="studio-parameters__file-row">
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
                {uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}
              </Button>
              {uploadedFileName ? <span>{uploadedFileName}</span> : null}
            </div>
            {uploadError ? <small>{uploadError}</small> : null}
          </ParameterField>
        </div>
      ),
    }] : []),
    textField('negativePrompt', t('Studio.parameters.fields.negativePrompt')),
    textField('resolution', t('Studio.parameters.fields.resolution'), '720p'),
    numberField('frames', t('Studio.parameters.fields.frames'), 1),
    numberField('seed', t('Studio.parameters.fields.seed')),
    booleanField('generateAudio', t('Studio.parameters.fields.generateAudio')),
    textField('ratio', t('Studio.parameters.fields.ratio')),
    numberField('durationSec', t('Studio.parameters.fields.durationSec'), 0),
    numberField('fps', t('Studio.parameters.fields.fps'), 1),
    booleanField('cameraFixed', t('Studio.parameters.fields.cameraFixed')),
    booleanField('watermark', t('Studio.parameters.fields.watermark')),
    booleanField('draft', t('Studio.parameters.fields.draft')),
    booleanField('returnLastFrame', t('Studio.parameters.fields.returnLastFrame')),
    textField('serviceTier', t('Studio.parameters.fields.serviceTier')),
    numberField('executionExpiresAfterSec', t('Studio.parameters.fields.executionExpiresAfterSec'), 0),
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
}

function SpeechSynthesizeFields(props: ParameterPanelProps<'audio.synthesize'>) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const parameters = props.parameters as TesterSpeechSynthesizeParameters;
  const update = props.onChange as (next: TesterSpeechSynthesizeParameters) => void;
  const effectiveVoiceKind = projectTesterCapabilityParamsForRoute(
    'audio.synthesize',
    props.source,
    parameters,
  ).voiceKind;
  const [voices, setVoices] = useState<readonly { voiceAssetId: string; creationSource: string; status: string }[]>([]);
  const [voiceError, setVoiceError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void rendererHost.sdk.listLocalAppVoiceAssets().then(
      (assets) => { if (!cancelled) setVoices(assets); },
      (error) => { if (!cancelled) setVoiceError(error instanceof Error ? error.message : String(error)); },
    );
    return () => { cancelled = true; };
  }, [rendererHost]);
  const textField = (field: keyof TesterSpeechSynthesizeParameters, label: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <TextParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const numberField = (field: keyof TesterSpeechSynthesizeParameters, label: string, min?: number): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <NumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} min={min} />,
  });
  const voiceSourceLabel = t('Studio.parameters.fields.voiceSource');
  const timingModeLabel = t('Studio.parameters.fields.timingMode');
  const fields: RouteAwareParameterField[] = [
    {
      field: 'voiceKind',
      label: voiceSourceLabel,
      render: (routeDisabled) => (
        <ParameterField label={voiceSourceLabel}>
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
        </ParameterField>
      ),
    },
    ...(effectiveVoiceKind === 'preset' ? [textField('voicePreset', t('Studio.parameters.fields.voicePreset'))] : []),
    ...(effectiveVoiceKind === 'asset' ? [{
      field: 'voiceAssetId',
      label: t('Studio.parameters.fields.voiceAsset'),
      render: (routeDisabled: boolean) => (
        <ParameterField label={t('Studio.parameters.fields.voiceAsset')}>
          <SelectField
            value={parameters.voiceAssetId}
            placeholder={voices.length ? t('Studio.parameters.selectVoiceAsset') : t('Studio.parameters.noVoiceAssets')}
            disabled={props.disabled || routeDisabled || voices.length === 0}
            options={voices.map((voice) => ({ value: voice.voiceAssetId, label: `${voice.voiceAssetId} · ${voice.creationSource} · ${voice.status}` }))}
            onValueChange={(voiceAssetId) => update({ ...parameters, voiceAssetId })}
          />
          {voiceError ? <small>{voiceError}</small> : null}
        </ParameterField>
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
        <ParameterField label={timingModeLabel}>
          <SelectField
            value={parameters.timingMode}
            placeholder={t('Studio.parameters.runtimeDefault')}
            disabled={props.disabled || routeDisabled}
            options={['unspecified', 'none', 'word', 'char'].map((value) => ({ value, label: value }))}
            onValueChange={(timingMode) => update({ ...parameters, timingMode: timingMode as TesterSpeechSynthesizeParameters['timingMode'] })}
          />
        </ParameterField>
      ),
    },
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
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
  const textField = (field: keyof TesterSpeechTranscribeParameters, label: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <TextParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const booleanField = (field: keyof TesterSpeechTranscribeParameters, label: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <BooleanParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const audioFileLabel = t('Studio.parameters.fields.audioFile');
  const fields: RouteAwareParameterField[] = [
    {
      field: 'audioFile',
      label: audioFileLabel,
      render: (routeDisabled) => (
        <ParameterField label={audioFileLabel}>
          <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" disabled={props.disabled || routeDisabled} onChange={(event) => void selectFile(event)} />
          <div className="studio-parameters__file-row">
            <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
              {t('Studio.parameters.chooseAudioFile')}
            </Button>
            {parameters.audioFile ? <span>{parameters.audioFile.name}</span> : null}
            {parameters.audioFile ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => { const next = { ...parameters }; delete next.audioFile; update(next); }}>{t('Studio.parameters.removeFile')}</Button> : null}
          </div>
          {fileError ? <small>{fileError}</small> : null}
        </ParameterField>
      ),
    },
    textField('mimeType', t('Studio.parameters.fields.mimeType')),
    textField('language', t('Studio.parameters.fields.language')),
    booleanField('timestamps', t('Studio.parameters.fields.timestamps')),
    booleanField('diarization', t('Studio.parameters.fields.diarization')),
    {
      field: 'speakerCount',
      label: t('Studio.parameters.fields.speakerCount'),
      render: (routeDisabled) => <NumberParameter current={parameters} field="speakerCount" label={t('Studio.parameters.fields.speakerCount')} onChange={update} disabled={props.disabled || routeDisabled} min={0} step={1} />,
    },
    textField('prompt', t('Studio.parameters.fields.transcriptionPrompt')),
    textField('responseFormat', t('Studio.parameters.fields.responseFormat')),
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
}

function VoiceCreateFields(props: ParameterPanelProps<'voice.create'>) {
  const { t } = useTranslation();
  const parameters = props.parameters as TesterVoiceCreateParameters;
  const update = props.onChange as (next: TesterVoiceCreateParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const creationSource = parameters.creationSource ?? 'reference-audio';
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_TESTER_VOICE_REFERENCE_AUDIO_BYTES) {
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
  const textField = (field: keyof TesterVoiceCreateParameters, label: string, placeholder?: string): RouteAwareParameterField => ({
    field,
    label,
    render: (routeDisabled) => <TextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const sourceLabel = t('Studio.parameters.fields.creationSource');
  const fields: RouteAwareParameterField[] = [
    {
      field: 'creationSource',
      label: sourceLabel,
      render: (routeDisabled) => (
        <ParameterField label={sourceLabel}>
          <SelectField
            value={creationSource}
            disabled={props.disabled || routeDisabled}
            options={[
              { value: 'reference-audio', label: t('Studio.parameters.voiceSourceReferenceAudio') },
              { value: 'text-description', label: t('Studio.parameters.voiceSourceTextDescription') },
            ]}
            onValueChange={(value) => update({ ...parameters, creationSource: value as TesterVoiceCreateParameters['creationSource'] })}
          />
        </ParameterField>
      ),
    },
    ...(creationSource === 'reference-audio' ? [
      {
        field: 'referenceAudioFile',
        label: t('Studio.parameters.fields.referenceAudioFile'),
        render: (routeDisabled: boolean) => (
          <ParameterField label={t('Studio.parameters.fields.referenceAudioFile')}>
            <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac" disabled={props.disabled || routeDisabled} onChange={(event) => void selectFile(event)} />
            <div className="studio-parameters__file-row">
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
                {t('Studio.parameters.chooseAudioFile')}
              </Button>
              {parameters.referenceAudioFile ? <span>{parameters.referenceAudioFile.name}</span> : null}
              {parameters.referenceAudioFile ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => { const next = { ...parameters }; delete next.referenceAudioFile; update(next); }}>{t('Studio.parameters.removeFile')}</Button> : null}
            </div>
            {fileError ? <small>{fileError}</small> : null}
          </ParameterField>
        ),
      },
      textField('languageHints', t('Studio.parameters.fields.languageHints'), 'zh, en'),
    ] : [
      textField('previewText', t('Studio.parameters.fields.previewText')),
      textField('language', t('Studio.parameters.fields.language'), 'zh'),
    ]),
    textField('preferredName', t('Studio.parameters.fields.preferredName')),
  ];
  return <RouteAwareParameterFields capabilityId={props.capabilityId} source={props.source} fields={fields} />;
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
  else if (props.capabilityId === 'voice.create') fields = <VoiceCreateFields {...props as ParameterPanelProps<'voice.create'>} />;
  if (!fields) return null;
  return (
    <section className="studio-parameters" aria-label={t('Studio.parameters.title')}>
      <div className="studio-parameters__head">
        <span>{t('Studio.parameters.presenceHint')}</span>
        <Button type="button" tone="ghost" size="sm" disabled={props.disabled} onClick={() => props.onChange((props.capabilityId === 'video.generate' ? { mode: 't2v', generateAudio: true } : props.capabilityId === 'voice.create' ? { creationSource: 'text-description' } : {}) as never)}>
          {t('Studio.parameters.reset')}
        </Button>
      </div>
      {fields}
    </section>
  );
}
