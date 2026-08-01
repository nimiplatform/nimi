import { useCallback, useMemo, useRef, useState } from 'react';
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
  SharedAIConfigPersistenceService,
} from '@nimiplatform/kit/core/model-config';
import type {
  NimiAIConfig,
  NimiAIConfigComponentSelection,
  NimiJsonValue,
} from '@nimiplatform/kit/core/sdk-contract';
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
  ModelConfigProfileCapabilitySummary,
  ModelConfigRouteSelection,
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
  config: NimiAIConfig | null;
  profileCapability?: ModelConfigProfileCapabilitySummary | null;
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

function routeTargetRefFromSelection(
  selection: ModelConfigRouteSelection,
): ModelConfigTargetRef | null {
  if (selection.source === 'local') {
    const profileBindingId = normalizeText(selection.profileBindingId);
    const readinessRef = normalizeText(selection.readinessRef);
    if (Boolean(profileBindingId) === Boolean(readinessRef)) {
      return null;
    }
    return profileBindingId
      ? { kind: 'local-runtime', version: 'v2', profileBindingId }
      : { kind: 'local-runtime', version: 'v2', readinessRef };
  }
  const connectorId = normalizeText(selection.connectorId);
  const remoteModelCatalogId = normalizeText(selection.remoteModelCatalogId);
  const providerModelId = normalizeText(selection.providerModelId);
  if (!connectorId || !remoteModelCatalogId || !providerModelId) {
    return null;
  }
  const provider = normalizeText(selection.provider);
  return {
    kind: 'cloud-connector',
    connectorId,
    remoteModelCatalogId,
    providerModelId,
    ...(provider ? { provider } : {}),
  };
}

function writeCapabilityPatch(
  service: SharedAIConfigPersistenceService,
  scopeRef: AppModelConfigSurface['scopeRef'],
  capabilityId: string,
  patch: {
    logicalModelId?: string | null;
    targetRef?: ModelConfigTargetRef | null;
    selectedComponents?: readonly NimiAIConfigComponentSelection[];
    params?: NimiJsonValue;
  },
): Promise<void> {
  const current = service.aiConfig.get(scopeRef);
  const next = applyModelConfigCapabilityPatch(current, capabilityId, patch);
  const replacesProfileMaterialization = Object.prototype.hasOwnProperty.call(patch, 'logicalModelId')
    || Object.prototype.hasOwnProperty.call(patch, 'targetRef');
  return Promise.resolve(service.aiConfig.update(scopeRef, replacesProfileMaterialization
    ? { ...next, profileOrigin: null }
    : next));
}

