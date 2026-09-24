import { useRef, useState, type ReactNode } from 'react';
import { Button, SelectField, TextField, TextareaField } from '@nimiplatform/kit/ui';
import { Plus, Trash2, Upload } from 'lucide-react';

import {
  StudioParameterField,
  StudioParameterPanelFrame,
  type StudioParameterPanelProps,
} from '../../ai-studio-core/parameter-fields.js';
import { useTranslation } from '../../shell/i18n/index.js';
import {
  LAB_FACE_SWAP_IMAGE_MIME_TYPES,
  LAB_FACE_SWAP_VIDEO_MIME_TYPE,
  isLabFaceSwapImage,
  isLabFaceSwapVideo,
  type LabImageFaceSwapParameters,
  type LabMediaFile,
  type LabVideoFaceSwapParameters,
} from './face-swap.js';
import type { LabTextAnnotateParameters } from './text-annotate.js';
import type { LabTextExchangeParameters } from './text-exchange.js';

function Frame(props: StudioParameterPanelProps & { readonly children: ReactNode; readonly localRouteOnly?: boolean }) {
  const { t } = useTranslation();
  return (
    <StudioParameterPanelFrame
      translate={(key, values) => t(key, values)}
      disabled={props.disabled}
      onReset={() => props.onChange(props.contract.initial())}
    >
      <div className="studio-parameters__stack">
        {props.children}
        {props.localRouteOnly ? <p className="text-sm opacity-70">{t('CapabilityTests.common.localRouteOnly')}</p> : null}
      </div>
    </StudioParameterPanelFrame>
  );
}

// Local-only inputs are not sent on a Cloud route, so they cannot be edited there.
function localInputsLocked(props: StudioParameterPanelProps): boolean {
  return props.disabled || props.source === 'cloud';
}

