import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  ImageParamsEditor,
  ModelConfigPanel,
  parseImageParams,
  parseVideoParams,
  VideoParamsEditor,
  type ModelConfigProfileCopy,
  type ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import { type RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { useDesktopModelConfigProfileController } from '../runtime-config/desktop-model-config-profile-controller';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';
import { TESTER_AI_SCOPE_REF, bindingFromTesterConfig } from './tester-ai-config';
import { CAPABILITIES, type CapabilityId } from './tester-types.js';

export type TesterSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  config: AIConfig;
  onBindingChange: (capabilityId: CapabilityId, binding: RuntimeRouteBinding | null) => void;
  onParamsChange: (capabilityId: CapabilityId, params: Record<string, unknown>) => void;
};

function createProfileCopy(t: ReturnType<typeof useTranslation>['t']): ModelConfigProfileCopy {
  return {
    sectionTitle: 'Profile',
    summaryLabel: t('Chat.settingsAIProfileTitle', { defaultValue: 'AI Profile' }),
    emptySummaryLabel: t('Chat.settingsAIProfileNone', { defaultValue: 'No profile applied' }),
    applyButtonLabel: t('Chat.settingsAIProfileApplyBtn', { defaultValue: 'Apply profile' }),
    changeButtonLabel: t('Chat.settingsAIProfileChange', { defaultValue: 'Change' }),
    manageButtonTitle: t('Chat.settingsAIProfileManage', { defaultValue: 'Manage profiles' }),
    modalTitle: t('Chat.settingsAIProfileModalTitle', { defaultValue: 'Apply AI Profile' }),
    modalHint: t('Chat.settingsAIProfileModalHint', {
      defaultValue: 'Selecting a profile will overwrite all current capability bindings (Chat, TTS, Image, Video). This action cannot be undone.',
    }),
    loadingLabel: t('Chat.settingsLoading', { defaultValue: 'Loading profiles...' }),
    emptyLabel: t('Chat.settingsAIProfileEmpty', { defaultValue: 'No profiles available.' }),
    currentBadgeLabel: t('Chat.settingsAIProfileCurrent', { defaultValue: 'Current' }),
    cancelLabel: t('Chat.settingsAIProfileCancel', { defaultValue: 'Cancel' }),
    confirmLabel: t('Chat.settingsAIProfileConfirm', { defaultValue: 'Confirm & Apply' }),
    applyingLabel: t('Chat.settingsAIProfileApplying', { defaultValue: 'Applying...' }),
    reloadLabel: t('Tester.profile.reload', { defaultValue: 'Reload' }),
  };
}

