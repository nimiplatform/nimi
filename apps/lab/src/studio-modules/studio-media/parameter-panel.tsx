import { MusicFields } from './music-parameters.js';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button, SelectField, TextareaField } from '@nimiplatform/kit/ui';
import { Trash2, Upload } from 'lucide-react';

import {
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


function ImageLayerField(props: { parameters: StudioImageGenerationParameters; field: 'maskArtifactId' | 'markupArtifactId'; urlField: 'mask' | 'markup'; label: string; hint: string; disabled?: boolean; onChange: (next: StudioImageGenerationParameters) => void }) {
  const host = useAIStudioHost();
  const input = useRef<HTMLInputElement>(null);
  const [busy,setBusy] = useState(false);
  const [uploaded,setUploaded] = useState<{ artifactId: string; name: string } | null>(null);
  const [error,setError] = useState('');
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value=''; if (!file) return;
    if (file.type !== 'image/png' || file.size < 1 || file.size > MAX_STUDIO_ARTIFACT_UPLOAD_BYTES) { setError(host.translate('Studio.parameters.layerPngRequired')); return; }
    setBusy(true); setError('');
    try {
      const asset = await host.sdk.uploadLocalAppArtifact({bytes:new Uint8Array(await file.arrayBuffer()),mimeType:'image/png'});
      const next = {...props.parameters,[props.field]:asset.artifactId}; delete next[props.urlField]; props.onChange(next); setUploaded({artifactId:asset.artifactId,name:file.name});
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  return <StudioParameterField label={props.label}>
    <input ref={input} aria-label={props.label} className="studio-parameters__file-input" type="file" accept="image/png" disabled={props.disabled || busy} onChange={event=>void choose(event)} />
    <div className="studio-parameters__file-row"><Button type="button" tone="ghost" size="sm" disabled={props.disabled || busy} onClick={()=>input.current?.click()}>{host.translate(busy?'Studio.parameters.uploadingImage':'Studio.parameters.chooseImageFile')}</Button>{uploaded && uploaded.artifactId===props.parameters[props.field]?<span>{uploaded.name}</span>:null}{props.parameters[props.field]?<Button type="button" tone="ghost" size="sm" disabled={props.disabled || busy} onClick={()=>{const next={...props.parameters};delete next[props.field];props.onChange(next);setUploaded(null);setError('');}}>{host.translate('Studio.parameters.clearLayer')}</Button>:null}</div>
    {error?<small>{error}</small>:null}<small>{props.hint}</small>
  </StudioParameterField>;
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
  const [uploadedReference, setUploadedReference] = useState<{ artifactId: string; name: string } | null>(null);
  const imageMimes = props.source === 'cloud' ? ['image/png', 'image/jpeg', 'image/webp'] : STUDIO_IMAGE_MIME_TYPES;
  async function selectReferenceImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size === 0 || file.size > MAX_STUDIO_ARTIFACT_UPLOAD_BYTES) {
      setUploadError(t('Studio.parameters.imageFileTooLarge'));
      return;
    }
    if (!isStudioImageMimeType(file.type) || !imageMimes.includes(file.type as StudioImageMimeType)) {
      setUploadError(t(props.source === 'cloud' ? 'Studio.parameters.cloudImageFileMimeUnsupported' : 'Studio.parameters.imageFileMimeUnsupported'));
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
      setUploadedReference({ artifactId: result.artifactId, name: file.name });
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
    setUploadedReference(null);
    update(normalized);
  };
  const clearReferenceArtifact = () => {
    const normalized = { ...parameters };
    delete normalized.referenceImageArtifactId;
    setUploadedReference(null);
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
      render: (routeDisabled) => <StudioNumberParameter current={parameters} field="seed" label={t('Studio.parameters.fields.seed')} onChange={update} disabled={props.disabled || routeDisabled} min={-1} max={2147483647} step={1} />,
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
          <input ref={inputRef} aria-label={t('Studio.parameters.fields.referenceImageFile')} className="studio-parameters__file-input" type="file" accept={imageMimes.join(',')} disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectReferenceImage(event)} />
          <div className="studio-parameters__file-row">
            <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
              {uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}
            </Button>
            {uploadedReference && uploadedReference.artifactId === parameters.referenceImageArtifactId ? <span>{uploadedReference.name}</span> : null}
            {parameters.referenceImageArtifactId ? (
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Trash2 size={14} aria-hidden="true" />} onClick={clearReferenceArtifact}>
                {t('Studio.parameters.clearReferenceImage')}
              </Button>
            ) : null}
          </div>
          {uploadError ? <small>{uploadError}</small> : null}
          <small>{t(props.source === 'cloud' ? 'Studio.parameters.cloudImageReferenceHint' : 'Studio.parameters.imageReferenceHint')}</small>
        </StudioParameterField>
      ),
    },
    textField('mask', t('Studio.parameters.fields.mask'), 'https://…'),
    { field: 'maskArtifactId', label: t('Studio.parameters.fields.maskFile'), render: disabled => <ImageLayerField parameters={parameters} field="maskArtifactId" urlField="mask" label={t('Studio.parameters.fields.maskFile')} hint={t('Studio.parameters.maskFileHint')} onChange={update} disabled={props.disabled || disabled} /> },
    { field: 'complexity', label: t('Studio.parameters.fields.complexity'), render: disabled => <StudioParameterField label={t('Studio.parameters.fields.complexity')}><SelectField value={parameters.complexity || 'model-default'} options={[{value:'model-default',label:t('Studio.parameters.useDefault')},{value:'low',label:'low'},{value:'medium',label:'medium'},{value:'high',label:'high'}]} onChange={event => update({...parameters, complexity: (event.target.value === 'model-default' ? '' : event.target.value) as StudioImageGenerationParameters['complexity']})} disabled={props.disabled || disabled} /></StudioParameterField> },
    { field: 'outputFormat', label: t('Studio.parameters.fields.outputFormat'), render: disabled => <StudioParameterField label={t('Studio.parameters.fields.outputFormat')}><SelectField value={parameters.outputFormat || 'model-default'} options={[{value:'model-default',label:t('Studio.parameters.useDefault')},...['png','jpeg','webp','gif','svg'].map(value=>({value,label:value.toUpperCase()}))]} onChange={event => { const next = {...parameters, outputFormat: (event.target.value === 'model-default' ? '' : event.target.value) as StudioImageGenerationParameters['outputFormat']}; if (next.outputFormat !== 'gif') { delete next.frameCount; delete next.frameDurationMs; } update(next); }} disabled={props.disabled || disabled} /><small>{t('Studio.parameters.imageFormatHint')}</small></StudioParameterField> },
    textField('markup', t('Studio.parameters.fields.markup'), 'https://…'),
    { field: 'markupArtifactId', label: t('Studio.parameters.fields.markupFile'), render: disabled => <ImageLayerField parameters={parameters} field="markupArtifactId" urlField="markup" label={t('Studio.parameters.fields.markupFile')} hint={t('Studio.parameters.markupFileHint')} onChange={update} disabled={props.disabled || disabled} /> },
    { field: 'frameCount', label: t('Studio.parameters.fields.animationFrames'), render: disabled => <StudioNumberParameter current={parameters} field="frameCount" label={t('Studio.parameters.fields.animationFrames')} onChange={update} min={2} max={64} step={1} disabled={props.disabled || disabled || parameters.outputFormat !== 'gif'} /> },
    { field: 'frameDurationMs', label: t('Studio.parameters.fields.frameDurationMs'), render: disabled => <StudioNumberParameter current={parameters} field="frameDurationMs" label={t('Studio.parameters.fields.frameDurationMs')} onChange={update} min={20} max={2000} step={10} disabled={props.disabled || disabled || parameters.outputFormat !== 'gif'} /> },
  ];
  return <StudioRouteAwareParameterFields contract={props.contract} source={props.source} fields={fields} translate={translate} />;
}

