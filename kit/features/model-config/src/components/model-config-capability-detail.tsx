import { useCallback, useMemo } from 'react';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type {
  AppModelConfigSurface,
  CapabilityItemOverride,
  SharedAIConfigService,
} from '@nimiplatform/nimi-kit/core/model-config';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  DEFAULT_AUDIO_SYNTHESIZE_PARAMS,
  DEFAULT_AUDIO_TRANSCRIBE_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_TEXT_GENERATE_PARAMS,
  DEFAULT_VIDEO_PARAMS,
  DEFAULT_VOICE_WORKFLOW_PARAMS,
  parseAudioSynthesizeParams,
  parseAudioTranscribeParams,
  parseImageParams,
  parseTextGenerateParams,
  parseVideoParams,
  parseVoiceWorkflowParams,
} from '../constants.js';
import type {
  AudioSynthesizeParamsState,
  AudioTranscribeParamsState,
  ImageParamsState,
  ModelConfigCapabilityItem,
  ModelConfigRouteBinding,
  TextGenerateParamsState,
  VideoParamsState,
  VoiceWorkflowParamsState,
} from '../types.js';
import { CapabilityModelCard } from './capability-model-card.js';
import {
  TextGenerateParamsEditor,
  createTextGenerateEditorCopy,
} from './text-generate-params-editor.js';
import {
  AudioSynthesizeParamsEditor,
  createAudioSynthesizeEditorCopy,
} from './audio-synthesize-params-editor.js';
import {
  AudioTranscribeParamsEditor,
  createAudioTranscribeEditorCopy,
} from './audio-transcribe-params-editor.js';
import {
  VoiceWorkflowParamsEditor,
  createVoiceWorkflowEditorCopy,
} from './voice-workflow-params-editor.js';
import { ImageParamsEditor } from './image-params-editor.js';
import { VideoParamsEditor } from './video-params-editor.js';

export type ModelConfigCapabilityDetailProps = {
  capabilityId: string;
  surface: AppModelConfigSurface;
  config: AIConfig;
};

function readParams(config: AIConfig, capabilityId: string): Record<string, unknown> {
  const raw = config.capabilities.selectedParams?.[capabilityId];
  return (raw && typeof raw === 'object') ? raw : {};
}

function readBinding(config: AIConfig, capabilityId: string): ModelConfigRouteBinding | null {
  const stored = config.capabilities.selectedBindings?.[capabilityId];
  if (!stored) return null;
  return {
    source: stored.source === 'cloud' ? 'cloud' : 'local',
    connectorId: stored.connectorId || '',
    model: stored.model || '',
    modelId: stored.modelId || undefined,
    modelLabel: stored.modelLabel || undefined,
    localModelId: stored.localModelId || undefined,
    provider: stored.provider || undefined,
    engine: stored.engine || undefined,
    adapter: stored.adapter || undefined,
    endpoint: stored.endpoint || undefined,
    goRuntimeLocalModelId: stored.goRuntimeLocalModelId || undefined,
    goRuntimeStatus: stored.goRuntimeStatus || undefined,
    providerHints: stored.providerHints || undefined,
  };
}

function writeCapabilityPatch(
  service: SharedAIConfigService,
  scopeRef: AppModelConfigSurface['scopeRef'],
  capabilityId: string,
  patch: {
    binding?: ModelConfigRouteBinding | null;
    params?: Record<string, unknown>;
  },
): void {
  const current = service.aiConfig.get(scopeRef);
  const nextBindings = { ...current.capabilities.selectedBindings };
  const nextParams = { ...current.capabilities.selectedParams };
  if (Object.prototype.hasOwnProperty.call(patch, 'binding')) {
    nextBindings[capabilityId] = patch.binding
      ? {
        source: patch.binding.source,
        connectorId: patch.binding.connectorId,
        model: patch.binding.model,
        modelId: patch.binding.modelId,
        modelLabel: patch.binding.modelLabel,
        localModelId: patch.binding.localModelId,
        engine: patch.binding.engine,
        provider: patch.binding.provider,
      }
      : null;
  }
  if (patch.params) {
    nextParams[capabilityId] = patch.params;
  }
  service.aiConfig.update(scopeRef, {
    ...current,
    capabilities: {
      ...current.capabilities,
      selectedBindings: nextBindings,
      selectedParams: nextParams,
    },
  });
}

