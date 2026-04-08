import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { ImageCapabilitySettings } from './chat-image-capability-settings';
import { VideoCapabilitySettings } from './chat-video-capability-settings';
import { useQuery } from '@tanstack/react-query';
import { createModRuntimeClient, type RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import {
  ModelPickerModal,
  ModelSelectorTrigger,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  type ConversationCapability,
  type ConversationCapabilityProjection,
  toRuntimeCanonicalCapability,
  toRuntimeRouteBindingFromPickerSelection,
  type RuntimeLocalProfileRef,
} from './conversation-capability';
import {
  DisabledSettingsNote,
} from './chat-settings-panel';
import { RuntimeInspectCard } from './chat-runtime-inspect-content';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  DEFAULT_IMAGE_PARAMS,
  type ImageParamsState,
  DEFAULT_VIDEO_PARAMS,
  type VideoParamsState,
} from './capability-settings-shared';

const CORE_RUNTIME_MOD_ID = 'core:runtime';

type ConversationCapabilitySettingsSectionProps = {
  section: 'voice' | 'visual' | 'image' | 'video';
};

type CapabilityConfig = {
  capability: ConversationCapability;
  title: string;
  detail: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toSelection(binding: RuntimeRouteBinding | null | undefined): Partial<RouteModelPickerSelection> {
  if (!binding) {
    return {
      source: 'local',
      connectorId: '',
      model: '',
    };
  }
  return {
    source: binding.source === 'cloud' ? 'cloud' : 'local',
    connectorId: normalizeText(binding.connectorId),
    model: binding.source === 'local'
      ? (normalizeText(binding.localModelId) || normalizeText(binding.model))
      : (normalizeText(binding.model) || normalizeText(binding.modelId)),
  };
}

function summarizeRouteBinding(
  binding: Pick<RuntimeRouteBinding, 'source' | 'connectorId' | 'provider' | 'engine' | 'modelId' | 'model' | 'localModelId'> | null | undefined,
): { label: string; detail: string | null } {
  if (!binding) {
    return {
      label: 'Route not selected',
      detail: null,
    };
  }
  if (binding.source === 'local') {
    const provider = normalizeText(binding.provider) || normalizeText(binding.engine) || 'Local runtime';
    const model = normalizeText(binding.model) || normalizeText(binding.modelId) || normalizeText(binding.localModelId) || 'Unknown model';
    return {
      label: 'Local runtime',
      detail: [provider, model].filter(Boolean).join(' · '),
    };
  }
  const provider = normalizeText(binding.provider) || normalizeText(binding.connectorId) || 'Cloud route';
  const model = normalizeText(binding.model) || normalizeText(binding.modelId) || 'Unknown model';
  return {
    label: provider,
    detail: model,
  };
}

function buildProjectionStatus(
  t: ReturnType<typeof useTranslation>['t'],
  capabilityLabel: string,
  projection: ConversationCapabilityProjection | null | undefined,
  selectedBinding: RuntimeRouteBinding | null | undefined,
): {
  badge: string;
  value: string;
  detail: string | null;
  supported: boolean;
} {
  const summary = summarizeRouteBinding(projection?.resolvedBinding || selectedBinding);
  if (projection?.supported && projection.resolvedBinding) {
    return {
      badge: t('Chat.settingsCapabilityReady', { defaultValue: 'Ready' }),
      value: summary.label,
      detail: summary.detail,
      supported: true,
    };
  }

  if (projection?.reasonCode === 'profile_ref_missing') {
    return {
      badge: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
      value: t('Chat.settingsImageProfileRequired', { defaultValue: 'Local image profile required' }),
      detail: t('Chat.settingsImageProfileRequiredHint', {
        defaultValue: 'Select a local image profile in your AI configuration before using this capability.',
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'selection_missing' || projection?.reasonCode === 'selection_cleared') {
    return {
      badge: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
      value: t('Chat.settingsRouteUnavailable', { defaultValue: 'Route unavailable' }),
      detail: t('Chat.settingsCapabilityRouteRequired', {
        defaultValue: 'Select a route for {{capability}}.',
        capability: capabilityLabel,
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'binding_unresolved') {
    return {
      badge: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      value: t('Chat.settingsSelectedRouteUnavailable', { defaultValue: 'Selected route unavailable' }),
      detail: t('Chat.settingsSelectedRouteUnavailableHint', {
        defaultValue: 'The selected route can no longer be resolved.',
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'route_unhealthy') {
    return {
      badge: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      value: t('Chat.settingsRouteUnhealthy', { defaultValue: 'Route unhealthy' }),
      detail: t('Chat.settingsRouteUnhealthyHint', {
        defaultValue: 'The selected route failed the latest health check.',
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'metadata_missing') {
    return {
      badge: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      value: t('Chat.settingsRouteMetadataUnavailable', { defaultValue: 'Route metadata unavailable' }),
      detail: t('Chat.settingsRouteMetadataUnavailableHint', {
        defaultValue: 'This capability cannot execute until runtime describe metadata is available.',
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'capability_unsupported') {
    return {
      badge: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      value: t('Chat.settingsCapabilityUnsupported', { defaultValue: 'Capability unsupported' }),
      detail: t('Chat.settingsCapabilityUnsupportedHint', {
        defaultValue: 'The current runtime does not expose this capability.',
      }),
      supported: false,
    };
  }

  if (projection?.reasonCode === 'host_denied') {
    return {
      badge: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      value: t('Chat.settingsCapabilityDenied', { defaultValue: 'Capability denied' }),
      detail: t('Chat.settingsCapabilityDeniedHint', {
        defaultValue: 'The host denied this capability for the current conversation surface.',
      }),
      supported: false,
    };
  }

  return {
    badge: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
    value: summary.label,
    detail: summary.detail || t('Chat.settingsCapabilityRouteRequired', {
      defaultValue: 'Select a route for {{capability}}.',
      capability: capabilityLabel,
    }),
    supported: false,
  };
}

function supportsImageCapability(value: unknown): boolean {
  const normalized = normalizeText(value);
  return normalized === 'image'
    || normalized === 'image.generate'
    || normalized === 'image.edit';
}

function normalizeProfileRefLabel(profileRef: RuntimeLocalProfileRef | null): string | null {
  if (!profileRef) {
    return null;
  }
  const modId = normalizeText(profileRef.modId);
  const profileId = normalizeText(profileRef.profileId);
  if (!modId || !profileId) {
    return null;
  }
  return `${modId}:${profileId}`;
}

function useCapabilityModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  const keyRef = useRef<string>(capability);
  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  // Recreate provider when capability changes
  if (!providerRef.current || keyRef.current !== capability) {
    keyRef.current = capability;
    try {
      const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
      providerRef.current = createSnapshotRouteDataProvider(
        () => modClient.route.listOptions({
          capability: capability as Parameters<typeof modClient.route.listOptions>[0]['capability'],
        }),
      );
    } catch {
      providerRef.current = null;
    }
  }
  return providerRef.current;
}

function CapabilityRouteSettingCard(props: CapabilityConfig & { localContent?: ReactNode; onClear?: () => void }) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const selectedBinding = useAppStore((state) => state.aiConfig.capabilities.selectedBindings[props.capability]) as RuntimeRouteBinding | null | undefined;
  const projection = useAppStore((state) => state.conversationCapabilityProjectionByCapability[props.capability] || null);
  const capabilitySurface = useMemo(() => getDesktopAIConfigService(), []);
  const aiConfigForBinding = useAppStore((state) => state.aiConfig);
  const runtimeCapability = toRuntimeCanonicalCapability(props.capability);
  const provider = useCapabilityModelPickerProvider(runtimeCapability);
  const status = useMemo(
    () => buildProjectionStatus(t, props.title, projection, selectedBinding),
    [projection, props.title, selectedBinding, t],
  );
  const selection = useMemo(() => toSelection(selectedBinding), [selectedBinding]);
  const displayLabel = selectedBinding?.modelLabel || null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tooltip content={props.detail} placement="top">
          <span className="text-xs font-medium text-slate-500">{props.title}</span>
        </Tooltip>
        {!status.supported ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title={status.badge} />
        ) : null}
      </div>

      {provider ? (
        <>
          <ModelSelectorTrigger
            source={selection.source || null}
            modelLabel={displayLabel}
            placeholder={t('Chat.settingsSelectModel', { defaultValue: 'Select a model' })}
            onClick={() => setModalOpen(true)}
          />
          <ModelPickerModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            capability={runtimeCapability}
            capabilityLabel={props.title}
            provider={provider}
            initialSelection={selection}
            onSelect={(pickerSelection: RouteModelPickerSelection) => {
              const binding = toRuntimeRouteBindingFromPickerSelection({
                capability: props.capability,
                selection: pickerSelection,
              });
              const nextBindings = { ...aiConfigForBinding.capabilities.selectedBindings };
              if (binding === undefined) {
                delete nextBindings[props.capability];
              } else {
                nextBindings[props.capability] = binding as RuntimeRouteBinding | null;
              }
              const nextConfig = {
                ...aiConfigForBinding,
                capabilities: {
                  ...aiConfigForBinding.capabilities,
                  selectedBindings: nextBindings,
                },
              };
              capabilitySurface.aiConfig.update(nextConfig.scopeRef, nextConfig);
            }}
          />
        </>
      ) : (
        <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
      )}
      {props.localContent && selectedBinding?.source === 'local' ? props.localContent : null}
    </div>
  );
}

function hasImageCapability(profile: { capabilities: Record<string, unknown> }): boolean {
  return Object.keys(profile.capabilities).some(supportsImageCapability);
}

function ImageProfileSelectorCard() {
  const { t } = useTranslation();
  // Read the image capability's local profile ref from AIConfig (D-AIPC-008).
  // This is an internal capability sub-setting, not a top-level product concept.
  const imageCapabilityLocalRef = useAppStore((state) => (state.aiConfig.capabilities.localProfileRefs['image.generate'] || null) as RuntimeLocalProfileRef | null);
  const aiConfig = useAppStore((state) => state.aiConfig);
  const surface = useMemo(() => getDesktopAIConfigService(), []);

  const profileQuery = useQuery({
    queryKey: ['ai-profiles', 'surface', 'image'],
    queryFn: () => surface.aiProfile.list(),
  });

  const profiles = useMemo(
    () => (profileQuery.data || []).filter(hasImageCapability),
    [profileQuery.data],
  );
  const selectedValue = normalizeText(imageCapabilityLocalRef?.profileId);
  const selectedExternalLabel = useMemo(() => {
    const current = normalizeProfileRefLabel(imageCapabilityLocalRef);
    if (!current) {
      return null;
    }
    const known = profiles.some((profile) => (
      normalizeText(profile.profileId) === normalizeText(imageCapabilityLocalRef?.profileId)
    ));
    return known ? null : current;
  }, [imageCapabilityLocalRef, profiles]);

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('Chat.settingsImageProfileTitle', { defaultValue: 'Local image profile' })}
        </div>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('Chat.settingsImageProfileHint', {
            defaultValue: 'Selects the local asset bundle for image capabilities within the current AI configuration.',
          })}
        </p>
      </div>

      <RuntimeInspectCard
        label={t('Chat.settingsSelectedImageProfile', { defaultValue: 'Active profile' })}
        value={profiles.find((profile) => normalizeText(profile.profileId) === selectedValue)?.title
          || selectedExternalLabel
          || t('Chat.settingsImageProfileUnset', { defaultValue: 'No profile selected' })}
        detail={profiles.find((profile) => normalizeText(profile.profileId) === selectedValue)?.description
          || (selectedExternalLabel
            ? t('Chat.settingsExternalImageProfileHint', {
              defaultValue: 'Using an existing profile ref that is not published by core runtime.',
            })
            : t('Chat.settingsImageProfileUnsetHint', {
              defaultValue: 'Select a profile to enable image.generate and image.edit capabilities.',
            }))}
      />

      <label className="block space-y-2">
        <span className="text-xs font-semibold text-[var(--nimi-text-muted)]">
          {t('Chat.settingsImageProfileSelect', { defaultValue: 'Profile' })}
        </span>
        <select
          className="h-10 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
          disabled={profileQuery.isPending || (profiles.length === 0 && !selectedExternalLabel)}
          value={selectedExternalLabel ? '__external__' : selectedValue}
          onChange={(event) => {
            const nextValue = normalizeText(event.target.value);
            if (!nextValue || nextValue === '__none__') {
              const nextRefs = { ...aiConfig.capabilities.localProfileRefs };
              delete nextRefs['image.generate'];
              delete nextRefs['image.edit'];
              const nextConfig = {
                ...aiConfig,
                capabilities: { ...aiConfig.capabilities, localProfileRefs: nextRefs },
              };
              surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
              return;
            }
            if (nextValue === '__external__') {
              return;
            }
            const ref = { modId: CORE_RUNTIME_MOD_ID, profileId: nextValue };
            const nextConfig = {
              ...aiConfig,
              capabilities: {
                ...aiConfig.capabilities,
                localProfileRefs: {
                  ...aiConfig.capabilities.localProfileRefs,
                  'image.generate': ref,
                  'image.edit': ref,
                },
              },
            };
            surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
          }}
        >
          <option value="__none__">
            {t('Chat.settingsImageProfileNone', { defaultValue: 'No profile' })}
          </option>
          {selectedExternalLabel ? (
            <option value="__external__">
              {selectedExternalLabel}
            </option>
          ) : null}
          {profiles.map((profile) => (
            <option key={profile.profileId} value={profile.profileId}>
              {profile.title}
            </option>
          ))}
        </select>
      </label>

      {profileQuery.isPending ? (
        <DisabledSettingsNote label={t('Chat.settingsLoading', { defaultValue: 'Loading models...' })} />
      ) : null}
      {profileQuery.isError ? (
        <DisabledSettingsNote
          label={profileQuery.error instanceof Error
            ? profileQuery.error.message
            : t('Chat.settingsImageProfileLoadFailed', { defaultValue: 'Failed to load image profiles.' })}
        />
      ) : null}
      {!profileQuery.isPending && !profileQuery.isError && profiles.length === 0 ? (
        <DisabledSettingsNote
          label={t('Chat.settingsNoImageProfiles', { defaultValue: 'No image profiles are published by core runtime.' })}
        />
      ) : null}
    </div>
  );
}

export function ConversationCapabilitySettingsSection(
  props: ConversationCapabilitySettingsSectionProps,
) {
  const { t } = useTranslation();
  const capabilities = useMemo<CapabilityConfig[]>(() => {
    if (props.section === 'voice') {
      return [
        {
          capability: 'audio.synthesize',
          title: t('Chat.settingsVoiceSpeechTitle', { defaultValue: 'Speech synthesis' }),
          detail: t('Chat.settingsVoiceSpeechHint', { defaultValue: 'Controls standard text-to-speech playback for the conversation.' }),
        },
        {
          capability: 'voice_workflow.tts_v2v',
          title: t('Chat.settingsVoiceCloneTitle', { defaultValue: 'Voice clone workflow' }),
          detail: t('Chat.settingsVoiceCloneHint', { defaultValue: 'Independent route for voice-to-voice generation. Does not inherit speech synthesis automatically.' }),
        },
        {
          capability: 'voice_workflow.tts_t2v',
          title: t('Chat.settingsVoiceDesignTitle', { defaultValue: 'Voice design workflow' }),
          detail: t('Chat.settingsVoiceDesignHint', { defaultValue: 'Independent route for text-to-voice design. Does not inherit speech synthesis automatically.' }),
        },
      ];
    }
    if (props.section === 'image') {
      return [
        {
          capability: 'image.generate',
          title: t('Chat.settingsImageGenerateTitle', { defaultValue: 'Image generation' }),
          detail: t('Chat.settingsImageGenerateHint', { defaultValue: 'Controls the route used when the conversation generates images.' }),
        },
        {
          capability: 'image.edit',
          title: t('Chat.settingsImageEditTitle', { defaultValue: 'Image editing' }),
          detail: t('Chat.settingsImageEditHint', { defaultValue: 'Independent route for edit-style image operations.' }),
        },
      ];
    }
    if (props.section === 'video') {
      return [
        {
          capability: 'video.generate',
          title: t('Chat.settingsVideoGenerateTitle', { defaultValue: 'Video generation' }),
          detail: t('Chat.settingsVideoGenerateHint', { defaultValue: 'Controls the route used when the conversation generates videos.' }),
        },
      ];
    }
    // legacy 'visual' — image + video combined
    return [
      {
        capability: 'image.generate',
        title: t('Chat.settingsImageGenerateTitle', { defaultValue: 'Image generation' }),
        detail: t('Chat.settingsImageGenerateHint', { defaultValue: 'Controls the route used when the conversation generates images.' }),
      },
      {
        capability: 'image.edit',
        title: t('Chat.settingsImageEditTitle', { defaultValue: 'Image editing' }),
        detail: t('Chat.settingsImageEditHint', { defaultValue: 'Independent route for edit-style image operations.' }),
      },
      {
        capability: 'video.generate',
        title: t('Chat.settingsVideoGenerateTitle', { defaultValue: 'Video generation' }),
        detail: t('Chat.settingsVideoGenerateHint', { defaultValue: 'Controls the route used when the conversation generates videos.' }),
      },
    ];
  }, [props.section, t]);

  const aiConfig = useAppStore((state) => state.aiConfig);
  const surface = useMemo(() => getDesktopAIConfigService(), []);

  const updateCapabilityParams = useCallback((capability: string, params: Record<string, unknown>) => {
    const nextParams = { ...aiConfig.capabilities.selectedParams, [capability]: params };
    const nextConfig = {
      ...aiConfig,
      capabilities: { ...aiConfig.capabilities, selectedParams: nextParams },
    };
    surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
  }, [aiConfig, surface]);

  const resolveLocalContent = (capability: string) => {
    if (supportsImageCapability(capability)) {
      const stored = (aiConfig.capabilities.selectedParams[capability] || {}) as Record<string, unknown>;
      const companionSlots = (stored.companionSlots || {}) as Record<string, string>;
      const imageParams: ImageParamsState = {
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
      return (
        <ImageCapabilitySettings
          capability={capability}
          params={imageParams}
          companionSlots={companionSlots}
          onParamsChange={(next) => updateCapabilityParams(capability, { ...next, companionSlots })}
          onCompanionSlotsChange={(next) => updateCapabilityParams(capability, { ...imageParams, companionSlots: next })}
        />
      );
    }
    if (capability === 'video.generate') {
      const stored = (aiConfig.capabilities.selectedParams['video.generate'] || {}) as Record<string, unknown>;
      const videoParams: VideoParamsState = {
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
      return (
        <VideoCapabilitySettings
          params={videoParams}
          onParamsChange={(next) => updateCapabilityParams('video.generate', next as unknown as Record<string, unknown>)}
        />
      );
    }
    return undefined;
  };

  return (
    <div className="space-y-4">
      {props.section === 'image' ? <ImageProfileSelectorCard /> : null}
      {capabilities.map((capability) => (
        <CapabilityRouteSettingCard
          key={capability.capability}
          capability={capability.capability}
          title={capability.title}
          detail={capability.detail}
          localContent={resolveLocalContent(capability.capability)}
        />
      ))}
    </div>
  );
}
