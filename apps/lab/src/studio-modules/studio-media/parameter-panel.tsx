import { useRef, useState, type ChangeEvent } from 'react';
import { Button, SelectField } from '@nimiplatform/kit/ui';
import { Trash2, Upload } from 'lucide-react';

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
  MAX_STUDIO_ARTIFACT_UPLOAD_BYTES,
  type StudioImageGenerationParameters,
  type StudioVideoGenerationParameters,
} from './parameters.js';

const STUDIO_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type StudioImageMimeType = typeof STUDIO_IMAGE_MIME_TYPES[number];

function isStudioImageMimeType(value: string): value is StudioImageMimeType {
  return STUDIO_IMAGE_MIME_TYPES.includes(value as StudioImageMimeType);
}

function ImageFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost();
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioImageGenerationParameters;
  const update = props.onChange as (next: StudioImageGenerationParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  async function selectReferenceImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_STUDIO_ARTIFACT_UPLOAD_BYTES) {
      setUploadError(t('Studio.parameters.imageFileTooLarge'));
      return;
    }
    if (!isStudioImageMimeType(file.type)) {
      setUploadError(t('Studio.parameters.imageFileMimeUnsupported'));
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const result = await host.sdk.uploadLocalAppArtifact({
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
  const updateReferenceUrl = (next: StudioImageGenerationParameters) => {
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
  const textField = (field: keyof StudioImageGenerationParameters, label: string, placeholder?: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const fields: StudioParameterFieldDefinition[] = [
    textField('negativePrompt', t('Studio.parameters.fields.negativePrompt')),
    {
      field: 'count',
      label: t('Studio.parameters.fields.count'),
      render: (routeDisabled) => <StudioNumberParameter current={parameters} field="count" label={t('Studio.parameters.fields.count')} onChange={update} disabled={props.disabled || routeDisabled} min={1} step={1} />,
    },
    textField('size', t('Studio.parameters.fields.size'), '1024x1024'),
    {
      field: 'seed',
      label: t('Studio.parameters.fields.seed'),
      render: (routeDisabled) => <StudioNumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled || routeDisabled} step={1} />,
    },
    textField('aspectRatio', t('Studio.parameters.fields.aspectRatio')),
    textField('quality', t('Studio.parameters.fields.quality')),
    textField('style', t('Studio.parameters.fields.style')),
    {
      field: 'referenceImage',
      label: t('Studio.parameters.fields.referenceImage'),
      render: (routeDisabled) => <StudioTextParameter current={parameters} field="referenceImage" label={t('Studio.parameters.fields.referenceImage')} placeholder="https://…" onChange={updateReferenceUrl} disabled={props.disabled || routeDisabled || uploading} />,
    },
    {
      field: 'referenceImageArtifactId',
      label: t('Studio.parameters.fields.referenceImageFile'),
      render: (routeDisabled) => (
        <StudioParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
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
        </StudioParameterField>
      ),
    },
    textField('mask', t('Studio.parameters.fields.mask'), 'https://…'),
  ];
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

function VideoFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost();
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioVideoGenerationParameters;
  const update = props.onChange as (next: StudioVideoGenerationParameters) => void;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  async function selectReferenceImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_STUDIO_ARTIFACT_UPLOAD_BYTES) {
      setUploadError(t('Studio.parameters.imageFileTooLarge'));
      return;
    }
    if (!isStudioImageMimeType(file.type)) {
      setUploadError(t('Studio.parameters.imageFileMimeUnsupported'));
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const result = await host.sdk.uploadLocalAppArtifact({
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
  const textField = (field: keyof StudioVideoGenerationParameters, label: string, placeholder?: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const numberField = (field: keyof StudioVideoGenerationParameters, label: string, min?: number): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioNumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} min={min} step={1} />,
  });
  const booleanField = (field: keyof StudioVideoGenerationParameters, label: string): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => <StudioBooleanParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled} />,
  });
  const modeLabel = t('Studio.parameters.fields.mode');
  const referenceLabel = t('Studio.parameters.fields.referenceArtifactId');
  const fields: StudioParameterFieldDefinition[] = [
    {
      field: 'mode',
      label: modeLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={modeLabel}>
          <SelectField
            value={parameters.mode ?? 't2v'}
            disabled={props.disabled || routeDisabled}
            options={[
              { value: 't2v', label: t('Studio.parameters.videoModeT2v') },
              { value: 'i2v-reference', label: t('Studio.parameters.videoModeReference') },
            ]}
            onValueChange={(value) => update({ ...parameters, mode: value as StudioVideoGenerationParameters['mode'] })}
          />
        </StudioParameterField>
      ),
    },
    ...(parameters.mode === 'i2v-reference' ? [{
      field: 'referenceArtifactId',
      label: referenceLabel,
      render: (routeDisabled: boolean) => (
        <div className="studio-parameters__reference-fields">
          <StudioTextParameter current={parameters} field="referenceArtifactId" label={referenceLabel} placeholder="artifact_…" onChange={update} disabled={props.disabled || routeDisabled || uploading} />
          <StudioParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
            <input ref={inputRef} className="studio-parameters__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectReferenceImage(event)} />
            <div className="studio-parameters__file-row">
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
                {uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}
              </Button>
              {uploadedFileName ? <span>{uploadedFileName}</span> : null}
            </div>
            {uploadError ? <small>{uploadError}</small> : null}
          </StudioParameterField>
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
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

export function StudioMediaParameterPanel(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const fields = props.capabilityId === 'image.generate'
    ? <ImageFields {...props} />
    : <VideoFields {...props} />;
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
