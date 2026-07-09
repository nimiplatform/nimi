import { useEffect, useMemo, useState } from 'react';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AppModelConfigSurface,
  ModelConfigProjectionStatus,
  SharedAIConfigService,
} from '@nimiplatform/kit/core/model-config';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  type ModelConfigProfileController,
  type ModelConfigProfileCopy,
  type ModelConfigSuperSection,
} from '@nimiplatform/kit/features/model-config';
import type {
  AgentCenterAgentAIConfigIntents,
  AgentCenterCapabilityId,
  AgentCenterCapabilityState,
  AgentCenterModelConfigCopyKey,
  AgentCenterModelCopy,
  AgentCenterModelSuperSectionId,
  AgentCenterRuntimeAIConfigBinding,
  AgentCenterRuntimeAdapter,
  AgentCenterRuntimeSnapshot,
  AgentCenterState,
} from '../types.js';
import {
  Notice,
  SectionHeader,
  SectionShell,
} from './AgentCenterPrimitives.js';

export interface AgentCenterModelSectionProps {
  readonly state: AgentCenterState;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
  readonly copy?: AgentCenterModelCopy;
}

const MODEL_SCOPE_REF: NimiAIScopeRef = {
  kind: 'feature',
  ownerId: 'runtime-agent-ai-config',
  surfaceId: 'agent-center',
};

const AGENT_CENTER_MODEL_CAPABILITIES: readonly AgentCenterCapabilityId[] = [
  'text.generate',
  'text.embed',
  'audio.synthesize',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
  'image.generate',
];

const MODEL_SUPER_SECTIONS: readonly (ModelConfigSuperSection & { readonly id: AgentCenterModelSuperSectionId })[] = [
  { id: 'conversation', label: 'Conversation', sections: ['chat', 'embed'] },
  { id: 'voice', label: 'Voice', sections: ['tts', 'voice'] },
  { id: 'media', label: 'Media', sections: ['image'] },
];

