import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createModRuntimeClient, type RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
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
  buildRoutePickerLabels,
  CapabilityRouteModelPickerContent,
  DisabledSettingsNote,
} from './chat-settings-panel';
import { RuntimeInspectCard } from './chat-runtime-inspect-content';

const CORE_RUNTIME_MOD_ID = 'core:runtime';

type ConversationCapabilitySettingsSectionProps = {
  section: 'voice' | 'visual';
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
    model: normalizeText(binding.modelId) || normalizeText(binding.model),
  };
}

function bindingKey(binding: RuntimeRouteBinding | null | undefined): string {
  if (binding === undefined) {
    return 'missing';
  }
  if (binding === null) {
    return 'cleared';
  }
  return [
    normalizeText(binding.source),
    normalizeText(binding.connectorId),
    normalizeText(binding.localModelId),
    normalizeText(binding.modelId),
    normalizeText(binding.model),
    normalizeText(binding.engine),
  ].join('|');
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
    const model = normalizeText(binding.modelId) || normalizeText(binding.model) || normalizeText(binding.localModelId) || 'Unknown model';
    return {
      label: 'Local runtime',
      detail: [provider, model].filter(Boolean).join(' · '),
    };
  }
  const provider = normalizeText(binding.provider) || normalizeText(binding.connectorId) || 'Cloud route';
  const model = normalizeText(binding.modelId) || normalizeText(binding.model) || 'Unknown model';
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
      value: t('Chat.settingsImageProfileRequired', { defaultValue: 'Image profile required' }),
      detail: t('Chat.settingsImageProfileRequiredHint', {
        defaultValue: 'Choose an image profile before using this visual capability.',
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

function CapabilityRouteSettingCard(props: CapabilityConfig) {
  const { t } = useTranslation();
  const selectedBinding = useAppStore((state) => state.conversationCapabilitySelectionStore.selectedBindings[props.capability]);
  const projection = useAppStore((state) => state.conversationCapabilityProjectionByCapability[props.capability] || null);
  const setConversationCapabilityBinding = useAppStore((state) => state.setConversationCapabilityBinding);
  const routePickerLabels = useMemo(() => buildRoutePickerLabels(t), [t]);
  const status = useMemo(
    () => buildProjectionStatus(t, props.title, projection, selectedBinding),
    [projection, props.title, selectedBinding, t],
  );
  const pickerKey = `${props.capability}:${bindingKey(selectedBinding)}`;

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.title}
          </div>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {props.detail}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            status.supported
              ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_16%,transparent)] text-[var(--nimi-status-success)]'
              : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]'
          }`}
        >
          {status.badge}
        </span>
      </div>

      <RuntimeInspectCard
        label={t('Chat.settingsCurrentRoute', { defaultValue: 'Current route' })}
        value={status.value}
        detail={status.detail}
      />

      <CapabilityRouteModelPickerContent
        key={pickerKey}
        capability={toRuntimeCanonicalCapability(props.capability)}
        initialModelSelection={toSelection(selectedBinding)}
        onModelSelectionChange={(selection) => {
          setConversationCapabilityBinding(
            props.capability,
            toRuntimeRouteBindingFromPickerSelection({
              capability: props.capability,
              selection,
            }),
          );
        }}
        labels={routePickerLabels}
      />
    </div>
  );
}

function ImageProfileSelectorCard() {
  const { t } = useTranslation();
  const imageProfileRef = useAppStore((state) => state.conversationCapabilitySelectionStore.defaultRefs.imageProfileRef || null);
  const setConversationCapabilityDefaultRefs = useAppStore((state) => state.setConversationCapabilityDefaultRefs);
  const profileClientRef = useRef<ReturnType<typeof createModRuntimeClient> | null>(null);

  if (!profileClientRef.current) {
    try {
      profileClientRef.current = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    } catch {
      profileClientRef.current = null;
    }
  }

  const profileQuery = useQuery({
    queryKey: ['conversation-image-profiles', CORE_RUNTIME_MOD_ID],
    enabled: Boolean(profileClientRef.current),
    queryFn: async () => profileClientRef.current!.local.listProfiles(),
  });

  const profiles = useMemo(
    () => (profileQuery.data || []).filter((profile) => (
      (Array.isArray(profile.consumeCapabilities) && profile.consumeCapabilities.some(supportsImageCapability))
      || (Array.isArray(profile.entries) && profile.entries.some((entry) => supportsImageCapability(entry.capability)))
    )),
    [profileQuery.data],
  );
  const selectedValue = normalizeText(imageProfileRef?.profileId);
  const selectedExternalLabel = useMemo(() => {
    const current = normalizeProfileRefLabel(imageProfileRef);
    if (!current) {
      return null;
    }
    const known = profiles.some((profile) => (
      normalizeText(profile.id) === normalizeText(imageProfileRef?.profileId)
      && normalizeText(imageProfileRef?.modId) === CORE_RUNTIME_MOD_ID
    ));
    return known ? null : current;
  }, [imageProfileRef, profiles]);

  if (!profileClientRef.current) {
    return (
      <DisabledSettingsNote
        label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}
      />
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('Chat.settingsImageProfileTitle', { defaultValue: 'Image Profile' })}
        </div>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('Chat.settingsImageProfileHint', {
            defaultValue: 'Visual generation keeps only a profile ref. Runtime resolves the backing assets and slots at execution time.',
          })}
        </p>
      </div>

      <RuntimeInspectCard
        label={t('Chat.settingsSelectedImageProfile', { defaultValue: 'Selected profile' })}
        value={profiles.find((profile) => normalizeText(profile.id) === selectedValue)?.title
          || selectedExternalLabel
          || t('Chat.settingsImageProfileUnset', { defaultValue: 'No profile selected' })}
        detail={profiles.find((profile) => normalizeText(profile.id) === selectedValue)?.description
          || (selectedExternalLabel
            ? t('Chat.settingsExternalImageProfileHint', {
              defaultValue: 'Using an existing profile ref that is not published by core runtime.',
            })
            : t('Chat.settingsImageProfileUnsetHint', {
              defaultValue: 'Choose a profile to enable image.generate and image.edit projections.',
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
              setConversationCapabilityDefaultRefs({ imageProfileRef: null });
              return;
            }
            if (nextValue === '__external__') {
              return;
            }
            setConversationCapabilityDefaultRefs({
              imageProfileRef: {
                modId: CORE_RUNTIME_MOD_ID,
                profileId: nextValue,
              },
            });
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
            <option key={profile.id} value={profile.id}>
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

  return (
    <div className="space-y-4">
      {props.section === 'visual' ? <ImageProfileSelectorCard /> : null}
      {capabilities.map((capability) => (
        <CapabilityRouteSettingCard
          key={capability.capability}
          capability={capability.capability}
          title={capability.title}
          detail={capability.detail}
        />
      ))}
    </div>
  );
}