function createImageEditorCopy(t: ReturnType<typeof useTranslation>['t']) {
  return {
    companionModelsLabel: t('Chat.imageCompanionModels', { defaultValue: 'Companion Models' }),
    parametersLabel: t('Chat.imageParameters', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('Chat.badgePreview', { defaultValue: 'Preview' }),
    sizeLabel: t('Chat.imageParamSize', { defaultValue: 'Size' }),
    responseFormatLabel: t('Chat.imageParamResponseFormat', { defaultValue: 'Response format' }),
    seedLabel: t('Chat.imageParamSeed', { defaultValue: 'Seed' }),
    seedHint: t('Chat.imageParamSeedHint', { defaultValue: 'Optional seed for reproducibility' }),
    timeoutLabel: t('Chat.imageParamTimeout', { defaultValue: 'Timeout (ms)' }),
    stepsLabel: t('Chat.imageParamSteps', { defaultValue: 'Steps' }),
    cfgScaleLabel: t('Chat.imageParamCfgScale', { defaultValue: 'CFG Scale' }),
    samplerLabel: t('Chat.imageParamSampler', { defaultValue: 'Sampler' }),
    schedulerLabel: t('Chat.imageParamScheduler', { defaultValue: 'Scheduler' }),
    customOptionsLabel: t('Chat.imageParamCustomOptions', { defaultValue: 'Custom options' }),
    customOptionsHint: t('Chat.imageParamCustomOptionsHint', { defaultValue: 'One option per line. Example: diffusion_model' }),
    defaultPlaceholder: t('Chat.placeholderDefault', { defaultValue: 'Default' }),
    randomPlaceholder: t('Chat.placeholderRandom', { defaultValue: 'Random' }),
    oneOptionPerLinePlaceholder: t('Chat.placeholderOnePerLine', { defaultValue: 'One option per line' }),
    noneLabel: t('Chat.companionSlotNone', { defaultValue: 'None' }),
  };
}

function createVideoEditorCopy(t: ReturnType<typeof useTranslation>['t']) {
  return {
    parametersLabel: t('Chat.videoParameters', { defaultValue: 'Parameters' }),
    previewBadgeLabel: t('Chat.badgePreview', { defaultValue: 'Preview' }),
    modeLabel: t('Chat.videoParamMode', { defaultValue: 'Mode' }),
    ratioLabel: t('Chat.videoParamRatio', { defaultValue: 'Aspect ratio' }),
    durationLabel: t('Chat.videoParamDuration', { defaultValue: 'Duration (sec)' }),
    durationHint: t('Chat.videoParamDurationHint', { defaultValue: 'Range: 1–11 seconds' }),
    resolutionLabel: t('Chat.videoParamResolution', { defaultValue: 'Resolution' }),
    fpsLabel: t('Chat.videoParamFps', { defaultValue: 'FPS' }),
    seedLabel: t('Chat.videoParamSeed', { defaultValue: 'Seed' }),
    seedHint: t('Chat.videoParamSeedHint', { defaultValue: 'Optional seed for reproducibility' }),
    timeoutLabel: t('Chat.videoParamTimeout', { defaultValue: 'Timeout (ms)' }),
    cameraFixedLabel: t('Chat.videoParamCameraFixed', { defaultValue: 'Fixed camera' }),
    generateAudioLabel: t('Chat.videoParamGenerateAudio', { defaultValue: 'Generate audio' }),
    defaultPlaceholder: t('Chat.placeholderDefault', { defaultValue: 'Default' }),
    randomPlaceholder: t('Chat.placeholderRandom', { defaultValue: 'Random' }),
    modeOptions: [
      { value: 't2v', label: t('Chat.videoModeT2v', { defaultValue: 'Text to Video' }) },
      { value: 'i2v-first-frame', label: t('Chat.videoModeI2vFirst', { defaultValue: 'Image to Video (first frame)' }) },
      { value: 'i2v-reference', label: t('Chat.videoModeI2vRef', { defaultValue: 'Image to Video (reference)' }) },
    ],
  };
}

function useCapabilityProviders(): Record<string, RouteModelPickerDataProvider | null> {
  return useMemo(() => {
    const providers: Record<string, RouteModelPickerDataProvider | null> = {};
    for (const capability of CAPABILITIES) {
      if (!capability.hasRoute || !capability.routeCapability || providers[capability.routeCapability] !== undefined) {
        continue;
      }
      providers[capability.routeCapability] = getDesktopRouteModelPickerProvider(capability.routeCapability);
    }
    return providers;
  }, []);
}

export function TesterSettingsPanel(props: TesterSettingsPanelProps) {
  const { open, config, onBindingChange, onParamsChange } = props;
  const { t } = useTranslation();
  const providers = useCapabilityProviders();
  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const imageEditorCopy = useMemo(() => createImageEditorCopy(t), [t]);
  const videoEditorCopy = useMemo(() => createVideoEditorCopy(t), [t]);

  const profile = useDesktopModelConfigProfileController({
    scopeRef: TESTER_AI_SCOPE_REF,
    currentOrigin: config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null,
    copy: createProfileCopy(t),
    onManage: () => {
      setActiveTab('runtime');
      setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
    },
  });

  const sections = useMemo<ModelConfigSection[]>(() => {
    const imageParams = parseImageParams((config.capabilities.selectedParams['image.generate'] || {}) as Record<string, unknown>);
    const imageCompanionSlots = (((config.capabilities.selectedParams['image.generate'] || {}) as Record<string, unknown>).companionSlots || {}) as Record<string, string>;
    const videoParams = parseVideoParams((config.capabilities.selectedParams['video.generate'] || {}) as Record<string, unknown>);

    return [
      {
        id: 'chat',
        title: t('Chat.settingsChatSection', { defaultValue: 'Chat' }),
        items: [
          {
            capabilityId: 'text.generate',
            routeCapability: 'text.generate',
            label: t('Tester.capability.chat', { defaultValue: 'Chat' }),
            binding: bindingFromTesterConfig(config, 'text.generate'),
            provider: providers['text.generate'] || null,
            onBindingChange: (binding) => onBindingChange('text.generate', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
        ],
      },
      {
        id: 'embed',
        title: t('Tester.capability.embedSection', { defaultValue: 'Embed' }),
        items: [
          {
            capabilityId: 'text.embed',
            routeCapability: 'text.embed',
            label: t('Tester.capability.embed', { defaultValue: 'Embed' }),
            binding: bindingFromTesterConfig(config, 'text.embed'),
            provider: providers['text.embed'] || null,
            onBindingChange: (binding) => onBindingChange('text.embed', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
        ],
      },
      {
        id: 'image',
        title: t('Chat.settingsImageSection', { defaultValue: 'Image' }),
        collapsible: true,
        defaultExpanded: true,
        items: [
          {
            capabilityId: 'image.generate',
            routeCapability: 'image.generate',
            label: t('Tester.capability.image', { defaultValue: 'Image' }),
            binding: bindingFromTesterConfig(config, 'image.generate'),
            provider: providers['image.generate'] || null,
            onBindingChange: (binding) => onBindingChange('image.generate', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
            editor: (
              <ImageParamsEditor
                copy={imageEditorCopy}
                params={imageParams}
                companionSlots={imageCompanionSlots}
                assets={assets}
                assetsLoading={assetsQuery.isLoading}
                onParamsChange={(next) => onParamsChange('image.generate', { ...next, companionSlots: imageCompanionSlots })}
                onCompanionSlotsChange={(next) => onParamsChange('image.generate', { ...imageParams, companionSlots: next })}
              />
            ),
            showEditorWhen: 'local',
          },
        ],
      },
      {
        id: 'video',
        title: t('Chat.settingsVideoSection', { defaultValue: 'Video' }),
        collapsible: true,
        items: [
          {
            capabilityId: 'video.generate',
            routeCapability: 'video.generate',
            label: t('Tester.capability.video', { defaultValue: 'Video' }),
            binding: bindingFromTesterConfig(config, 'video.generate'),
            provider: providers['video.generate'] || null,
            onBindingChange: (binding) => onBindingChange('video.generate', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
            editor: (
              <VideoParamsEditor
                copy={videoEditorCopy}
                params={videoParams}
                onParamsChange={(next) => onParamsChange('video.generate', next as unknown as Record<string, unknown>)}
              />
            ),
            showEditorWhen: 'local',
          },
        ],
      },
      {
        id: 'audio',
        title: t('Tester.capability.audioSection', { defaultValue: 'Audio' }),
        collapsible: true,
        items: [
          {
            capabilityId: 'audio.synthesize',
            routeCapability: 'audio.synthesize',
            label: t('Tester.capability.tts', { defaultValue: 'TTS' }),
            binding: bindingFromTesterConfig(config, 'audio.synthesize'),
            provider: providers['audio.synthesize'] || null,
            onBindingChange: (binding) => onBindingChange('audio.synthesize', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
          {
            capabilityId: 'audio.transcribe',
            routeCapability: 'audio.transcribe',
            label: t('Tester.capability.stt', { defaultValue: 'STT' }),
            binding: bindingFromTesterConfig(config, 'audio.transcribe'),
            provider: providers['audio.transcribe'] || null,
            onBindingChange: (binding) => onBindingChange('audio.transcribe', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
          {
            capabilityId: 'voice.clone',
            routeCapability: 'voice_workflow.tts_v2v',
            label: t('Tester.capability.voiceClone', { defaultValue: 'Voice Clone' }),
            binding: bindingFromTesterConfig(config, 'voice.clone'),
            provider: providers['voice_workflow.tts_v2v'] || null,
            onBindingChange: (binding) => onBindingChange('voice.clone', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
          {
            capabilityId: 'voice.design',
            routeCapability: 'voice_workflow.tts_t2v',
            label: t('Tester.capability.voiceDesign', { defaultValue: 'Voice Design' }),
            binding: bindingFromTesterConfig(config, 'voice.design'),
            provider: providers['voice_workflow.tts_t2v'] || null,
            onBindingChange: (binding) => onBindingChange('voice.design', binding),
            placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
            runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
          },
        ],
      },
    ];
  }, [assets, assetsQuery.isLoading, config, imageEditorCopy, onBindingChange, onParamsChange, profile, providers, t, videoEditorCopy]);

  if (!open) {
    return null;
  }

  return (
    <aside
      className="relative flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l border-slate-200/60 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="tester-settings"
    >
      <div className="shrink-0 px-4 pt-4 pb-3">
        <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">
          {t('Tester.settings.title', { defaultValue: 'AI Tester Settings' })}
        </h1>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
        <ModelConfigPanel
          profile={profile}
          sections={sections}
        />
      </ScrollArea>
    </aside>
  );
}
