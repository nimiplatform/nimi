import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type {
  ModelConfigCapabilityItem,
  ModelConfigCapabilityStatus,
  ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  ImageParamsEditor,
  ModelConfigPanel,
  VideoParamsEditor,
  parseImageParams,
  parseVideoParams,
  type ImageParamsEditorCopy,
  type LocalAssetEntry,
  type VideoParamsEditorCopy,
} from '@nimiplatform/nimi-kit/features/model-config';
import { type RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from './capability-settings-shared';
import {
  type ConversationCapability,
  type ConversationCapabilityProjection,
  toRuntimeCanonicalCapability,
} from './conversation-capability';

type CapabilityConfig = {
  capability: ConversationCapability;
  sectionId: 'chat' | 'tts' | 'image' | 'video';
  sectionTitle: string;
  label: string;
  detail: string;
  editorKind?: 'image' | 'video';
};

function buildProjectionStatus(
  t: ReturnType<typeof useTranslation>['t'],
  capabilityLabel: string,
  projection: ConversationCapabilityProjection | null | undefined,
  selectedBinding: RuntimeRouteBinding | null | undefined,
): ModelConfigCapabilityStatus {
  const fallbackTitle = selectedBinding
    ? t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
    : t('Chat.settingsRouteUnavailable', { defaultValue: 'Route unavailable' });

  if (projection?.supported && projection.resolvedBinding) {
    return {
      supported: true,
      tone: 'ready',
      badgeLabel: t('Chat.settingsCapabilityReady', { defaultValue: 'Ready' }),
      title: t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
      detail: null,
    };
  }

  if (projection?.reasonCode === 'selection_missing' || projection?.reasonCode === 'selection_cleared') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
      title: t('Chat.settingsRouteUnavailable', { defaultValue: 'Route unavailable' }),
      detail: t('Chat.settingsCapabilityRouteRequired', {
        defaultValue: 'Select a route for {{capability}}.',
        capability: capabilityLabel,
      }),
    };
  }

  if (projection?.reasonCode === 'binding_unresolved') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      title: t('Chat.settingsSelectedRouteUnavailable', { defaultValue: 'Selected route unavailable' }),
      detail: t('Chat.settingsSelectedRouteUnavailableHint', {
        defaultValue: 'The selected route can no longer be resolved.',
      }),
    };
  }

  if (projection?.reasonCode === 'route_unhealthy') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      title: t('Chat.settingsRouteUnhealthy', { defaultValue: 'Route unhealthy' }),
      detail: t('Chat.settingsRouteUnhealthyHint', {
        defaultValue: 'The selected route failed the latest health check.',
      }),
    };
  }

  if (projection?.reasonCode === 'metadata_missing') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      title: t('Chat.settingsRouteMetadataUnavailable', { defaultValue: 'Route metadata unavailable' }),
      detail: t('Chat.settingsRouteMetadataUnavailableHint', {
        defaultValue: 'This capability cannot execute until runtime describe metadata is available.',
      }),
    };
  }

  if (projection?.reasonCode === 'capability_unsupported') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      title: t('Chat.settingsCapabilityUnsupported', { defaultValue: 'Capability unsupported' }),
      detail: t('Chat.settingsCapabilityUnsupportedHint', {
        defaultValue: 'The current runtime does not expose this capability.',
      }),
    };
  }

  if (projection?.reasonCode === 'host_denied') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
      title: t('Chat.settingsCapabilityDenied', { defaultValue: 'Capability denied' }),
      detail: t('Chat.settingsCapabilityDeniedHint', {
        defaultValue: 'The host denied this capability for the current conversation surface.',
      }),
    };
  }

  return {
    supported: false,
    tone: 'neutral',
    badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
    title: fallbackTitle,
    detail: selectedBinding
      ? null
      : t('Chat.settingsCapabilityRouteRequired', {
        defaultValue: 'Select a route for {{capability}}.',
        capability: capabilityLabel,
      }),
  };
}

