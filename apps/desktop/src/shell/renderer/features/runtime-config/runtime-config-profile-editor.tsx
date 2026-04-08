/**
 * Profile editor — inline form for creating/editing a user-defined AIProfile.
 *
 * Reuses nimi-kit model picker primitives (ModelSelectorTrigger + ModelPickerModal)
 * and shared capability settings components (companion slots, image/video params).
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import type { AIProfile, AIProfileCapabilityIntent } from '@nimiplatform/sdk/mod';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import {
  ModelPickerModal,
  ModelSelectorTrigger,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { validateAIProfile } from '@nimiplatform/sdk/mod';
import {
  COMPANION_SLOTS,
  IMAGE_SIZE_PRESETS,
  IMAGE_RESPONSE_FORMAT_OPTIONS,
  DEFAULT_IMAGE_PARAMS,
  type ImageParamsState,
  VIDEO_RATIO_OPTIONS,
  VIDEO_MODE_OPTIONS,
  DEFAULT_VIDEO_PARAMS,
  type VideoParamsState,
  CompanionSlotSelector,
  useLocalAssets,
  FieldRow,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  FieldToggle,
  SubSectionLabel,
} from '../chat/capability-settings-shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORE_RUNTIME_MOD_ID = 'core:runtime';

type CapabilitySectionDef = {
  key: string;
  label: string;
  sdkCapability: string;
  group: 'basic' | 'image' | 'video';
};

const CAPABILITY_SECTIONS: CapabilitySectionDef[] = [
  { key: 'chat', label: 'Chat', sdkCapability: 'text.generate', group: 'basic' },
  { key: 'tts', label: 'TTS', sdkCapability: 'speech.synthesize', group: 'basic' },
  { key: 'image.generate', label: 'Image generation', sdkCapability: 'image.generate', group: 'image' },
  { key: 'image.edit', label: 'Image editing', sdkCapability: 'image.edit', group: 'image' },
  { key: 'video', label: 'Video', sdkCapability: 'video.generate', group: 'video' },
];

// ---------------------------------------------------------------------------
// Field primitives (profile-editor specific)
// ---------------------------------------------------------------------------

const FIELD_BASE = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 text-[13px] text-[var(--nimi-text-primary)] outline-none transition-colors hover:border-[var(--nimi-border-strong)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100';

function EditorFieldLabel(props: { label: string }) {
  return <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{props.label}</span>;
}

// ---------------------------------------------------------------------------
// Model picker per capability
// ---------------------------------------------------------------------------

function createCapabilityProvider(sdkCapability: string): RouteModelPickerDataProvider | null {
  try {
    const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    return createSnapshotRouteDataProvider(
      () => modClient.route.listOptions({
        capability: sdkCapability as Parameters<typeof modClient.route.listOptions>[0]['capability'],
      }),
    );
  } catch {
    return null;
  }
}

function CapabilityBindingEditor(props: {
  capabilityKey: string;
  sdkCapability: string;
  label: string;
  binding: RuntimeRouteBinding | null | undefined;
  onChange: (binding: RuntimeRouteBinding | null) => void;
}) {
  const { t } = useTranslation();
  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = createCapabilityProvider(props.sdkCapability);
  }
  const provider = providerRef.current;
  const [modalOpen, setModalOpen] = useState(false);

  const initialSelection = useMemo((): Partial<RouteModelPickerSelection> | undefined => {
    if (!props.binding) return undefined;
    return {
      source: props.binding.source || undefined,
      connectorId: props.binding.connectorId || undefined,
      model: props.binding.model || props.binding.localModelId || undefined,
      modelLabel: props.binding.modelLabel,
    };
  }, [props.binding]);

  const handleSelect = (selection: RouteModelPickerSelection) => {
    props.onChange({
      source: selection.source as 'local' | 'cloud',
      connectorId: selection.connectorId || '',
      model: selection.model || '',
      modelLabel: selection.modelLabel || '',
      localModelId: selection.source === 'local' ? (selection.model || '') : '',
    });
    setModalOpen(false);
  };

  if (!provider) {
    return (
      <div className="space-y-1.5">
        <EditorFieldLabel label={props.label} />
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-3 text-center text-[11px] text-gray-400">
          Runtime not available
        </div>
      </div>
    );
  }

  const source = props.binding?.source || null;
  const detail = source === 'cloud' && props.binding?.connectorId ? props.binding.connectorId : null;
  const displayLabel = props.binding?.modelLabel || props.binding?.model || props.binding?.localModelId || null;

  return (
    <div className="space-y-1.5">
      <EditorFieldLabel label={props.label} />
      <ModelSelectorTrigger
        source={source}
        modelLabel={displayLabel}
        detail={detail}
        placeholder={t('runtimeConfig.profiles.selectModel', { defaultValue: 'Select model...' })}
        onClick={() => setModalOpen(true)}
      />
      <ModelPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        capability={props.sdkCapability}
        capabilityLabel={props.label}
        provider={provider}
        initialSelection={initialSelection}
        onSelect={handleSelect}
      />
      {props.binding ? (
        <button
          type="button"
          className="text-[11px] text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)] transition-colors"
          onClick={() => props.onChange(null)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image params editor
// ---------------------------------------------------------------------------

function ImageParamsEditor(props: {
  params: ImageParamsState;
  onChange: (params: ImageParamsState) => void;
  companionSlots: Record<string, string>;
  onCompanionSlotChange: (slot: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];

  const updateParam = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="space-y-3 pt-1">
      <SubSectionLabel label={t('Chat.imageCompanionModels', { defaultValue: 'Companion Models' })} preview />
      <div className="grid grid-cols-2 gap-3">
        {COMPANION_SLOTS.map((slot) => (
          <CompanionSlotSelector
            key={slot.slot}
            slot={slot}
            value={props.companionSlots[slot.slot] || ''}
            onChange={(value) => props.onCompanionSlotChange(slot.slot, value)}
            assets={assets}
          />
        ))}
      </div>

      <SubSectionLabel label={t('Chat.imageParameters', { defaultValue: 'Parameters' })} preview />
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSize', { defaultValue: 'Size' })}>
          <FieldSelect
            value={props.params.size}
            onChange={(v) => updateParam('size', v)}
            options={IMAGE_SIZE_PRESETS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamResponseFormat', { defaultValue: 'Response format' })}>
          <FieldSelect
            value={props.params.responseFormat}
            onChange={(v) => updateParam('responseFormat', v)}
            options={IMAGE_RESPONSE_FORMAT_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSeed', { defaultValue: 'Seed' })} tooltip={t('Chat.imageParamSeedHint', { defaultValue: 'Optional seed for reproducibility' })}>
          <FieldInput value={props.params.seed} onChange={(v) => updateParam('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamTimeout', { defaultValue: 'Timeout (ms)' })}>
          <FieldInput value={props.params.timeoutMs} onChange={(v) => updateParam('timeoutMs', v)} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSteps', { defaultValue: 'Steps' })}>
          <FieldInput value={props.params.steps} onChange={(v) => updateParam('steps', v)} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamCfgScale', { defaultValue: 'CFG Scale' })}>
          <FieldInput value={props.params.cfgScale} onChange={(v) => updateParam('cfgScale', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSampler', { defaultValue: 'Sampler' })}>
          <FieldInput value={props.params.sampler} onChange={(v) => updateParam('sampler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamScheduler', { defaultValue: 'Scheduler' })}>
          <FieldInput value={props.params.scheduler} onChange={(v) => updateParam('scheduler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <FieldRow label={t('Chat.imageParamCustomOptions', { defaultValue: 'Custom options' })} tooltip={t('Chat.imageParamCustomOptionsHint', { defaultValue: 'One option per line. Example: diffusion_model' })}>
        <FieldTextarea value={props.params.optionsText} onChange={(v) => updateParam('optionsText', v)} placeholder={t('Chat.placeholderOnePerLine', { defaultValue: 'One option per line' })} rows={3} />
      </FieldRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video params editor
// ---------------------------------------------------------------------------

function VideoParamsEditor(props: {
  params: VideoParamsState;
  onChange: (params: VideoParamsState) => void;
}) {
  const { t } = useTranslation();

  const updateParam = <K extends keyof VideoParamsState>(key: K, value: VideoParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="space-y-3 pt-1">
      <SubSectionLabel label={t('Chat.videoParameters', { defaultValue: 'Parameters' })} preview />
      <FieldRow label={t('Chat.videoParamMode', { defaultValue: 'Mode' })}>
        <FieldSelect
          value={props.params.mode}
          onChange={(v) => updateParam('mode', v)}
          options={VIDEO_MODE_OPTIONS.map((m) => ({ value: m.value, label: t(m.i18nKey, { defaultValue: m.defaultLabel }) }))}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamRatio', { defaultValue: 'Aspect ratio' })}>
          <FieldSelect
            value={props.params.ratio}
            onChange={(v) => updateParam('ratio', v)}
            options={VIDEO_RATIO_OPTIONS.map((r) => ({ value: r, label: r }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamDuration', { defaultValue: 'Duration (sec)' })} tooltip={t('Chat.videoParamDurationHint', { defaultValue: 'Range: 1–11 seconds' })}>
          <FieldInput value={props.params.durationSec} onChange={(v) => updateParam('durationSec', v)} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamResolution', { defaultValue: 'Resolution' })}>
          <FieldInput value={props.params.resolution} onChange={(v) => updateParam('resolution', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamFps', { defaultValue: 'FPS' })}>
          <FieldInput value={props.params.fps} onChange={(v) => updateParam('fps', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamSeed', { defaultValue: 'Seed' })} tooltip={t('Chat.videoParamSeedHint', { defaultValue: 'Optional seed for reproducibility' })}>
          <FieldInput value={props.params.seed} onChange={(v) => updateParam('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamTimeout', { defaultValue: 'Timeout (ms)' })}>
          <FieldInput value={props.params.timeoutMs} onChange={(v) => updateParam('timeoutMs', v)} />
        </FieldRow>
      </div>
      <FieldToggle
        label={t('Chat.videoParamCameraFixed', { defaultValue: 'Fixed camera' })}
        checked={props.params.cameraFixed}
        onChange={(v) => updateParam('cameraFixed', v)}
      />
      <FieldToggle
        label={t('Chat.videoParamGenerateAudio', { defaultValue: 'Generate audio' })}
        checked={props.params.generateAudio}
        onChange={(v) => updateParam('generateAudio', v)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tags editor
// ---------------------------------------------------------------------------

function TagsEditor(props: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !props.tags.includes(trimmed)) {
      props.onChange([...props.tags, trimmed]);
    }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <EditorFieldLabel label={t('runtimeConfig.profiles.fieldTags', { defaultValue: 'Tags' })} />
      <div className="flex flex-wrap gap-1.5">
        {props.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-surface-card)] px-2.5 py-0.5 text-[11px] text-[var(--nimi-text-secondary)]">
            {tag}
            <button
              type="button"
              className="text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
              onClick={() => props.onChange(props.tags.filter((t) => t !== tag))}
            >
              x
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={`${FIELD_BASE} h-8`}
          placeholder={t('runtimeConfig.profiles.addTagPlaceholder', { defaultValue: 'Add tag...' })}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
        />
        <button
          type="button"
          className="shrink-0 rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 h-8 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
          onClick={addTag}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export type ProfileEditorProps = {
  initial: AIProfile;
  onSave: (profile: AIProfile) => void;
  onCancel: () => void;
};

export function ProfileEditor(props: ProfileEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AIProfile>(() => structuredClone(props.initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [imageParams, setImageParams] = useState<ImageParamsState>(() => {
    const stored = props.initial.capabilities['image.generate']?.params as Record<string, unknown> | undefined;
    if (!stored) return DEFAULT_IMAGE_PARAMS;
    return {
      size: typeof stored.size === 'string' ? stored.size : DEFAULT_IMAGE_PARAMS.size,
      responseFormat: typeof stored.responseFormat === 'string' ? stored.responseFormat : DEFAULT_IMAGE_PARAMS.responseFormat,
      seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_IMAGE_PARAMS.seed,
      timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_IMAGE_PARAMS.timeoutMs,
      steps: typeof stored.steps === 'string' ? stored.steps : DEFAULT_IMAGE_PARAMS.steps,
      cfgScale: typeof stored.cfgScale === 'string' ? stored.cfgScale : DEFAULT_IMAGE_PARAMS.cfgScale,
      sampler: typeof stored.sampler === 'string' ? stored.sampler : DEFAULT_IMAGE_PARAMS.sampler,
      scheduler: typeof stored.scheduler === 'string' ? stored.scheduler : DEFAULT_IMAGE_PARAMS.scheduler,
      optionsText: typeof stored.optionsText === 'string' ? stored.optionsText : DEFAULT_IMAGE_PARAMS.optionsText,
    };
  });
  const [videoParams, setVideoParams] = useState<VideoParamsState>(() => {
    const stored = props.initial.capabilities['video.generate']?.params as Record<string, unknown> | undefined;
    if (!stored) return DEFAULT_VIDEO_PARAMS;
    return {
      mode: typeof stored.mode === 'string' ? stored.mode : DEFAULT_VIDEO_PARAMS.mode,
      ratio: typeof stored.ratio === 'string' ? stored.ratio : DEFAULT_VIDEO_PARAMS.ratio,
      durationSec: typeof stored.durationSec === 'string' ? stored.durationSec : DEFAULT_VIDEO_PARAMS.durationSec,
      resolution: typeof stored.resolution === 'string' ? stored.resolution : DEFAULT_VIDEO_PARAMS.resolution,
      fps: typeof stored.fps === 'string' ? stored.fps : DEFAULT_VIDEO_PARAMS.fps,
      seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_VIDEO_PARAMS.seed,
      timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_VIDEO_PARAMS.timeoutMs,
      negativePrompt: typeof stored.negativePrompt === 'string' ? stored.negativePrompt : DEFAULT_VIDEO_PARAMS.negativePrompt,
      cameraFixed: typeof stored.cameraFixed === 'boolean' ? stored.cameraFixed : DEFAULT_VIDEO_PARAMS.cameraFixed,
      generateAudio: typeof stored.generateAudio === 'boolean' ? stored.generateAudio : DEFAULT_VIDEO_PARAMS.generateAudio,
    };
  });
  const [companionSlots, setCompanionSlots] = useState<Record<string, string>>(() => {
    const stored = props.initial.capabilities['image.generate']?.params as Record<string, unknown> | undefined;
    return (stored?.companionSlots && typeof stored.companionSlots === 'object')
      ? stored.companionSlots as Record<string, string>
      : {};
  });

  const updateField = <K extends keyof AIProfile>(key: K, value: AIProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateCapabilityBinding = (capKey: string, binding: RuntimeRouteBinding | null) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return {
        ...prev,
        capabilities: {
          ...prev.capabilities,
          [capKey]: { ...intent, binding },
        },
      };
    });
  };

  const updateCapabilityParams = (capKey: string, params: Record<string, unknown>) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return {
        ...prev,
        capabilities: {
          ...prev.capabilities,
          [capKey]: { ...intent, params },
        },
      };
    });
  };

  const handleImageParamsChange = (next: ImageParamsState) => {
    setImageParams(next);
    updateCapabilityParams('image.generate', { ...next, companionSlots });
  };

  const handleCompanionSlotChange = (slot: string, value: string) => {
    const next = { ...companionSlots, [slot]: value };
    setCompanionSlots(next);
    updateCapabilityParams('image.generate', { ...imageParams, companionSlots: next });
  };

  const handleVideoParamsChange = (next: VideoParamsState) => {
    setVideoParams(next);
    updateCapabilityParams('video.generate', next as unknown as Record<string, unknown>);
  };

  const handleSave = () => {
    const result = validateAIProfile(draft);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    props.onSave(draft);
  };

  // Track which image/video section has been opened
  const hasImageBinding = Boolean(draft.capabilities['image.generate']?.binding || draft.capabilities['image.edit']?.binding);
  const hasVideoBinding = Boolean(draft.capabilities['video.generate']?.binding);

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.initial.title ? t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' }) : t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
            onClick={props.onCancel}
          >
            {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            onClick={handleSave}
          >
            {t('runtimeConfig.profiles.save', { defaultValue: 'Save' })}
          </button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="rounded-xl border border-[var(--nimi-status-danger)]/20 bg-[var(--nimi-status-danger)]/5 px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
          {errors.map((err, i) => <div key={i}>{err}</div>)}
        </div>
      ) : null}

      {/* Basic info */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <EditorFieldLabel label={t('runtimeConfig.profiles.fieldTitle', { defaultValue: 'Title' })} />
          <input
            className={`${FIELD_BASE} h-10`}
            placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'My AI Profile' })}
            value={draft.title}
            onChange={(e) => updateField('title', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <EditorFieldLabel label={t('runtimeConfig.profiles.fieldDescription', { defaultValue: 'Description' })} />
          <textarea
            className={`${FIELD_BASE} min-h-[64px] py-2 resize-y`}
            placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: 'Describe this profile...' })}
            value={draft.description}
            onChange={(e) => updateField('description', e.target.value)}
          />
        </div>
        <TagsEditor tags={draft.tags} onChange={(tags) => updateField('tags', tags)} />
      </div>

      {/* Capability bindings */}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.profiles.capabilities', { defaultValue: 'Capabilities' })}
        </h4>
        <div className="space-y-4 pt-2">
          {CAPABILITY_SECTIONS.map((section) => (
            <div key={section.key}>
              <CapabilityBindingEditor
                capabilityKey={section.sdkCapability}
                sdkCapability={section.sdkCapability}
                label={section.label}
                binding={draft.capabilities[section.sdkCapability]?.binding}
                onChange={(binding) => updateCapabilityBinding(section.sdkCapability, binding)}
              />
              {/* Image settings inline after image.generate */}
              {section.sdkCapability === 'image.generate' && hasImageBinding ? (
                <ImageParamsEditor
                  params={imageParams}
                  onChange={handleImageParamsChange}
                  companionSlots={companionSlots}
                  onCompanionSlotChange={handleCompanionSlotChange}
                />
              ) : null}
              {/* Video settings inline after video.generate */}
              {section.sdkCapability === 'video.generate' && hasVideoBinding ? (
                <VideoParamsEditor
                  params={videoParams}
                  onChange={handleVideoParamsChange}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
