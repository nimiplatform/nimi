import { useCallback, useMemo } from 'react';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  applyModelConfigCapabilityPatch,
  readModelConfigTargetRef,
} from '@nimiplatform/kit/core/model-config';
import type {
  AppModelConfigSurface,
  CapabilityItemOverride,
  SharedAIConfigService,
} from '@nimiplatform/kit/core/model-config';
import type { NimiAIConfig, NimiJsonValue } from '@nimiplatform/kit/core/sdk-contract';
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
  resolveImageCompanionSlotsForModelFamily,
} from '../constants.js';
import type {
  AudioSynthesizeParamsState,
  AudioTranscribeParamsState,
  ImageParamsState,
  LocalAssetEntry,
  ModelConfigCapabilityItem,
  ModelConfigTargetRef,
  TextGenerateParamsState,
  VideoParamsState,
  VoiceWorkflowParamsState,
} from '../types.js';
import type { NimiRuntimeSpeechVoiceReference } from '@nimiplatform/kit/core/sdk-contract';
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
  config: NimiAIConfig;
  activeModelLabel?: string | null;
  activeModelHint?: string | null;
};

function readParams(config: NimiAIConfig, capabilityId: string): Readonly<Record<string, unknown>> {
  const raw = config.capabilities.selectedParams?.[capabilityId];
  return (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Readonly<Record<string, unknown>>
    : {};
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function localRuntimeRefCandidates(value: unknown): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  const candidates = [
    normalized,
    ...normalized.split(':').map((part) => part.trim()).filter(Boolean),
  ];
  const prefix = 'local-runtime:';
  if (normalized.toLowerCase().startsWith(prefix)) {
    const localAssetId = normalized.slice(prefix.length).trim();
    if (localAssetId) {
      candidates.push(localAssetId);
    }
  }
  return candidates;
}

function targetRefCandidateTexts(targetRef: ModelConfigTargetRef | null): string[] {
  if (!targetRef || targetRef.kind !== 'local-runtime') {
    return [];
  }
  return [
    ...localRuntimeRefCandidates(targetRef.profileBindingId),
    ...localRuntimeRefCandidates(targetRef.readinessRef),
  ].filter(Boolean);
}

function localAssetMatchesCandidate(asset: LocalAssetEntry, candidate: string): boolean {
  return normalizeText(asset.localAssetId) === candidate || normalizeText(asset.assetId) === candidate;
}

function findAssetForLocalTarget(
  assets: readonly LocalAssetEntry[],
  targetRef: ModelConfigTargetRef | null,
): LocalAssetEntry | null {
  const candidates = targetRefCandidateTexts(targetRef);
  if (candidates.length === 0) {
    return null;
  }
  return assets.find((asset) => candidates.some((candidate) => localAssetMatchesCandidate(asset, candidate))) ?? null;
}

function localAssetFamily(asset: LocalAssetEntry | null): string {
  if (!asset) return '';
  const extensible = asset as LocalAssetEntry & {
    readonly family?: unknown;
    readonly modelFamily?: unknown;
    readonly model_family?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  return normalizeText(
    extensible.modelFamily
    ?? extensible.model_family
    ?? extensible.family
    ?? extensible.metadata?.modelFamily
    ?? extensible.metadata?.model_family
    ?? extensible.metadata?.family,
  );
}

function imageModelFamilyFromState(input: {
  readonly storedParams: Readonly<Record<string, unknown>>;
  readonly targetRef: ModelConfigTargetRef | null;
  readonly assets: readonly LocalAssetEntry[];
}): string {
  const paramsFamily = normalizeText(
    input.storedParams.modelFamily
    ?? input.storedParams.model_family
    ?? input.storedParams.runtimeModelFamily
    ?? input.storedParams.runtime_model_family,
  );
  if (paramsFamily) {
    return paramsFamily;
  }
  return localAssetFamily(findAssetForLocalTarget(input.assets, input.targetRef));
}

function writeCapabilityPatch(
  service: SharedAIConfigService,
  scopeRef: AppModelConfigSurface['scopeRef'],
  capabilityId: string,
  patch: {
    targetRef?: ModelConfigTargetRef | null;
    params?: NimiJsonValue;
  },
): void {
  const current = service.aiConfig.get(scopeRef);
  service.aiConfig.update(scopeRef, applyModelConfigCapabilityPatch(current, capabilityId, patch));
}

function resolveOverride(
  surface: AppModelConfigSurface,
  capabilityId: string,
): CapabilityItemOverride {
  return surface.capabilityOverrides?.[capabilityId] ?? {};
}

function resolveProvider(
  surface: AppModelConfigSurface,
  routeCapability: string,
): RouteModelPickerDataProvider | null {
  return (surface.providerResolver(routeCapability) ?? null) as RouteModelPickerDataProvider | null;
}

function sameSpeechVoiceReference(
  left: NimiRuntimeSpeechVoiceReference | null,
  right: NimiRuntimeSpeechVoiceReference | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return !left && !right;
  }
  switch (left.kind) {
    case 'preset_voice_id':
      return left.presetVoiceId === (right.kind === 'preset_voice_id' ? right.presetVoiceId : '');
    case 'voice_asset_id':
      return left.voiceAssetId === (right.kind === 'voice_asset_id' ? right.voiceAssetId : '');
    case 'provider_voice_ref':
      return left.providerVoiceRef === (right.kind === 'provider_voice_ref' ? right.providerVoiceRef : '');
  }
  return false;
}

function renderEditor(
  descriptor: CanonicalCapabilityDescriptor,
  surface: AppModelConfigSurface,
  config: NimiAIConfig,
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
  if (override.hideEditor) {
    return { showEditorWhen, editor: null };
  }

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
            voiceOptions={override.audioSynthesizeVoiceOptions}
            onParamsChange={(next) => {
              const selectedOption = (override.audioSynthesizeVoiceOptions || []).find((option) => (
                sameSpeechVoiceReference(option.value, next.voiceRef)
              ));
              writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, {
                ...(selectedOption?.targetRef ? { targetRef: selectedOption.targetRef } : {}),
                params: { ...DEFAULT_AUDIO_SYNTHESIZE_PARAMS, ...next },
              });
            }}
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
            mode={descriptor.capabilityId === 'voice_workflow.voice_design' ? 'voice_design' : 'voice_clone'}
            onParamsChange={(next) => writeCapabilityPatch(service, scopeRef, descriptor.capabilityId, { params: { ...DEFAULT_VOICE_WORKFLOW_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'image': {
      const params: ImageParamsState = parseImageParams(storedParams);
      const companionSlots = (storedParams.companionSlots || {}) as Record<string, string>;
      const imageAssets = surface.localAssetSource?.list() ?? [];
      const targetRef = readModelConfigTargetRef(config, descriptor.capabilityId);
      const companionSlotDefs = resolveImageCompanionSlotsForModelFamily(imageModelFamilyFromState({
        storedParams: { ...storedParams, modelFamily: params.modelFamily },
        targetRef,
        assets: imageAssets,
      }));
      return {
        showEditorWhen,
        editor: (
          <ImageParamsEditor
            copy={buildImageCopy(t)}
            params={params}
            companionSlots={companionSlots}
            companionSlotDefs={companionSlotDefs}
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
    modelFamilyLabel: t('ModelConfig.editor.image.modelFamilyLabel'),
    companionModelsLabel: t('ModelConfig.editor.image.companionModelsLabel'),
    parametersLabel: t('ModelConfig.editor.image.parametersLabel'),
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
    requiredLabel: translateWithDefault(t, 'ModelConfig.editor.common.requiredLabel', 'Required'),
    requiredSetupPlaceholder: translateWithDefault(t, 'ModelConfig.editor.common.requiredSetupPlaceholder', 'Required setup'),
    setupPendingLabel: translateWithDefault(t, 'ModelConfig.editor.common.setupPendingLabel', 'setup pending'),
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

function translateWithDefault(
  t: AppModelConfigSurface['i18n']['t'],
  key: string,
  defaultValue: string,
): string {
  const translated = t(key, { defaultValue });
  return translated === key ? defaultValue : translated;
}

export function ModelConfigCapabilityDetail({
  capabilityId,
  surface,
  config,
  activeModelLabel,
  activeModelHint,
}: ModelConfigCapabilityDetailProps) {
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId];
  const override = resolveOverride(surface, capabilityId);
  const targetRef = readModelConfigTargetRef(config, capabilityId);

  const handleTargetRefChange = useCallback((next: ModelConfigTargetRef | null) => {
    writeCapabilityPatch(surface.aiConfigService, surface.scopeRef, capabilityId, { targetRef: next });
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
    activeModelLabel: activeModelLabel === null
      ? undefined
      : (activeModelLabel ?? t('ModelConfig.hub.activeModelLabel', { defaultValue: 'Active Model' })),
    activeModelHint: activeModelHint === null
      ? undefined
      : (activeModelHint ?? translateWithDefault(t, 'ModelConfig.hub.activeModelHint', 'Click to change model')),
    activeModelConfiguredLabel: translateWithDefault(t, 'ModelConfig.hub.activeModelConfiguredLabel', 'configured'),
    activeModelSetupPendingLabel: translateWithDefault(t, 'ModelConfig.hub.activeModelSetupPendingLabel', 'setup pending'),
    targetRef,
    provider,
    onTargetRefChange: handleTargetRefChange,
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
