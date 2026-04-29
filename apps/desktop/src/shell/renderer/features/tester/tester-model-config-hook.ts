import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';
import {
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProfileController,
} from '@nimiplatform/nimi-kit/features/model-config';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { loadUserProfiles } from '../runtime-config/runtime-config-profile-storage';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';
import { bindingFromTesterConfig, TESTER_AI_SCOPE_REF } from './tester-ai-config';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';

const TESTER_ENABLED_CAPABILITIES = [
  'text.generate',
  'text.embed',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
  'image.generate',
  'image.edit',
  'video.generate',
  'world.generate',
] as const;

export type TesterModelConfigController = {
  surface: AppModelConfigSurface;
  profile: ModelConfigProfileController;
};

export function useTesterModelConfigController(config: AIConfig): TesterModelConfigController {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const ttsBinding = useMemo(() => bindingFromTesterConfig(config, 'audio.synthesize'), [config]);
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<ReadonlyArray<{ value: string; label: string }>>([]);

  useEffect(() => {
    if (!ttsBinding) {
      setTtsVoiceOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const client = createModRuntimeClient('core:runtime');
        const response = await client.media.tts.listVoices({ binding: ttsBinding });
        if (cancelled) return;
        setTtsVoiceOptions(response.voices.map((voice) => ({
          value: voice.voiceId,
          label: `${voice.name} [${voice.lang}]`,
        })));
      } catch {
        if (!cancelled) setTtsVoiceOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [ttsBinding]);

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
  const userProfilesSource = useMemo(() => ({ list: () => loadUserProfiles() }), []);
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