const MODEL_CONFIG_COPY: Record<AgentCenterModelConfigCopyKey, string> = {
  'ModelConfig.hub.title': 'AI Model',
  'ModelConfig.hub.aggregateReady': 'Runtime ready',
  'ModelConfig.hub.aggregateAttention': 'Needs setup',
  'ModelConfig.hub.aggregateNeutral': 'Not configured',
  'ModelConfig.hub.aggregateEmpty': 'No model routes configured',
  'ModelConfig.hub.backLabel': 'Back',
  'ModelConfig.hub.detailStatusReady': 'Runtime Ready',
  'ModelConfig.hub.detailStatusAttention': 'Needs Setup',
  'ModelConfig.hub.detailStatusNeutral': 'Not Configured',
  'ModelConfig.hub.detailTitleFormat': '{{section}} Configuration',
  'ModelConfig.hub.activeModelLabel': 'Active Model',
  'ModelConfig.hub.activeModelHint': 'Click to change model',
  'ModelConfig.hub.activeModelConfiguredLabel': 'configured',
  'ModelConfig.hub.activeModelSetupPendingLabel': 'setup pending',
  'ModelConfig.profile.sectionTitle': 'AI Profile',
  'ModelConfig.profile.summaryLabel': 'AI Profile',
  'ModelConfig.profile.emptySummaryLabel': 'No profile applied',
  'ModelConfig.profile.applyButtonLabel': 'Apply',
  'ModelConfig.profile.changeButtonLabel': 'Change',
  'ModelConfig.profile.manageButtonTitle': 'Manage profiles',
  'ModelConfig.profile.modalTitle': 'Import AI Profile',
  'ModelConfig.profile.modalHint': 'Runtime Agent AI Config profile import is not admitted on this surface yet.',
  'ModelConfig.profile.loadingLabel': 'Loading profiles...',
  'ModelConfig.profile.emptyLabel': 'Profile import is not available for Runtime Agent AI Config.',
  'ModelConfig.profile.currentBadgeLabel': 'Current',
  'ModelConfig.profile.cancelLabel': 'Cancel',
  'ModelConfig.profile.confirmLabel': 'Confirm',
  'ModelConfig.profile.applyingLabel': 'Applying...',
  'ModelConfig.profile.reloadLabel': 'Reload',
  'ModelConfig.profile.importLabel': 'Import AI Profile',
  'ModelConfig.profile.previewTitle': 'Preview Profile',
  'ModelConfig.profile.previewHint': 'Review Runtime Agent AI Config changes before applying.',
  'ModelConfig.profile.previewingLabel': 'Previewing...',
  'ModelConfig.profile.previewFirstApplyLabel': 'This is the first profile apply for this surface.',
  'ModelConfig.profile.previewNoChangeLabel': 'No changes.',
  'ModelConfig.profile.previewBeforeLabel': 'Before',
  'ModelConfig.profile.previewAfterLabel': 'After',
  'ModelConfig.profile.previewWarningsLabel': 'Warnings',
  'ModelConfig.profile.previewConfirmLabel': 'Apply profile',
  'ModelConfig.profile.previewBackLabel': 'Back',
  'ModelConfig.section.chat.title': 'Chat',
  'ModelConfig.section.tts.title': 'Speech',
  'ModelConfig.section.image.title': 'Image',
  'ModelConfig.section.voice.title': 'Voice Workflow',
  'ModelConfig.section.embed.title': 'Embedding',
  'ModelConfig.capability.textGenerate.title': 'Text Generation',
  'ModelConfig.capability.textGenerate.subtitle': 'Runtime local agent chat and lifecycle',
  'ModelConfig.capability.textGenerate.detail': 'Committed Runtime Agent AI Config text.generate intent.',
  'ModelConfig.capability.textEmbed.title': 'Embedding',
  'ModelConfig.capability.textEmbed.subtitle': 'Memory, cognition, and activity retrieval',
  'ModelConfig.capability.textEmbed.detail': 'Committed Runtime Agent AI Config text.embed intent.',
  'ModelConfig.capability.audioSynthesize.title': 'Speech Synthesis',
  'ModelConfig.capability.audioSynthesize.subtitle': 'Runtime-owned voice output route',
  'ModelConfig.capability.audioSynthesize.detail': 'Committed Runtime Agent AI Config audio.synthesize intent.',
  'ModelConfig.capability.voiceWorkflowVoiceClone.title': 'Voice Clone',
  'ModelConfig.capability.voiceWorkflowVoiceClone.subtitle': 'Runtime voice workflow route',
  'ModelConfig.capability.voiceWorkflowVoiceClone.detail': 'Committed Runtime Agent AI Config voice clone intent.',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.title': 'Voice Design',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.subtitle': 'Runtime voice workflow route',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.detail': 'Committed Runtime Agent AI Config voice design intent.',
  'ModelConfig.capability.imageGenerate.title': 'Image Generation',
  'ModelConfig.capability.imageGenerate.subtitle': 'Runtime image action route',
  'ModelConfig.capability.imageGenerate.detail': 'Committed Runtime Agent AI Config image.generate intent.',
  'ModelConfig.modelPicker.title': 'Select Model',
  'ModelConfig.modelPicker.local': 'Local',
  'ModelConfig.modelPicker.cloud': 'Cloud',
  'ModelConfig.modelPicker.selectConnectorLabel': 'Select connector',
  'ModelConfig.modelPicker.searchPlaceholder': 'Search models',
  'ModelConfig.modelPicker.loading': 'Loading models...',
  'ModelConfig.modelPicker.noSearchResults': 'No models match your search.',
  'ModelConfig.modelPicker.noModelsAvailable': 'No models available.',
};

type ResolvedAgentCenterModelCopy = {
  readonly sectionTitle: string;
  readonly superSectionLabels: Record<AgentCenterModelSuperSectionId, string>;
  readonly modelConfig: Record<AgentCenterModelConfigCopyKey, string>;
  readonly detailActiveModelHint: string;
  readonly setupRequiredLabel: string;
  readonly runtimeModelPickerUnavailableLabel: string;
  readonly notConfiguredLabel: string;
  readonly profileImportUnsupportedLabel: string;
  readonly parameterEditRejected: string;
  readonly profileSliceRefRejected: string;
  readonly adapterUnavailable: string;
  readonly revisionUnavailable: string;
  readonly savingStatus: string;
  readonly savedStatusFormat: string;
  readonly updateFailed: string;
  readonly projectionReadyBadge: string;
  readonly projectionReadyTitle: string;
  readonly projectionNeedsSetupBadge: string;
  readonly projectionRouteNotConfiguredTitle: string;
  readonly projectionModelRequiredTitle: string;
  readonly projectionUnavailableTitle: string;
  readonly modelSelectionUnresolvedSuffix: string;
};

