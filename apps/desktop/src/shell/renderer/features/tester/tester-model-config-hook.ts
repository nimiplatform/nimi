import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';
import type { SpeechListVoicesOutput, SpeechVoiceReference } from '@nimiplatform/sdk/runtime';
import { VoiceAssetStatus, VoiceWorkflowType } from '@nimiplatform/sdk/runtime';
import {
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProfileController,
} from '@nimiplatform/kit/features/model-config';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import {
  ensureAccountProfileLibraryLoaded,
  getCachedAccountProfileLibraryProfiles,
} from '../runtime-config/runtime-config-profile-library';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';
import { bindingFromTesterConfig, TESTER_AI_SCOPE_REF } from './tester-ai-config';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import { listTesterVoiceAssets, type TesterVoiceAsset } from './tester-voice-assets';
import { TESTER_RUNTIME_CLIENT_ID } from './tester-app-identity';

const TESTER_ENABLED_CAPABILITIES = [
  'text.generate',
  'text.embed',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
  'image.generate',
  'image.edit',
  'video.generate',
  'world.generate',
] as const;

export type TesterModelConfigController = {
  surface: AppModelConfigSurface;
  profile: ModelConfigProfileController;
};

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

type PresetVoice = SpeechListVoicesOutput['voices'][number];

export function useTesterModelConfigController(config: AIConfig, voiceAssetRefreshRevision = 0): TesterModelConfigController {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const ttsBinding = useMemo(() => bindingFromTesterConfig(config, 'audio.synthesize'), [config]);
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<ReadonlyArray<{ value: SpeechVoiceReference; label: string }>>([]);

  useEffect(() => {
    if (!ttsBinding) {
      setTtsVoiceOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const client = createModRuntimeClient(TESTER_RUNTIME_CLIENT_ID);
        const [voiceResponse, assetResponse] = await Promise.all([
          client.media.tts.listVoices({ binding: ttsBinding }),
          listTesterVoiceAssets(client, {
            modelId: '',
            targetModelId: '',
            workflowType: VoiceWorkflowType.UNSPECIFIED,
            status: VoiceAssetStatus.ACTIVE,
            pageSize: 100,
            pageToken: '',
            connectorId: asText(ttsBinding.connectorId),
          }),
        ]);
        if (cancelled) return;
        const presetOptions = voiceResponse.voices.map((voice: PresetVoice) => ({
          value: { kind: 'preset_voice_id', presetVoiceId: voice.voiceId } as SpeechVoiceReference,
          label: `${voice.name} [${voice.lang}]`,
        }));
        const assetOptions = (assetResponse.assets || [])
          .map((asset: TesterVoiceAsset) => {
            const voiceAssetId = asText(asset.voiceAssetId);
            const targetModelId = asText(asset.targetModelId) || asText(asset.modelId);
            if (!voiceAssetId) return null;
            return {
              value: { kind: 'voice_asset_id', voiceAssetId } as SpeechVoiceReference,
              label: `${asText(asset.providerVoiceRef) || voiceAssetId} · asset`,
              ...(targetModelId
                ? {
                  binding: {
                    source: ttsBinding.source === 'local' ? 'local' as const : 'cloud' as const,
                    connectorId: asText(ttsBinding.connectorId),
                    model: targetModelId,
                    modelId: targetModelId,
                    modelLabel: targetModelId,
                    provider: asText(asset.provider) || asText(ttsBinding.provider),
                  },
                }
                : {}),
            };
          })
          .filter((option): option is NonNullable<typeof option> => Boolean(option));
        setTtsVoiceOptions([...assetOptions, ...presetOptions]);
      } catch {
        if (!cancelled) setTtsVoiceOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [ttsBinding, voiceAssetRefreshRevision]);

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: TESTER_AI_SCOPE_REF,
    aiConfigService,
    enabledCapabilities: TESTER_ENABLED_CAPABILITIES,
    providerResolver: (routeCapability: string) => getDesktopRouteModelPickerProvider(routeCapability),
    projectionResolver: () => null,
    runtimeReady: true,
    localAssetSource: {
      list: () => assetsQuery.data || [],
      loading: assetsQuery.isLoading,
    },
    capabilityOverrides: {
      'audio.synthesize': {
        audioSynthesizeVoiceOptions: ttsVoiceOptions,
      },
    },
    i18n: { t },
  }), [aiConfigService, assetsQuery.data, assetsQuery.isLoading, t, ttsVoiceOptions]);

  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  // Prime the read-through projection of the Rust-owned account profile
  // library so the synchronous kit `userProfilesSource.list()` reflects host
  // truth (P-AIPS-013: the library file family is the source of truth).
  useEffect(() => {
    void ensureAccountProfileLibraryLoaded();
  }, []);
  const userProfilesSource = useMemo(
    () => ({ list: () => getCachedAccountProfileLibraryProfiles() }),
    [],
  );
  const currentOrigin = useMemo(
    () => (config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null),
    [config.profileOrigin?.profileId, config.profileOrigin?.title],
  );
  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
  }, [setActiveTab]);

  const profile = useModelConfigProfileController({
    scopeRef: TESTER_AI_SCOPE_REF,
    aiConfigService,
    copy: profileCopy,
    applyAIProfileToConfig,
    userProfilesSource,
    currentOrigin,
    onManage: handleManageProfiles,
  });

  return { surface, profile };
}