type VideoArtifactField = 'firstFrameArtifactId' | 'lastFrameArtifactId' | 'referenceArtifactId' | 'referenceAudioArtifactIds' | 'referenceVideoArtifactIds';

function VideoFields(props: StudioParameterPanelProps & { readonly onUploadBusyChange: (busy: boolean) => void }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioVideoGenerationParameters;
  const update = props.onChange as (next: StudioVideoGenerationParameters) => void;
  const inputs = useRef<Record<VideoArtifactField, HTMLInputElement | null>>({ firstFrameArtifactId: null, lastFrameArtifactId: null, referenceArtifactId: null, referenceAudioArtifactIds: null, referenceVideoArtifactIds: null });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<{ field: VideoArtifactField; message: string } | null>(null);
  const [uploadedNames, setUploadedNames] = useState<Partial<Record<VideoArtifactField, { ids: string[]; names: string }>>>({});
  async function selectMedia(event: ChangeEvent<HTMLInputElement>, field: VideoArtifactField) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    if (files.some((file) => file.size === 0 || file.size > MAX_STUDIO_ARTIFACT_UPLOAD_BYTES)) {
      setUploadError({ field, message: t(field === 'referenceVideoArtifactIds' ? 'Studio.parameters.videoReferenceFileTooLarge' : field === 'referenceAudioArtifactIds' ? 'Studio.parameters.videoReferenceAudioFileTooLarge' : 'Studio.parameters.imageFileTooLarge') });
      return;
    }
    const uploads: Array<{ file: File; mimeType: StudioImageMimeType | 'audio/wav' | 'audio/mpeg' | 'video/mp4' }> = [];
    for (const file of files) {
      const detected = file.type;
      const mimeType = field === 'referenceVideoArtifactIds' ? (detected === 'video/mp4' ? detected : null) : field === 'referenceAudioArtifactIds'
        ? (detected === 'audio/wav' || detected === 'audio/mpeg' ? detected : null)
        : (isStudioImageMimeType(detected) ? detected : null);
      if (!mimeType) {
        setUploadError({ field, message: t(field === 'referenceVideoArtifactIds' ? 'Studio.parameters.videoReferenceMimeUnsupported' : field === 'referenceAudioArtifactIds' ? 'Studio.parameters.audioFileMimeUnsupported' : 'Studio.parameters.imageFileMimeUnsupported') });
        return;
      }
      uploads.push({ file, mimeType });
    }
    setUploading(true);
    props.onUploadBusyChange(true);
    setUploadError(null);
    try {
      const ids: string[] = [];
      for (const { file, mimeType } of uploads) {
        const result = await host.sdk.uploadLocalAppArtifact({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType });
        ids.push(result.artifactId);
      }
      const next = { ...parameters };
      if (field === 'referenceAudioArtifactIds' || field === 'referenceVideoArtifactIds') next[field] = ids;
      else next[field] = ids[0];
      if (field === 'firstFrameArtifactId') delete next.firstFrameImageUrl;
      if (field === 'lastFrameArtifactId') delete next.lastFrameImageUrl;
      if (field === 'referenceArtifactId') next.additionalReferenceArtifactIds = ids.slice(1);
      update(next);
      setUploadedNames((previous) => ({ ...previous, [field]: { ids, names: files.map((file) => file.name).join(', ') } }));
    } catch (error) {
      setUploadError({ field, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setUploading(false);
      props.onUploadBusyChange(false);
    }
  }
  const textField = (field: keyof StudioVideoGenerationParameters, label: string, placeholder?: string): StudioParameterFieldDefinition => ({
    field, label,
    render: (routeDisabled) => <StudioTextParameter current={parameters} field={field} label={label} placeholder={placeholder} onChange={(next) => {
      if (field === 'firstFrameImageUrl') delete next.firstFrameArtifactId;
      if (field === 'lastFrameImageUrl') delete next.lastFrameArtifactId;
      update(next);
    }} disabled={props.disabled || routeDisabled || uploading} />,
  });
  const numberField = (field: keyof StudioVideoGenerationParameters, label: string, min?: number): StudioParameterFieldDefinition => ({
    field, label,
    render: (routeDisabled) => <StudioNumberParameter current={parameters} field={field} label={label} onChange={update} disabled={props.disabled || routeDisabled || uploading} min={min} step={1} />,
  });
  const booleanField = (field: 'generateAudio' | 'cameraFixed' | 'watermark' | 'draft' | 'returnLastFrame', label: string): StudioParameterFieldDefinition => ({
    field, label,
    render: (routeDisabled) => <StudioParameterField label={label}>
      <SelectField aria-label={label} value={parameters[field] === undefined ? 'default' : parameters[field] ? 'on' : 'off'} disabled={props.disabled || routeDisabled || uploading}
        options={[{ value: 'default', label: t('Studio.parameters.videoBoolDefault') }, { value: 'on', label: t('Studio.parameters.videoBoolOn') }, { value: 'off', label: t('Studio.parameters.videoBoolOff') }]}
        onValueChange={(value) => { const next = { ...parameters }; if (value === 'default') delete next[field]; else next[field] = value === 'on'; update(next); }} />
    </StudioParameterField>,
  });
  const referenceUrls = (field: 'referenceVideoUrls' | 'referenceAudioUrls', label: string): StudioParameterFieldDefinition => ({
    field, label,
    render: (routeDisabled) => <StudioParameterField label={label}><TextareaField aria-label={label} value={(parameters[field] ?? []).join('\n')} placeholder="https://…" disabled={props.disabled || routeDisabled || uploading}
      onChange={(event) => update({ ...parameters, [field]: event.currentTarget.value.split('\n').map(value => value.trim()).filter(Boolean) })} /></StudioParameterField>,
  });
  const imageField = (field: Exclude<VideoArtifactField, 'referenceAudioArtifactIds' | 'referenceVideoArtifactIds'>, label: string): StudioParameterFieldDefinition => ({
    field, label,
    render: (routeDisabled) => <div className="studio-parameters__reference-fields">
      <StudioTextParameter current={parameters} field={field} label={label} placeholder="artifact_…" onChange={(next) => {
        if (field === 'firstFrameArtifactId') delete next.firstFrameImageUrl;
        if (field === 'lastFrameArtifactId') delete next.lastFrameImageUrl;
        update(next);
      }} disabled={props.disabled || routeDisabled || uploading} />
      <StudioParameterField label={t('Studio.parameters.fields.referenceImageFile')}>
        <input ref={(element) => { inputs.current[field] = element; }} aria-label={label} className="studio-parameters__file-input" type="file" multiple={field === 'referenceArtifactId'} accept="image/png,image/jpeg,image/webp,image/gif" disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectMedia(event, field)} />
        <div className="studio-parameters__file-row">
          <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputs.current[field]?.click()}>{uploading ? t('Studio.parameters.uploadingImage') : t('Studio.parameters.chooseImageFile')}</Button>
          {uploadedNames[field]?.ids.length === (field === 'referenceArtifactId' ? 1 + (parameters.additionalReferenceArtifactIds?.length ?? 0) : 1)
            && uploadedNames[field]?.ids.every((id, index) => id === (index === 0 ? parameters[field] : parameters.additionalReferenceArtifactIds?.[index - 1]))
            ? <span>{uploadedNames[field]?.names}</span> : null}
          {parameters[field] ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Trash2 size={14} aria-hidden="true" />} onClick={() => {
            const next = { ...parameters }; delete next[field];
            if (field === 'referenceArtifactId') delete next.additionalReferenceArtifactIds;
            update(next); setUploadedNames((previous) => ({ ...previous, [field]: undefined }));
          }}>{t('Studio.parameters.clearReferenceImage')}</Button> : null}
        </div>
        {uploadError?.field === field ? <small>{uploadError.message}</small> : null}
      </StudioParameterField>
    </div>,
  });
  const mediaReferences = (field: 'referenceAudioArtifactIds' | 'referenceVideoArtifactIds'): StudioParameterFieldDefinition => {
    const audio = field === 'referenceAudioArtifactIds';
    const label = t(audio ? 'Studio.parameters.fields.referenceAudioArtifactIds' : 'Studio.parameters.fields.referenceVideoArtifactIds');
    return { field, label,
      render: (routeDisabled) => <StudioParameterField label={label}>
        <TextareaField aria-label={label} value={(parameters[field] ?? []).join('\n')} rows={2} disabled={props.disabled || routeDisabled || uploading}
          onChange={(event) => update({ ...parameters, [field]: event.currentTarget.value.split('\n').map(value => value.trim()).filter(Boolean) })} />
        <input ref={element => { inputs.current[field] = element; }} aria-label={t(audio ? 'Studio.parameters.audioReferenceFiles' : 'Studio.parameters.videoReferenceFiles')} className="studio-parameters__file-input" type="file" multiple accept={audio ? 'audio/wav,audio/mpeg' : 'video/mp4'}
          disabled={props.disabled || routeDisabled || uploading} onChange={(event) => void selectMedia(event, field)} />
        <div className="studio-parameters__file-row">
          <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputs.current[field]?.click()}>{uploading ? t('Studio.parameters.uploadingReference') : t(audio ? 'Studio.parameters.chooseAudioReference' : 'Studio.parameters.chooseVideoReference')}</Button>
          {uploadedNames[field]?.ids.length === parameters[field]?.length && uploadedNames[field]?.ids.every((id,index)=>id === parameters[field]?.[index]) ? <span>{uploadedNames[field]?.names}</span> : null}
          {parameters[field]?.length ? <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled || uploading} leadingIcon={<Trash2 size={14} aria-hidden="true" />} onClick={() => { const next={...parameters}; delete next[field]; update(next); setUploadedNames(previous=>({...previous,[field]:undefined})); }}>{t(audio ? 'Studio.parameters.clearAudioReference' : 'Studio.parameters.clearVideoReference')}</Button> : null}
        </div>
        {uploadError?.field === field ? <small>{uploadError.message}</small> : null}
        <small>{t(audio ? 'Studio.parameters.audioReferenceOrderHint' : 'Studio.parameters.videoReferenceOrderHint')}</small>
      </StudioParameterField>,
    };
  };
  const firstFrame = parameters.mode === 'i2v-first-frame' || parameters.mode === 'i2v-first-last';
  const modeLabel = t('Studio.parameters.fields.mode');
  const fields: StudioParameterFieldDefinition[] = [
    { field: 'mode', label: modeLabel, render: (routeDisabled) => <StudioParameterField label={modeLabel}>
      <SelectField value={parameters.mode ?? 't2v'} disabled={props.disabled || routeDisabled || uploading}
        options={[
          { value: 't2v', label: t('Studio.parameters.videoModeT2v') },
          ...(props.source === 'cloud' ? [{ value: 'i2v-first-frame', label: t('Studio.parameters.videoModeFirstFrame') }, { value: 'i2v-first-last', label: t('Studio.parameters.videoModeFirstLast') }] : []),
          { value: 'i2v-reference', label: t('Studio.parameters.videoModeReference') },
        ]} onValueChange={(value) => update({ ...parameters, mode: value as StudioVideoGenerationParameters['mode'] })} />
    </StudioParameterField> },
    ...(firstFrame ? [imageField('firstFrameArtifactId', t('Studio.parameters.fields.firstFrameArtifactId')), textField('firstFrameImageUrl', t('Studio.parameters.fields.firstFrameImageUrl'), 'https://…')] : []),
    ...(parameters.mode === 'i2v-first-last' ? [imageField('lastFrameArtifactId', t('Studio.parameters.fields.lastFrameArtifactId')), textField('lastFrameImageUrl', t('Studio.parameters.fields.lastFrameImageUrl'), 'https://…')] : []),
    ...(parameters.mode === 'i2v-reference' ? [imageField('referenceArtifactId', t('Studio.parameters.fields.referenceArtifactId')), {
      field: 'additionalReferenceArtifactIds', label: t('Studio.parameters.fields.additionalReferenceArtifactIds'),
      render: (routeDisabled: boolean) => <StudioParameterField label={t('Studio.parameters.fields.additionalReferenceArtifactIds')}>
        <TextareaField value={(parameters.additionalReferenceArtifactIds ?? []).join('\n')} rows={2} disabled={props.disabled || routeDisabled || uploading} onChange={(event) => update({ ...parameters, additionalReferenceArtifactIds: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} />
      </StudioParameterField>,
    }, mediaReferences('referenceVideoArtifactIds'), mediaReferences('referenceAudioArtifactIds'), referenceUrls('referenceVideoUrls', t('Studio.parameters.fields.referenceVideoUrls')), referenceUrls('referenceAudioUrls', t('Studio.parameters.fields.referenceAudioUrls'))] : []),
    textField('negativePrompt', t('Studio.parameters.fields.negativePrompt')),
    textField('resolution', t('Studio.parameters.fields.resolution'), '720p'),
    numberField('frames', t('Studio.parameters.fields.frames'), 1),
    numberField('seed', t('Studio.parameters.fields.seed')),
    booleanField('generateAudio', t('Studio.parameters.fields.generateAudio')),
    textField('ratio', t('Studio.parameters.fields.ratio')),
    { field: 'durationSec', label: t('Studio.parameters.fields.durationSec'), render: (routeDisabled) => <>
      <StudioNumberParameter current={parameters} field="durationSec" label={t('Studio.parameters.fields.durationSec')} onChange={update} disabled={props.disabled || routeDisabled || uploading} min={-1} step={1} />
      <p className="studio-parameters__note">{t('Studio.parameters.videoDurationHint')}</p>
    </> },
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
  const [videoUploading, setVideoUploading] = useState(false);
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const fields = props.capabilityId === 'image.generate'
    ? <ImageFields {...props} />
    : props.capabilityId === 'video.generate'
      ? <VideoFields {...props} disabled={props.disabled || videoUploading} onUploadBusyChange={setVideoUploading} />
      : <MusicFields {...props} />;
  return (
    <StudioParameterPanelFrame
      translate={translate}
      disabled={props.disabled || videoUploading}
      onReset={() => props.onChange(props.contract.initial())}
    >
      {fields}
    </StudioParameterPanelFrame>
  );
}