const DEFAULT_MODEL_COPY: ResolvedAgentCenterModelCopy = {
  sectionTitle: 'Model',
  superSectionLabels: {
    conversation: 'Conversation',
    voice: 'Voice',
    media: 'Media',
  },
  modelConfig: MODEL_CONFIG_COPY,
  detailActiveModelHint: 'Click to change model',
  setupRequiredLabel: 'Setup required',
  runtimeModelPickerUnavailableLabel: 'Runtime model picker unavailable',
  notConfiguredLabel: 'Not configured',
  profileImportUnsupportedLabel: 'Runtime Agent AI Config profile import is not admitted on this surface.',
  parameterEditRejected: 'Runtime Agent AI Config does not admit app-scope model parameter edits on this surface.',
  profileSliceRefRejected: 'Runtime Agent AI Config does not accept profile-slice model refs on this surface.',
  adapterUnavailable: 'Runtime Agent AI Config adapter unavailable.',
  revisionUnavailable: 'Runtime Agent AI Config revision unavailable.',
  savingStatus: 'Saving Runtime Agent AI Config model selection.',
  savedStatusFormat: 'Saved Runtime Agent AI Config revision {{revision}}.',
  updateFailed: 'Runtime Agent AI Config update failed.',
  projectionReadyBadge: 'Ready',
  projectionReadyTitle: 'Runtime ready',
  projectionNeedsSetupBadge: 'Needs setup',
  projectionRouteNotConfiguredTitle: 'Runtime route not configured',
  projectionModelRequiredTitle: 'Model selection required',
  projectionUnavailableTitle: 'Runtime projection unavailable',
  modelSelectionUnresolvedSuffix: 'model selection did not resolve a Runtime model id.',
};

function resolveModelCopy(copy: AgentCenterModelCopy | undefined): ResolvedAgentCenterModelCopy {
  return {
    ...DEFAULT_MODEL_COPY,
    ...(copy || {}),
    superSectionLabels: {
      ...DEFAULT_MODEL_COPY.superSectionLabels,
      ...(copy?.superSectionLabels || {}),
    },
    modelConfig: {
      ...MODEL_CONFIG_COPY,
      ...(copy?.modelConfig || {}),
    },
  };
}

function formatCopy(template: string, vars?: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars?.[name] ?? ''));
}

function createTranslator(copy: ResolvedAgentCenterModelCopy) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const template = copy.modelConfig[key as AgentCenterModelConfigCopyKey]
      || (typeof vars?.defaultValue === 'string' ? String(vars.defaultValue) : key);
    return formatCopy(template, vars);
  };
}

function superSectionsForCopy(copy: ResolvedAgentCenterModelCopy): readonly ModelConfigSuperSection[] {
  return MODEL_SUPER_SECTIONS.map((section) => ({
    ...section,
    label: copy.superSectionLabels[section.id],
  }));
}

function buildRequirementDeclaration(): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: 'runtime-agent-ai-config:agent-center',
    scopeRef: MODEL_SCOPE_REF,
    requiredSlices: AGENT_CENTER_MODEL_CAPABILITIES.map((capability) => ({
      requirementSliceId: `runtime-agent:${capability}`,
      capability,
      profileSliceRef: `runtime-agent:${capability}`,
      readinessPolicy: capability === 'text.generate' || capability === 'text.embed' ? 'required' : 'optional',
    })),
    setupProjectionPolicy: 'runtime-agent-ai-config',
  };
}

function bindingTargetRefToModelTargetRef(
  targetRef: AgentCenterRuntimeAIConfigBinding['targetRef'] | undefined,
): NimiAIConfigTargetRef | null {
  if (!targetRef) return null;
  if (targetRef.kind === 'local-runtime') {
    return targetRef;
  }
  return {
    kind: 'cloud-connector',
    connectorId: targetRef.connectorId,
    remoteModelCatalogId: targetRef.remoteModelCatalogId,
    providerModelId: targetRef.providerModelId,
    ...(targetRef.provider ? { provider: targetRef.provider } : {}),
  };
}

