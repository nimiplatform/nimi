/**
 * Profile editor — two-page architecture.
 *
 * Page 1: Clean dashboard — left sticky identity form + right flat capability cards.
 * Page 2: Dedicated capability config — breadcrumb, sidebar nav, sectioned cards.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIProfile, AIProfileCapabilityIntent } from '@nimiplatform/sdk/mod';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import {
  ModelPickerModal,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { validateAIProfile } from '@nimiplatform/sdk/mod';
import {
  DEFAULT_IMAGE_PARAMS,
  type ImageParamsState,
  DEFAULT_VIDEO_PARAMS,
  type VideoParamsState,
} from '@nimiplatform/nimi-kit/features/model-config';
import { getDesktopRouteModelPickerProvider } from './desktop-route-model-picker-provider';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

import {
  CAPABILITY_SECTIONS,
  CapabilityCard,
  CapabilityConfigPage,
  EditorFieldLabel,
  FIELD_BASE,
  TagsEditor,
  type CapabilitySectionDef,
} from './runtime-config-profile-editor-components';

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
  const [configView, setConfigView] = useState<{ capKey: string; label: string } | null>(null);

  // Model picker state for Page 1 (simple capabilities without config pages)
  const [pickerCap, setPickerCap] = useState<CapabilitySectionDef | null>(null);
  const pickerProviderRef = useRef<RouteModelPickerDataProvider | null>(null);

  const openPicker = (section: CapabilitySectionDef) => {
    pickerProviderRef.current = getDesktopRouteModelPickerProvider(section.sdkCapability);
    setPickerCap(section);
  };

  // Image params state
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

  // Video params state
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

  // Companion slots state
  const [companionSlots, setCompanionSlots] = useState<Record<string, string>>(() => {
    const stored = props.initial.capabilities['image.generate']?.params as Record<string, unknown> | undefined;
    return (stored?.companionSlots && typeof stored.companionSlots === 'object')
      ? stored.companionSlots as Record<string, string>
      : {};
  });

  // State update functions (unchanged logic)
  const updateField = <K extends keyof AIProfile>(key: K, value: AIProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateCapabilityBinding = (capKey: string, binding: RuntimeRouteBinding | null) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return { ...prev, capabilities: { ...prev.capabilities, [capKey]: { ...intent, binding } } };
    });
  };

  const updateCapabilityParams = (capKey: string, params: Record<string, unknown>) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return { ...prev, capabilities: { ...prev.capabilities, [capKey]: { ...intent, params } } };
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

  const handleClearBinding = (capKey: string) => {
    updateCapabilityBinding(capKey, null);
    if (capKey === 'image.generate') {
      setImageParams(DEFAULT_IMAGE_PARAMS);
      setCompanionSlots({});
    }
    if (capKey === 'video.generate') {
      setVideoParams(DEFAULT_VIDEO_PARAMS);
    }
    setConfigView(null);
  };

  // ── Page 2: Capability Config ──
  if (configView) {
    return (
      <CapabilityConfigPage
        capKey={configView.capKey}
        capLabel={configView.label}
        profileTitle={draft.title}
        binding={draft.capabilities[configView.capKey]?.binding}
        onBindingChange={(b) => updateCapabilityBinding(configView.capKey, b)}
        sdkCapability={configView.capKey}
        imageParams={configView.capKey === 'image.generate' ? imageParams : undefined}
        onImageParamsChange={configView.capKey === 'image.generate' ? handleImageParamsChange : undefined}
        companionSlots={configView.capKey === 'image.generate' ? companionSlots : undefined}
        onCompanionSlotChange={configView.capKey === 'image.generate' ? handleCompanionSlotChange : undefined}
        videoParams={configView.capKey === 'video.generate' ? videoParams : undefined}
        onVideoParamsChange={configView.capKey === 'video.generate' ? handleVideoParamsChange : undefined}
        onBack={() => setConfigView(null)}
        onSave={handleSave}
        onClearBinding={() => handleClearBinding(configView.capKey)}
      />
    );
  }

  // ── Page 1: Edit Profile Dashboard ──
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-6 py-4">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.initial.title ? t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' }) : t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-card)]"
            onClick={props.onCancel}
          >
            {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            onClick={handleSave}
          >
            {t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
          </button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {errors.map((err, i) => <div key={i}>{err}</div>)}
        </div>
      ) : null}

      {/* Two-column grid body */}
      <div className="grid grid-cols-12 gap-8 p-6">
        {/* Left column: Profile Identity (sticky) */}
        <div className="col-span-5 self-start sticky top-0 space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.profileIdentity', { defaultValue: 'Profile Identity' })}
            </h4>
            <p className="text-[12px] text-slate-400">
              {t('runtimeConfig.profiles.profileIdentityHint', { defaultValue: 'Set the basic information and persona for this AI profile.' })}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <EditorFieldLabel label={t('runtimeConfig.profiles.fieldTitle', { defaultValue: 'Title' })} />
              <input
                className={`${FIELD_BASE} h-10`}
                placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'e.g. Code Assistant, Creative Writer...' })}
                value={draft.title}
                onChange={(e) => updateField('title', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <EditorFieldLabel label={t('runtimeConfig.profiles.fieldDescription', { defaultValue: 'Description' })} />
              <textarea
                className={`${FIELD_BASE} min-h-[96px] py-2.5 resize-y`}
                placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: "Describe this profile's purpose and system instructions..." })}
                value={draft.description}
                onChange={(e) => updateField('description', e.target.value)}
              />
            </div>
            <TagsEditor tags={draft.tags} onChange={(tags) => updateField('tags', tags)} />
          </div>
        </div>

        {/* Right column: Capabilities & Models (flat cards) */}
        <div className="col-span-7 space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.capabilitiesAndModels', { defaultValue: 'Capabilities & Models' })}
            </h4>
            <p className="text-[12px] text-slate-400">
              {t('runtimeConfig.profiles.capabilitiesHint', { defaultValue: 'Configure the specific models this profile will use for different tasks.' })}
            </p>
          </div>

          <div className="space-y-2.5">
            {CAPABILITY_SECTIONS.map((section) => {
              const binding = draft.capabilities[section.sdkCapability]?.binding;
              const hasBinding = Boolean(binding);
              return (
                <CapabilityCard
                  key={section.key}
                  section={section}
                  binding={binding}
                  onSelectModel={() => openPicker(section)}
                  onConfigure={() => {
                    if (hasBinding && section.hasConfigPage) {
                      setConfigView({ capKey: section.sdkCapability, label: section.label });
                    } else {
                      openPicker(section);
                    }
                  }}
                  onClear={() => handleClearBinding(section.sdkCapability)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Global model picker modal for Page 1 */}
      {pickerCap && pickerProviderRef.current ? (
        <ModelPickerModal
          open={Boolean(pickerCap)}
          onClose={() => setPickerCap(null)}
          capability={pickerCap.sdkCapability}
          capabilityLabel={pickerCap.label}
          provider={pickerProviderRef.current}
          initialSelection={
            draft.capabilities[pickerCap.sdkCapability]?.binding
              ? {
                  source: draft.capabilities[pickerCap.sdkCapability]!.binding!.source || undefined,
                  connectorId: draft.capabilities[pickerCap.sdkCapability]!.binding!.connectorId || undefined,
                  model: draft.capabilities[pickerCap.sdkCapability]!.binding!.model || draft.capabilities[pickerCap.sdkCapability]!.binding!.localModelId || undefined,
                  modelLabel: draft.capabilities[pickerCap.sdkCapability]!.binding!.modelLabel,
                }
              : undefined
          }
          onSelect={(selection: RouteModelPickerSelection) => {
            updateCapabilityBinding(pickerCap.sdkCapability, {
              source: selection.source as 'local' | 'cloud',
              connectorId: selection.connectorId || '',
              model: selection.model || '',
              modelLabel: selection.modelLabel || '',
              localModelId: selection.source === 'local' ? (selection.model || '') : '',
            });
            setPickerCap(null);
          }}
        />
      ) : null}
    </div>
  );
}