function resolveProvider(
  surface: AppModelConfigSurface,
  routeCapability: string,
): RouteModelPickerDataProvider | null {
  const resolved = surface.providerResolver(routeCapability);
  return (resolved ?? null) as RouteModelPickerDataProvider | null;
}

function resolveOverride(
  surface: AppModelConfigSurface,
  capabilityId: string,
): CapabilityItemOverride {
  return surface.capabilityOverrides?.[capabilityId] ?? {};
}

function renderEditor(
  descriptor: CanonicalCapabilityDescriptor,
  surface: AppModelConfigSurface,
  config: AIConfig,
): {
  editor: ReturnType<typeof Object> | null;
  showEditorWhen: 'always' | 'local';
} {
  const service = surface.aiConfigService;
  const { scopeRef } = surface;
  const storedParams = readParams(config, descriptor.capabilityId);
  const override = resolveOverride(surface, descriptor.capabilityId);
  const showEditorWhen = override.showEditorWhen
    ?? (descriptor.editorKind === 'image' || descriptor.editorKind === 'video' ? 'local' : 'always');

  const t = surface.i18n.t;

  switch (descriptor.editorKind) {
    case 'text': {
      const params: TextGenerateParamsState = parseTextGenerateParams(storedParams);
      return {
        showEditorWhen,
        editor: (
          <TextGenerateParamsEditor
            copy={createTextGenerateEditorCopy(t)}
            params={params}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_TEXT_GENERATE_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'audio-synthesize': {
      const params: AudioSynthesizeParamsState = parseAudioSynthesizeParams(storedParams);
      return {
        showEditorWhen,
        editor: (
          <AudioSynthesizeParamsEditor
            copy={createAudioSynthesizeEditorCopy(t)}
            params={params}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'audio-transcribe': {
      const params: AudioTranscribeParamsState = parseAudioTranscribeParams(storedParams);
      return {
        showEditorWhen,
        editor: (
          <AudioTranscribeParamsEditor
            copy={createAudioTranscribeEditorCopy(t)}
            params={params}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_AUDIO_TRANSCRIBE_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'voice-workflow': {
      const params: VoiceWorkflowParamsState = parseVoiceWorkflowParams(storedParams);
      const voiceAssets = surface.localAssetSource?.list() ?? [];
      return {
        showEditorWhen,
        editor: (
          <VoiceWorkflowParamsEditor
            copy={createVoiceWorkflowEditorCopy(t)}
            params={params}
            assets={[...voiceAssets]}
            assetsLoading={surface.localAssetSource?.loading}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_VOICE_WORKFLOW_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'image': {
      const params: ImageParamsState = parseImageParams(storedParams);
      const companionSlots = (storedParams.companionSlots || {}) as Record<string, string>;
      const imageAssets = surface.localAssetSource?.list() ?? [];
      return {
        showEditorWhen,
        editor: (
          <ImageParamsEditor
            copy={buildImageCopy(t)}
            params={params}
            companionSlots={companionSlots}
            assets={[...imageAssets]}
            assetsLoading={surface.localAssetSource?.loading}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, {
              params: { ...DEFAULT_IMAGE_PARAMS, ...next, companionSlots },
            })}
            onCompanionSlotsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, {
              params: { ...DEFAULT_IMAGE_PARAMS, ...params, companionSlots: next },
            })}
          />
        ),
      };
    }
    case 'video': {
      const params: VideoParamsState = parseVideoParams(storedParams);
      return {
        showEditorWhen,
        editor: (
          <VideoParamsEditor
            copy={buildVideoCopy(t)}
            params={params}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_VIDEO_PARAMS, ...next } })}
          />
        ),
      };
    }
    case null:
    default:
      return { showEditorWhen, editor: null };
  }
}

function buildImageCopy(t: AppModelConfigSurface['i18n']['t']) {
  return {
    companionModelsLabel: t('ModelConfig.editor.image.companionModelsLabel'),
    parametersLabel: t('ModelConfig.editor.image.parametersLabel'),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    sizeLabel: t('ModelConfig.editor.image.sizeLabel'),
    responseFormatLabel: t('ModelConfig.editor.image.responseFormatLabel'),
    seedLabel: t('ModelConfig.editor.common.seedLabel'),
    seedHint: t('ModelConfig.editor.common.seedHint'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    stepsLabel: t('ModelConfig.editor.image.stepsLabel'),
    cfgScaleLabel: t('ModelConfig.editor.image.cfgScaleLabel'),
    samplerLabel: t('ModelConfig.editor.image.samplerLabel'),
    schedulerLabel: t('ModelConfig.editor.image.schedulerLabel'),
    customOptionsLabel: t('ModelConfig.editor.image.customOptionsLabel'),
    customOptionsHint: t('ModelConfig.editor.image.customOptionsHint'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    randomPlaceholder: t('ModelConfig.editor.common.randomPlaceholder'),
    oneOptionPerLinePlaceholder: t('ModelConfig.editor.image.oneOptionPerLinePlaceholder'),
    noneLabel: t('ModelConfig.editor.common.noneLabel'),
  };
}

function buildVideoCopy(t: AppModelConfigSurface['i18n']['t']) {
  return {
    parametersLabel: t('ModelConfig.editor.video.parametersLabel'),
    previewBadgeLabel: t('ModelConfig.editor.common.previewBadgeLabel'),
    modeLabel: t('ModelConfig.editor.video.modeLabel'),
    ratioLabel: t('ModelConfig.editor.video.ratioLabel'),
    durationLabel: t('ModelConfig.editor.video.durationLabel'),
    durationHint: t('ModelConfig.editor.video.durationHint'),
    resolutionLabel: t('ModelConfig.editor.video.resolutionLabel'),
    fpsLabel: t('ModelConfig.editor.video.fpsLabel'),
    seedLabel: t('ModelConfig.editor.common.seedLabel'),
    seedHint: t('ModelConfig.editor.common.seedHint'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    cameraFixedLabel: t('ModelConfig.editor.video.cameraFixedLabel'),
    generateAudioLabel: t('ModelConfig.editor.video.generateAudioLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    randomPlaceholder: t('ModelConfig.editor.common.randomPlaceholder'),
  };
}

export function ModelConfigCapabilityDetail({
  capabilityId,
  surface,
  config,
}: ModelConfigCapabilityDetailProps) {
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId];
  const override = resolveOverride(surface, capabilityId);
  const binding = readBinding(config, capabilityId);

  const handleBindingChange = useCallback((next: ModelConfigRouteBinding | null) => {
    writeCapabilityPatch(surface.aiConfigService, surface.scopeRef, capabilityId, { binding: next });
  }, [capabilityId, surface.aiConfigService, surface.scopeRef]);

  const provider = useMemo(
    () => (descriptor ? resolveProvider(surface, descriptor.sourceRef.capability) : null),
    [descriptor, surface],
  );

  if (!descriptor) {
    return null;
  }

  const { editor, showEditorWhen } = renderEditor(descriptor, surface, config);
  const projection = surface.projectionResolver(capabilityId);
  const t = surface.i18n.t;

  const item: ModelConfigCapabilityItem = {
    capabilityId: descriptor.capabilityId,
    routeCapability: descriptor.sourceRef.capability,
    label: t(descriptor.i18nKeys.title),
    detail: override.detail ?? t(descriptor.i18nKeys.detail),
    binding,
    provider,
    onBindingChange: handleBindingChange,
    status: projection,
    editor,
    showEditorWhen,
    showClearButton: override.showClearButton,
    placeholder: override.placeholder,
    disabled: override.disabled,
    runtimeNotReadyLabel: surface.runtimeNotReadyLabel,
    clearSelectionLabel: override.clearSelectionLabel,
  };

  return <CapabilityModelCard item={item} />;
}