function modelTargetRefToRuntimeTargetRef(
  targetRef: NimiAIConfigTargetRef,
  copy: ResolvedAgentCenterModelCopy,
): NonNullable<AgentCenterRuntimeAIConfigBinding['targetRef']> {
  if (targetRef.kind === 'local-runtime') {
    return targetRef;
  }
  if (targetRef.kind === 'cloud-connector') {
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: targetRef.connectorId,
      remoteModelCatalogId: targetRef.remoteModelCatalogId,
      providerModelId: targetRef.providerModelId,
      ...(targetRef.provider ? { provider: targetRef.provider } : {}),
    };
  }
  throw new Error(copy.profileSliceRefRejected);
}

function modelIdFromTargetRef(
  targetRef: NimiAIConfigTargetRef,
  fallback: string,
): string {
  if (targetRef.kind === 'local-runtime') {
    return targetRef.profileBindingId || targetRef.readinessRef || fallback;
  }
  if (targetRef.kind === 'cloud-connector') {
    return targetRef.providerModelId || fallback;
  }
  return fallback;
}

function targetRefsEqual(
  left: NimiAIConfigTargetRef | null | undefined,
  right: NimiAIConfigTargetRef | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function runtimeConfigToNimiAIConfig(state: AgentCenterState): NimiAIConfig {
  const targetRefs: Record<string, NimiAIConfigTargetRef> = {};
  for (const capability of state.capabilities) {
    const targetRef = bindingTargetRefToModelTargetRef(capability.binding?.targetRef);
    if (targetRef) {
      targetRefs[capability.capability] = targetRef;
    }
  }
  return {
    scopeRef: MODEL_SCOPE_REF,
    capabilities: {
      targetRefs,
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

function buildCurrentIntents(state: AgentCenterState): Record<string, AgentCenterRuntimeAIConfigBinding> {
  const intents: Record<string, AgentCenterRuntimeAIConfigBinding> = {};
  for (const capability of state.capabilities) {
    if (capability.binding) {
      intents[capability.capability] = capability.binding;
    }
  }
  return intents;
}

function runtimeIntentsFromModelConfig(
  state: AgentCenterState,
  nextConfig: NimiAIConfig,
  copy: ResolvedAgentCenterModelCopy,
): AgentCenterAgentAIConfigIntents {
  if (Object.keys(nextConfig.capabilities.selectedParams || {}).length > 0) {
    throw new Error(copy.parameterEditRejected);
  }
  const nextIntents = buildCurrentIntents(state);
  for (const capability of state.capabilities) {
    const targetRef = nextConfig.capabilities.targetRefs[capability.capability];
    const previousTargetRef = bindingTargetRefToModelTargetRef(capability.binding?.targetRef);
    if (targetRefsEqual(previousTargetRef, targetRef)) {
      continue;
    }
    if (!targetRef) {
      if (!capability.required) {
        delete nextIntents[capability.capability];
      }
      continue;
    }
    const runtimeTargetRef = modelTargetRefToRuntimeTargetRef(targetRef, copy);
    const current = capability.binding || undefined;
    const route = runtimeTargetRef.kind === 'cloud-connector' ? 'cloud' : 'local';
    const modelId = modelIdFromTargetRef(targetRef, current?.modelId || '');
    if (!modelId) {
      throw new Error(`${capability.label} ${copy.modelSelectionUnresolvedSuffix}`);
    }
    nextIntents[capability.capability] = {
      ...current,
      route,
      modelId,
      targetRef: runtimeTargetRef,
      ...(runtimeTargetRef.kind === 'cloud-connector' ? { connectorId: runtimeTargetRef.connectorId } : {}),
    };
  }
  return nextIntents;
}

type RuntimeModelConfigService = SharedAIConfigService & {
  syncState(nextState: AgentCenterState): void;
};

type RuntimeAgentAIConfigSnapshot = NonNullable<AgentCenterRuntimeSnapshot['agentAIConfig']>;

function modelStateWithSnapshot(
  base: AgentCenterState,
  snapshot: RuntimeAgentAIConfigSnapshot,
): AgentCenterState {
  return {
    ...base,
    configRevision: snapshot.revision,
    capabilities: base.capabilities.map((capability) => ({
      ...capability,
      binding: snapshot.intents[capability.capability] || null,
    })),
  };
}

function shouldAdoptExternalModelState(current: AgentCenterState, next: AgentCenterState): boolean {
  if (next.configRevision === null) {
    return current.configRevision === null;
  }
  if (current.configRevision === null) {
    return true;
  }
  return next.configRevision >= current.configRevision;
}

function createRuntimeModelConfigService(input: {
  readonly copy: ResolvedAgentCenterModelCopy;
  readonly state: AgentCenterState;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
  readonly onCommittedState: (state: AgentCenterState) => void;
  readonly onStatus: (status: string) => void;
}): RuntimeModelConfigService {
  let currentState = input.state;
  let currentConfig = runtimeConfigToNimiAIConfig(currentState);
  const listeners = new Set<(next: NimiAIConfig) => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener(currentConfig);
    }
  };
  const commitState = (nextState: AgentCenterState) => {
    currentState = nextState;
    currentConfig = runtimeConfigToNimiAIConfig(nextState);
    input.onCommittedState(nextState);
    notify();
  };
  const refreshAfterFailure = async () => {
    if (!input.runtimeAdapter?.loadSnapshot) {
      return;
    }
    const snapshot = await input.runtimeAdapter.loadSnapshot();
    if (snapshot.agentAIConfig) {
      commitState(modelStateWithSnapshot(currentState, snapshot.agentAIConfig));
    }
  };
  return {
    syncState(nextState) {
      if (shouldAdoptExternalModelState(currentState, nextState)) {
        commitState(nextState);
      }
    },
    aiConfig: {
      get() {
        return currentConfig;
      },
      update(_scopeRef, next) {
        if (!input.runtimeAdapter?.upsertAgentAIConfig) {
          throw new Error(input.copy.adapterUnavailable);
        }
        if (currentState.configRevision === null) {
          throw new Error(input.copy.revisionUnavailable);
        }
        const expectedRevision = currentState.configRevision;
        const nextIntents = runtimeIntentsFromModelConfig(currentState, next, input.copy);
        currentConfig = next;
        notify();
        input.onStatus(input.copy.savingStatus);
        void input.runtimeAdapter.upsertAgentAIConfig({
          expectedRevision,
          intents: nextIntents,
        }).then((snapshot) => {
          commitState(modelStateWithSnapshot(currentState, snapshot));
          input.onStatus(formatCopy(input.copy.savedStatusFormat, { revision: snapshot.revision }));
        }).catch((error: unknown) => {
          currentConfig = runtimeConfigToNimiAIConfig(currentState);
          notify();
          void refreshAfterFailure().catch(() => undefined);
          input.onStatus(error instanceof Error && error.message ? error.message : input.copy.updateFailed);
        });
      },
      subscribe(_scopeRef, listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    aiProfile: {
      async list() {
        return [];
      },
      async previewApply(): Promise<NimiAIProfilePreviewResult> {
        return {
          before: currentConfig,
          after: null,
          outcome: 'unsupported_no_live_config',
          diff: { identical: true, fields: [] },
          baseVersion: String(currentState.configRevision ?? 0),
          probeWarnings: [input.copy.profileImportUnsupportedLabel],
        };
      },
      async apply(): Promise<NimiAIProfileApplyResult> {
        return {
          success: false,
          config: null,
          failureReason: input.copy.profileImportUnsupportedLabel,
          outcome: 'unsupported_no_live_config',
          probeWarnings: [],
        };
      },
    },
  };
}

function projectionForCapability(
  capability: AgentCenterCapabilityState,
  copy: ResolvedAgentCenterModelCopy,
): ModelConfigProjectionStatus {
  if (capability.readinessState === 'ready') {
    return {
      supported: true,
      tone: 'ready',
      badgeLabel: copy.projectionReadyBadge,
      title: copy.projectionReadyTitle,
      detail: null,
    };
  }
  if (capability.readinessState === 'not_configured') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: copy.projectionNeedsSetupBadge,
      title: capability.binding ? copy.projectionRouteNotConfiguredTitle : copy.projectionModelRequiredTitle,
      detail: capability.summary,
    };
  }
  return {
    supported: false,
    tone: capability.readinessState === 'unavailable' ? 'attention' : 'neutral',
    badgeLabel: capability.readinessState,
    title: capability.reasonCode || copy.projectionUnavailableTitle,
    detail: capability.summary,
  };
}

function createEmptyProfileController(copy: ModelConfigProfileCopy): ModelConfigProfileController {
  return {
    currentOrigin: null,
    profiles: [],
    selectedProfileId: null,
    isLoading: false,
    error: null,
    applying: false,
    previewing: false,
    preview: null,
    copy,
    onSelectedProfileChange: () => undefined,
    onApply: () => undefined,
    onConfirmApply: () => undefined,
    onCancelPreview: () => undefined,
  };
}

export function AgentCenterModelSection({ state, runtimeAdapter, copy }: AgentCenterModelSectionProps) {
  const [status, setStatus] = useState('');
  const [modelState, setModelState] = useState(state);
  const labels = useMemo(() => resolveModelCopy(copy), [copy]);
  const t = useMemo(() => createTranslator(labels), [labels]);
  const superSections = useMemo(() => superSectionsForCopy(labels), [labels]);
  const service = useMemo(
    () => createRuntimeModelConfigService({
      copy: labels,
      state,
      runtimeAdapter,
      onCommittedState: setModelState,
      onStatus: setStatus,
    }),
    [labels, runtimeAdapter?.upsertAgentAIConfig, state.configRevision],
  );
  useEffect(() => {
    service.syncState(state);
  }, [service, state]);
  const profile = useMemo(
    () => createEmptyProfileController(defaultModelConfigProfileCopy(t)),
    [t],
  );
  const capabilityById = useMemo(() => {
    const map = new Map<string, AgentCenterCapabilityState>();
    for (const capability of modelState.capabilities) {
      map.set(capability.capability, capability);
    }
    return map;
  }, [modelState.capabilities]);
  const surface = useMemo<AppModelConfigSurface>(() => ({
    scopeRef: MODEL_SCOPE_REF,
    aiConfigService: service,
    requirementDeclaration: buildRequirementDeclaration(),
    providerResolver: (routeCapability) => runtimeAdapter?.modelConfig?.providerResolver?.(routeCapability) ?? null,
    projectionResolver: (capabilityId) => {
      const capability = capabilityById.get(capabilityId);
      return capability ? projectionForCapability(capability, labels) : null;
    },
    localAssetSource: runtimeAdapter?.modelConfig?.localAssetSource || undefined,
    capabilityOverrides: Object.fromEntries(
      AGENT_CENTER_MODEL_CAPABILITIES.map((capability) => [
        capability,
        {
          hideEditor: true,
          showClearButton: capability !== 'text.generate' && capability !== 'text.embed',
          placeholder: runtimeAdapter?.modelConfig?.providerResolver
            ? labels.setupRequiredLabel
            : labels.runtimeModelPickerUnavailableLabel,
        },
      ]),
    ),
    runtimeNotReadyLabel: runtimeAdapter?.modelConfig?.providerResolver
      ? labels.setupRequiredLabel
      : labels.runtimeModelPickerUnavailableLabel,
    i18n: { t },
  }), [capabilityById, labels, runtimeAdapter?.modelConfig?.localAssetSource, runtimeAdapter?.modelConfig?.providerResolver, service, t]);

  return (
    <SectionShell labelledBy="agent-center-model-title">
      <SectionHeader
        id="agent-center-model-title"
        title={labels.sectionTitle}
      />
      <div
        data-agent-center-model-apply="runtime-agent-ai-config"
        data-agent-center-model-surface="runtime-model-config-hub"
      >
        {modelState.capabilities.map((capability) => (
          <span
            data-agent-center-model-binding={capability.capability}
            hidden
            key={capability.capability}
          >
            {capability.binding?.modelId || labels.notConfiguredLabel}
          </span>
        ))}
        <ModelConfigAiModelHub
          detailActiveModelHint={labels.detailActiveModelHint}
          profile={profile}
          superSections={superSections}
          surface={surface}
        />
      </div>
      {status ? <Notice>{status}</Notice> : null}
    </SectionShell>
  );
}