function createImageEditorCopy(t: ReturnType<typeof useTranslation>['t']): ImageParamsEditorCopy {
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

function createVideoEditorCopy(t: ReturnType<typeof useTranslation>['t']): VideoParamsEditorCopy {
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

function useCapabilityProviders(capabilities: string[]): Record<string, RouteModelPickerDataProvider | null> {
  const capabilityKey = capabilities.join('|');
  return useMemo(() => {
    const providers: Record<string, RouteModelPickerDataProvider | null> = {};
    for (const capability of capabilities) {
      if (!capability || providers[capability] !== undefined) {
        continue;
      }
      providers[capability] = getDesktopRouteModelPickerProvider(capability);
    }
    return providers;
  }, [capabilities, capabilityKey]);
}

function createCapabilityConfigs(t: ReturnType<typeof useTranslation>['t']): CapabilityConfig[] {
  return [
    {
      capability: 'text.generate',
      sectionId: 'chat',
      sectionTitle: t('Chat.settingsChatSection', { defaultValue: 'Chat' }),
      label: t('Chat.settingsChatModel', { defaultValue: 'Chat Model' }),
      detail: t('Chat.settingsChatModelHint', { defaultValue: 'The active text route for this conversation scope.' }),
    },
    {
      capability: 'audio.synthesize',
      sectionId: 'tts',
      sectionTitle: t('Chat.settingsTtsSection', { defaultValue: 'TTS' }),
      label: t('Chat.settingsVoiceSpeechTitle', { defaultValue: 'Speech synthesis' }),
      detail: t('Chat.settingsVoiceSpeechHint', { defaultValue: 'Controls standard text-to-speech playback for the conversation.' }),
    },
    {
      capability: 'voice_workflow.tts_v2v',
      sectionId: 'tts',
      sectionTitle: t('Chat.settingsTtsSection', { defaultValue: 'TTS' }),
      label: t('Chat.settingsVoiceCloneTitle', { defaultValue: 'Voice clone workflow' }),
      detail: t('Chat.settingsVoiceCloneHint', { defaultValue: 'Independent route for voice-to-voice generation. Does not inherit speech synthesis automatically.' }),
    },
    {
      capability: 'voice_workflow.tts_t2v',
      sectionId: 'tts',
      sectionTitle: t('Chat.settingsTtsSection', { defaultValue: 'TTS' }),
      label: t('Chat.settingsVoiceDesignTitle', { defaultValue: 'Voice design workflow' }),
      detail: t('Chat.settingsVoiceDesignHint', { defaultValue: 'Independent route for text-to-voice design. Does not inherit speech synthesis automatically.' }),
    },
    {
      capability: 'image.generate',
      sectionId: 'image',
      sectionTitle: t('Chat.settingsImageSection', { defaultValue: 'Image' }),
      label: t('Chat.settingsImageGenerateTitle', { defaultValue: 'Image generation' }),
      detail: t('Chat.settingsImageGenerateHint', { defaultValue: 'Controls the route used when the conversation generates images.' }),
      editorKind: 'image',
    },
    {
      capability: 'image.edit',
      sectionId: 'image',
      sectionTitle: t('Chat.settingsImageSection', { defaultValue: 'Image' }),
      label: t('Chat.settingsImageEditTitle', { defaultValue: 'Image editing' }),
      detail: t('Chat.settingsImageEditHint', { defaultValue: 'Independent route for edit-style image operations.' }),
      editorKind: 'image',
    },
    {
      capability: 'video.generate',
      sectionId: 'video',
      sectionTitle: t('Chat.settingsVideoSection', { defaultValue: 'Video' }),
      label: t('Chat.settingsVideoGenerateTitle', { defaultValue: 'Video generation' }),
      detail: t('Chat.settingsVideoGenerateHint', { defaultValue: 'Controls the route used when the conversation generates videos.' }),
      editorKind: 'video',
    },
  ];
}

export function useConversationModelConfigSections(): ModelConfigSection[] {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const projectionByCapability = useAppStore((state) => state.conversationCapabilityProjectionByCapability);
  const surface = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];
  const imageEditorCopy = useMemo(() => createImageEditorCopy(t), [t]);
  const videoEditorCopy = useMemo(() => createVideoEditorCopy(t), [t]);
  const capabilityConfigs = useMemo(() => createCapabilityConfigs(t), [t]);
  const providers = useCapabilityProviders(
    useMemo(
      () => Array.from(new Set(capabilityConfigs.map((config) => toRuntimeCanonicalCapability(config.capability)))),
      [capabilityConfigs],
    ),
  );

  const updateBinding = useCallback((capability: string, binding: RuntimeRouteBinding | null) => {
    const nextBindings = { ...aiConfig.capabilities.selectedBindings };
    nextBindings[capability] = binding;
    const nextConfig = {
      ...aiConfig,
      capabilities: {
        ...aiConfig.capabilities,
        selectedBindings: nextBindings,
      },
    };
    surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
  }, [aiConfig, surface]);

  const updateParams = useCallback((capability: string, params: Record<string, unknown>) => {
    const nextParams = { ...aiConfig.capabilities.selectedParams, [capability]: params };
    const nextConfig = {
      ...aiConfig,
      capabilities: {
        ...aiConfig.capabilities,
        selectedParams: nextParams,
      },
    };
    surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
  }, [aiConfig, surface]);

  const items = useMemo<ModelConfigCapabilityItem[]>(() => capabilityConfigs.map((config) => {
    const binding = (aiConfig.capabilities.selectedBindings[config.capability] || null) as RuntimeRouteBinding | null;
    const projection = projectionByCapability[config.capability] || null;
    const status = buildProjectionStatus(t, config.label, projection, binding);
    const storedParams = (aiConfig.capabilities.selectedParams[config.capability] || {}) as Record<string, unknown>;
    const routeCapability = toRuntimeCanonicalCapability(config.capability);
    let editor = undefined as ReactNode | undefined;

    if (config.editorKind === 'image') {
      const imageParams = parseImageParams(storedParams);
      const companionSlots = (storedParams.companionSlots || {}) as Record<string, string>;
      editor = (
        <ImageParamsEditor
          copy={imageEditorCopy}
          params={imageParams}
          companionSlots={companionSlots}
          assets={assets as LocalAssetEntry[]}
          assetsLoading={assetsQuery.isLoading}
          onParamsChange={(next) => updateParams(config.capability, { ...next, companionSlots })}
          onCompanionSlotsChange={(next) => updateParams(config.capability, { ...imageParams, companionSlots: next })}
        />
      );
    } else if (config.editorKind === 'video') {
      const videoParams = parseVideoParams(storedParams);
      editor = (
        <VideoParamsEditor
          copy={videoEditorCopy}
          params={videoParams}
          onParamsChange={(next) => updateParams(config.capability, next as unknown as Record<string, unknown>)}
        />
      );
    }

    return {
      capabilityId: config.capability,
      routeCapability,
      label: config.label,
      detail: config.detail,
      binding,
      provider: providers[routeCapability] || null,
      onBindingChange: (nextBinding) => updateBinding(config.capability, nextBinding),
      status,
      editor,
      showEditorWhen: config.editorKind ? 'local' : 'always',
      placeholder: t('Chat.settingsSelectModel', { defaultValue: 'Select a model' }),
      runtimeNotReadyLabel: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
      clearSelectionLabel: t('Chat.settingsReset', { defaultValue: 'Reset' }),
    };
  }), [aiConfig.capabilities.selectedBindings, aiConfig.capabilities.selectedParams, assets, assetsQuery.isLoading, capabilityConfigs, imageEditorCopy, projectionByCapability, providers, t, updateBinding, updateParams, videoEditorCopy]);

  return useMemo(() => {
    const sections = new Map<string, ModelConfigSection>();
    for (const config of capabilityConfigs) {
      if (!sections.has(config.sectionId)) {
        sections.set(config.sectionId, {
          id: config.sectionId,
          title: config.sectionTitle,
          collapsible: config.sectionId !== 'chat',
          defaultExpanded: config.sectionId === 'image',
          items: [],
        });
      }
      sections.get(config.sectionId)!.items!.push(
        items.find((item) => item.capabilityId === config.capability)!,
      );
    }
    return Array.from(sections.values());
  }, [capabilityConfigs, items]);
}

export function ConversationModelConfigPanel(props: {
  className?: string;
  sections: ModelConfigSection[];
  profile?: React.ComponentProps<typeof ModelConfigPanel>['profile'];
}) {
  return (
    <ModelConfigPanel
      className={props.className}
      profile={props.profile}
      sections={props.sections}
    />
  );
}