export function LabTextAnnotateParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  const parameters = props.parameters as LabTextAnnotateParameters;
  const update = (next: LabTextAnnotateParameters) => props.onChange(next);
  const documents = parameters.documents ?? [];
  const locked = localInputsLocked(props);
  return (
    <Frame {...props} localRouteOnly>
      <StudioParameterField label={t('CapabilityTests.textAnnotate.language')}>
        <TextField
          value={parameters.language ?? ''}
          disabled={locked}
          placeholder="en"
          onChange={(event) => update({ ...parameters, language: event.currentTarget.value.trim() })}
        />
      </StudioParameterField>
      <p className="text-sm opacity-70">{t('CapabilityTests.textAnnotate.languageHint')}</p>
      <StudioParameterField label={t('CapabilityTests.textAnnotate.additionalDocuments')}>
        <div className="studio-parameters__stack">
          {documents.map((value, index) => (
            <div className="studio-parameters__repeat" key={index}>
              <TextareaField
                rows={2}
                value={value}
                disabled={locked}
                aria-label={t('CapabilityTests.textAnnotate.documentLabel', { index: index + 2 })}
                onChange={(event) => update({ ...parameters, documents: documents.map((entry, itemIndex) => itemIndex === index ? event.currentTarget.value : entry) })}
              />
              <Button type="button" tone="ghost" size="sm" disabled={locked} onClick={() => update({ ...parameters, documents: documents.filter((_, itemIndex) => itemIndex !== index) })} aria-label={t('CapabilityTests.textAnnotate.removeDocument', { index: index + 2 })}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button type="button" tone="ghost" size="sm" disabled={locked || documents.length >= 63} leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => update({ ...parameters, documents: [...documents, ''] })}>
            {t('CapabilityTests.textAnnotate.addDocument')}
          </Button>
        </div>
      </StudioParameterField>
    </Frame>
  );
}

function MediaFilePicker({
  label,
  accept,
  file,
  disabled,
  valid,
  invalidMessage,
  onChange,
}: {
  readonly label: string;
  readonly accept: string;
  readonly file?: LabMediaFile;
  readonly disabled: boolean;
  readonly valid: (file: LabMediaFile) => boolean;
  readonly invalidMessage: string;
  readonly onChange: (file: LabMediaFile | undefined) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return (
    <StudioParameterField label={label}>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept={accept}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!selected) return;
          void selected.arrayBuffer().then((buffer) => {
            const next: LabMediaFile = { name: selected.name, mimeType: selected.type, sizeBytes: selected.size, bytes: new Uint8Array(buffer) };
            if (!valid(next)) {
              setError(invalidMessage);
              return;
            }
            setError('');
            onChange(next);
          }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
        }}
      />
      <div className="studio-parameters__repeat">
        <Button type="button" tone="secondary" size="sm" disabled={disabled} leadingIcon={<Upload size={14} aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
          {t('CapabilityTests.faceSwap.choose')}
        </Button>
        {file ? (
          <Button type="button" tone="ghost" size="sm" disabled={disabled} onClick={() => onChange(undefined)} aria-label={t('CapabilityTests.faceSwap.clear', { name: file.name })}>
            <Trash2 size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <span className="text-sm opacity-70">
        {file ? t('CapabilityTests.faceSwap.selected', { name: file.name, type: file.mimeType, size: file.sizeBytes }) : t('CapabilityTests.faceSwap.noneSelected')}
      </span>
      {error ? <span role="alert">{error}</span> : null}
    </StudioParameterField>
  );
}

export function LabImageFaceSwapParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  const parameters = props.parameters as LabImageFaceSwapParameters;
  const set = (patch: Partial<LabImageFaceSwapParameters>) => {
    const next: LabImageFaceSwapParameters = { ...parameters, ...patch };
    if (!next.reference) delete next.reference;
    if (!next.target) delete next.target;
    props.onChange(next);
  };
  const locked = localInputsLocked(props);
  return (
    <Frame {...props} localRouteOnly>
      <MediaFilePicker label={t('StudioResults.faceSwap.role.reference-image')} accept={LAB_FACE_SWAP_IMAGE_MIME_TYPES.join(',')} file={parameters.reference} disabled={locked} valid={isLabFaceSwapImage} invalidMessage={t('CapabilityTests.faceSwap.imageFileInvalid')} onChange={(reference) => set({ reference })} />
      <MediaFilePicker label={t('StudioResults.faceSwap.role.target-image')} accept={LAB_FACE_SWAP_IMAGE_MIME_TYPES.join(',')} file={parameters.target} disabled={locked} valid={isLabFaceSwapImage} invalidMessage={t('CapabilityTests.faceSwap.imageFileInvalid')} onChange={(target) => set({ target })} />
      <p className="text-sm opacity-70">{t('CapabilityTests.faceSwap.imageHint')}</p>
    </Frame>
  );
}

export function LabVideoFaceSwapParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  const parameters = props.parameters as LabVideoFaceSwapParameters;
  const set = (patch: Partial<LabVideoFaceSwapParameters>) => {
    const next: LabVideoFaceSwapParameters = { ...parameters, ...patch };
    if (!next.reference) delete next.reference;
    if (!next.target) delete next.target;
    props.onChange(next);
  };
  const locked = localInputsLocked(props);
  return (
    <Frame {...props} localRouteOnly>
      <MediaFilePicker label={t('StudioResults.faceSwap.role.reference-image')} accept={LAB_FACE_SWAP_IMAGE_MIME_TYPES.join(',')} file={parameters.reference} disabled={locked} valid={isLabFaceSwapImage} invalidMessage={t('CapabilityTests.faceSwap.imageFileInvalid')} onChange={(reference) => set({ reference })} />
      <MediaFilePicker label={t('StudioResults.faceSwap.role.target-video')} accept={LAB_FACE_SWAP_VIDEO_MIME_TYPE} file={parameters.target} disabled={locked} valid={isLabFaceSwapVideo} invalidMessage={t('CapabilityTests.faceSwap.videoFileInvalid')} onChange={(target) => set({ target })} />
      <StudioParameterField label={t('CapabilityTests.faceSwap.policyLabel')}>
        <SelectField
          value={parameters.noFacePolicy}
          placeholder={t('CapabilityTests.faceSwap.policyPlaceholder')}
          disabled={locked}
          options={[
            { value: 'fail', label: t('StudioResults.faceSwap.policies.fail') },
            { value: 'preserve-frame', label: t('StudioResults.faceSwap.policies.preserve-frame') },
          ]}
          onValueChange={(value) => set({ noFacePolicy: value === 'preserve-frame' ? 'preserve-frame' : 'fail' })}
        />
      </StudioParameterField>
      <p className="text-sm opacity-70">{t('CapabilityTests.faceSwap.videoHint')}</p>
    </Frame>
  );
}

export function LabTextExchangeParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  const parameters = props.parameters as LabTextExchangeParameters;
  const scenario = parameters.scenario === 'structured-output' ? 'structured-output' : 'tool-call';
  return (
    <Frame {...props}>
      <StudioParameterField label={t('CapabilityTests.textTools.scenario')}>
        <SelectField
          value={scenario}
          disabled={props.disabled}
          options={[
            { value: 'tool-call', label: t('CapabilityTests.textTools.toolScenario') },
            { value: 'structured-output', label: t('CapabilityTests.textTools.structuredScenario') },
          ]}
          onValueChange={(value) => props.onChange({ scenario: value === 'structured-output' ? 'structured-output' : 'tool-call' })}
        />
      </StudioParameterField>
      <p className="text-sm opacity-70">{t(scenario === 'tool-call' ? 'CapabilityTests.textTools.toolHint' : 'CapabilityTests.textTools.structuredHint')}</p>
    </Frame>
  );
}