type CapabilityPatchWriter = (patch: {
  logicalModelId?: string | null;
  targetRef?: ModelConfigTargetRef | null;
  selectedComponents?: readonly NimiAIConfigComponentSelection[];
  params?: NimiJsonValue;
}) => void;

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
  config: NimiAIConfig | null,
  writePatch: CapabilityPatchWriter,
  profileCapability: ModelConfigProfileCapabilitySummary | null,
): {
  editor: ReturnType<typeof Object> | null;
  showEditorWhen: 'always' | 'local';
} {
  const override = resolveOverride(surface, descriptor.capabilityId);
  const showEditorWhen = override.showEditorWhen
    ?? (descriptor.editorKind === 'image' || descriptor.editorKind === 'video' ? 'local' : 'always');
  if (override.hideEditor || !config) {
    return { showEditorWhen, editor: null };
  }
  const storedParams = readParams(config, descriptor.capabilityId);
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
            onParamsChange={(next) => writePatch({ params: { ...DEFAULT_TEXT_GENERATE_PARAMS, ...next } })}
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
              writePatch({
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
            onParamsChange={(next) => writePatch({ params: { ...DEFAULT_AUDIO_TRANSCRIBE_PARAMS, ...next } })}
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
            onParamsChange={(next) => writePatch({ params: { ...DEFAULT_VOICE_WORKFLOW_PARAMS, ...next } })}
          />
        ),
      };
    }
    case 'image': {
      const params: ImageParamsState = parseImageParams(storedParams);
      const selectedComponents = config.capabilities.selectedComponents?.[descriptor.capabilityId] || [];
      return {
        showEditorWhen,
        editor: (
          <ImageParamsEditor
            copy={buildImageCopy(t)}
            params={params}
            profileComposition={profileCapability}
            selectedComponents={selectedComponents}
            componentCandidates={surface.localAssetSource?.list() || []}
            componentsLoading={surface.localAssetSource?.loading}
            onComponentsChange={(next) => writePatch({ selectedComponents: next })}
            onParamsChange={(next) => {
              writePatch({ params: { ...DEFAULT_IMAGE_PARAMS, ...next } });
            }}
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
            onParamsChange={(next) => writePatch({ params: { ...DEFAULT_VIDEO_PARAMS, ...next } })}
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
    sizeLabel: t('ModelConfig.editor.image.sizeLabel'),
    responseFormatLabel: t('ModelConfig.editor.image.responseFormatLabel'),
    seedLabel: t('ModelConfig.editor.common.seedLabel'),
    seedHint: t('ModelConfig.editor.common.seedHint'),
    timeoutLabel: t('ModelConfig.editor.common.timeoutLabel'),
    stepsLabel: t('ModelConfig.editor.image.stepsLabel'),
    cfgScaleLabel: t('ModelConfig.editor.image.cfgScaleLabel'),
    samplerLabel: t('ModelConfig.editor.image.samplerLabel'),
    schedulerLabel: t('ModelConfig.editor.image.schedulerLabel'),
    defaultPlaceholder: t('ModelConfig.editor.common.defaultPlaceholder'),
    randomPlaceholder: t('ModelConfig.editor.common.randomPlaceholder'),
    noneLabel: t('ModelConfig.editor.common.noneLabel'),
    requiredLabel: translateWithDefault(t, 'ModelConfig.editor.common.requiredLabel', 'Required'),
    requiredSetupPlaceholder: translateWithDefault(t, 'ModelConfig.editor.common.requiredSetupPlaceholder', 'Required setup'),
    setupPendingLabel: translateWithDefault(t, 'ModelConfig.editor.common.setupPendingLabel', 'setup pending'),
    mainModelLabel: translateWithDefault(t, 'ModelConfig.editor.image.mainModelLabel', 'Main model'),
    compositionRuntimeOwnedHint: translateWithDefault(
      t,
      'ModelConfig.editor.image.compositionRuntimeOwnedHint',
      'Component slots came from the applied AI Profile. Changes are saved only to this AI configuration.',
    ),
    compositionUnavailableHint: translateWithDefault(
      t,
      'ModelConfig.editor.image.compositionUnavailableHint',
      'Apply an AI Profile with component slots before configuring this workflow.',
    ),
    componentPickerTitle: translateWithDefault(t, 'ModelConfig.editor.image.componentPickerTitle', 'Select component model'),
    componentSearchPlaceholder: translateWithDefault(t, 'ModelConfig.editor.image.componentSearchPlaceholder', 'Search component models'),
    componentLoadingLabel: translateWithDefault(t, 'ModelConfig.editor.image.componentLoadingLabel', 'Loading component models...'),
    componentEmptyLabel: translateWithDefault(t, 'ModelConfig.editor.image.componentEmptyLabel', 'No compatible component models available.'),
    componentSelectedLabel: translateWithDefault(t, 'ModelConfig.editor.image.componentSelectedLabel', 'Selected'),
    currentUnavailableLabel: translateWithDefault(t, 'ModelConfig.editor.image.currentUnavailableLabel', 'Currently unavailable'),
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
  profileCapability = null,
  activeModelLabel,
  activeModelHint,
}: ModelConfigCapabilityDetailProps) {
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId];
  const override = resolveOverride(surface, capabilityId);
  const targetRef = config ? readModelConfigTargetRef(config, capabilityId) : null;
  const routeIntent = surface.routeIntentResolver?.(capabilityId) ?? null;
  const routeSelection: ModelConfigRouteSelection | null = routeIntent ? {
    source: routeIntent.routePolicy,
    connectorId: '',
    model: routeIntent.model,
    modelLabel: routeIntent.model,
    ...(routeIntent.routePolicy === 'cloud'
      ? {
          provider: routeIntent.provider,
          providerModelId: routeIntent.model,
          ...(routeIntent.targetRef?.kind === 'cloud-connector' ? {
            connectorId: routeIntent.targetRef.connectorId,
            remoteModelCatalogId: routeIntent.targetRef.remoteModelCatalogId,
          } : {}),
        }
      : {
          localModelId: routeIntent.model,
          ...(routeIntent.targetRef?.kind === 'local-runtime' ? {
            profileBindingId: routeIntent.targetRef.profileBindingId,
            readinessRef: routeIntent.targetRef.readinessRef,
          } : {}),
        }),
  } : null;
  const [writeError, setWriteError] = useState<string | null>(null);
  const [initialImageProfileRequired, setInitialImageProfileRequired] = useState(false);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const writeSequenceRef = useRef(0);
  const latestWriteSequenceRef = useRef(0);

  const writePatch = useCallback((patch: {
    logicalModelId?: string | null;
    targetRef?: ModelConfigTargetRef | null;
    selectedComponents?: readonly NimiAIConfigComponentSelection[];
    params?: NimiJsonValue;
  }) => {
    const sequence = writeSequenceRef.current + 1;
    writeSequenceRef.current = sequence;
    latestWriteSequenceRef.current = sequence;
    setWriteError(null);
    const commit = writeQueueRef.current
      .catch(() => undefined)
      .then(() => {
        return writeCapabilityPatch(surface.aiConfigService, surface.scopeRef, capabilityId, patch);
      });
    writeQueueRef.current = commit;
    void commit
      .then(() => {
        if (latestWriteSequenceRef.current === sequence) {
          setWriteError(null);
        }
      })
      .catch((error: unknown) => {
        if (latestWriteSequenceRef.current !== sequence) {
          return;
        }
        setWriteError(error instanceof Error ? error.message : String(error || 'AI config save failed.'));
      });
  }, [capabilityId, surface, surface.scopeRef]);

  const handleTargetRefChange = useCallback((next: ModelConfigTargetRef | null) => {
    writePatch({ targetRef: next });
  }, [writePatch]);

  const handleRouteSelectionChange = useCallback((selection: ModelConfigRouteSelection | null) => {
    if (!selection) {
      writePatch({ logicalModelId: null, targetRef: null });
      return;
    }
    const hasCommittedImageOccurrenceStructure = Boolean(
      config?.capabilities.selectedComponents?.['image.generate']?.length,
    );
    if (capabilityId === 'image.generate' && !hasCommittedImageOccurrenceStructure) {
      setInitialImageProfileRequired(true);
      return;
    }
    setInitialImageProfileRequired(false);
    const logicalModelId = normalizeText(selection.source === 'cloud'
      ? (selection.providerModelId || selection.model)
      : (selection.modelId || selection.model));
    if (!logicalModelId) {
      throw new Error('The selected model route does not carry a logical model identity.');
    }
    const targetRef = routeTargetRefFromSelection(selection);
    writePatch({
      logicalModelId,
      targetRef,
    });
  }, [capabilityId, config, writePatch]);

  const provider = useMemo(
    () => (descriptor ? resolveProvider(surface, descriptor.sourceRef.capability) : null),
    [descriptor, surface],
  );

  if (!descriptor) {
    return null;
  }

  const { editor, showEditorWhen } = renderEditor(descriptor, surface, config, writePatch, profileCapability);
  const baseProjection = surface.projectionResolver(capabilityId);
  const projection = writeError
    ? {
        ...baseProjection,
        supported: false,
        tone: 'attention' as const,
        badgeLabel: translateWithDefault(surface.i18n.t, 'ModelConfig.saveFailedBadgeLabel', 'Save failed'),
        title: translateWithDefault(surface.i18n.t, 'ModelConfig.saveFailedTitle', 'AI config save failed'),
        detail: writeError,
      }
    : initialImageProfileRequired
      ? {
          supported: false,
          tone: 'attention' as const,
          badgeLabel: translateWithDefault(surface.i18n.t, 'ModelConfig.imageProfileRequiredBadgeLabel', 'Profile required'),
          title: translateWithDefault(surface.i18n.t, 'ModelConfig.imageProfileRequiredTitle', 'Apply an AI Profile first'),
          detail: translateWithDefault(
            surface.i18n.t,
            'ModelConfig.imageProfileRequiredDetail',
            'Initial image configuration must come from a complete AI Profile so Runtime can commit its component occurrence structure.',
          ),
        }
    : baseProjection;
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
    routeSelection,
    provider,
    onTargetRefChange: handleTargetRefChange,
    onRouteSelectionChange: handleRouteSelectionChange,
    status: projection,
    editor,
    showEditorWhen,
    showClearButton: override.showClearButton,
    placeholder: override.placeholder,
    disabled: override.disabled,
    runtimeNotReadyLabel: surface.runtimeNotReadyLabel,
    clearSelectionLabel: override.clearSelectionLabel,
    modelPickerCopy: {
      title: translateWithDefault(t, 'ModelConfig.modelPicker.title', 'Select Model'),
      local: translateWithDefault(t, 'ModelConfig.modelPicker.local', 'Local'),
      cloud: translateWithDefault(t, 'ModelConfig.modelPicker.cloud', 'Cloud'),
      selectConnectorLabel: translateWithDefault(t, 'ModelConfig.modelPicker.selectConnectorLabel', 'Select connector'),
      searchPlaceholder: translateWithDefault(t, 'ModelConfig.modelPicker.searchPlaceholder', 'Search models'),
      loading: translateWithDefault(t, 'ModelConfig.modelPicker.loading', 'Loading models...'),
      noSearchResults: translateWithDefault(t, 'ModelConfig.modelPicker.noSearchResults', 'No models match your search.'),
      noModelsAvailable: translateWithDefault(t, 'ModelConfig.modelPicker.noModelsAvailable', 'No models available.'),
    },
  };

  return <CapabilityModelCard item={item} />;
}
