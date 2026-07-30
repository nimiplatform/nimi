import { useEffect, useMemo, useState } from 'react';
import type {
  NimiAICapabilityRequirementDeclaration,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AppModelConfigSurface,
  ModelConfigProjectionStatus,
  ModelConfigSettingsProjection,
  ModelConfigSettingsService,
} from '@nimiplatform/kit/core/model-config';
import {
  ModelConfigAiModelHub,
  type ModelConfigSuperSection,
} from '@nimiplatform/kit/features/model-config';
import type {
  AgentCenterCapabilityState,
  AgentCenterModelConfigCopyKey,
  AgentCenterI18n,
  AgentCenterModelCopy,
  AgentCenterModelSuperSectionId,
  AgentCenterRuntimeModelSettingsProjection,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog, getAgentCenterCatalogRecord } from '../locales/index.js';
import {
  Notice,
  SectionHeader,
  SectionShell,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterModelSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

const MODEL_SUPER_SECTIONS: readonly (ModelConfigSuperSection & { readonly id: AgentCenterModelSuperSectionId })[] = [
  { id: 'conversation', label: agentCenterEnCatalog['AgentCenter.model.superSectionConversation'], sections: ['chat', 'embed'] },
  { id: 'voice', label: agentCenterEnCatalog['AgentCenter.model.superSectionVoice'], sections: ['tts', 'stt', 'voice'] },
  { id: 'media', label: agentCenterEnCatalog['AgentCenter.model.superSectionMedia'], sections: ['image'] },
];

const MODEL_CONFIG_COPY = getAgentCenterCatalogRecord('ModelConfig.', { preserveKeys: true }) as Record<AgentCenterModelConfigCopyKey, string>;

type ResolvedAgentCenterModelCopy = {
  readonly sectionTitle: string;
  readonly superSectionLabels: Record<AgentCenterModelSuperSectionId, string>;
  readonly modelConfig: Record<AgentCenterModelConfigCopyKey, string>;
  readonly detailActiveModelHint: string;
  readonly setupRequiredLabel: string;
  readonly runtimeModelPickerUnavailableLabel: string;
  readonly notConfiguredLabel: string;
  readonly revisionUnavailable: string;
  readonly projectionReadyBadge: string;
  readonly projectionReadyTitle: string;
  readonly projectionNeedsSetupBadge: string;
  readonly projectionRouteNotConfiguredTitle: string;
  readonly projectionModelRequiredTitle: string;
  readonly projectionUnavailableTitle: string;
};

const MODEL_COPY_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.model.');
const DEFAULT_MODEL_COPY = {
  ...MODEL_COPY_DEFAULTS,
  sectionTitle: MODEL_COPY_DEFAULTS.sectionTitle,
  superSectionLabels: {
    conversation: MODEL_COPY_DEFAULTS.superSectionConversation,
    voice: MODEL_COPY_DEFAULTS.superSectionVoice,
    media: MODEL_COPY_DEFAULTS.superSectionMedia,
  },
  modelConfig: MODEL_CONFIG_COPY,
} as ResolvedAgentCenterModelCopy;

function resolveModelCopy(
  copy: AgentCenterModelCopy | undefined,
  i18n: AgentCenterI18n | undefined,
): ResolvedAgentCenterModelCopy {
  const compatibilityCopy = {
    ...DEFAULT_MODEL_COPY,
    ...(copy || {}),
    superSectionLabels: {
      ...DEFAULT_MODEL_COPY.superSectionLabels,
      ...(copy?.superSectionLabels || {}),
    },
    modelConfig: Object.fromEntries(
      Object.entries({ ...MODEL_CONFIG_COPY, ...(copy?.modelConfig || {}) })
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  } as ResolvedAgentCenterModelCopy;
  const translatedScalars = Object.fromEntries(
    Object.entries(compatibilityCopy)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, translateAgentCenter(i18n, `AgentCenter.model.${key}`, value)]),
  );
  return {
    ...compatibilityCopy,
    ...translatedScalars,
    superSectionLabels: {
      conversation: translateAgentCenter(i18n, 'AgentCenter.model.superSectionConversation', compatibilityCopy.superSectionLabels.conversation),
      voice: translateAgentCenter(i18n, 'AgentCenter.model.superSectionVoice', compatibilityCopy.superSectionLabels.voice),
      media: translateAgentCenter(i18n, 'AgentCenter.model.superSectionMedia', compatibilityCopy.superSectionLabels.media),
    },
  };
}

function createTranslator(copy: ResolvedAgentCenterModelCopy, i18n?: AgentCenterI18n) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const fallback = copy.modelConfig[key as AgentCenterModelConfigCopyKey]
      || (typeof vars?.defaultValue === 'string' ? String(vars.defaultValue) : key);
    return translateAgentCenter(i18n, key, fallback, vars);
  };
}

function superSectionsForCopy(copy: ResolvedAgentCenterModelCopy): readonly ModelConfigSuperSection[] {
  return MODEL_SUPER_SECTIONS.map((section) => ({
    ...section,
    label: copy.superSectionLabels[section.id],
  }));
}

function buildRequirementDeclaration(
  projection: AgentCenterRuntimeModelSettingsProjection,
  capabilities: readonly AgentCenterCapabilityState[],
): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: 'runtime-agent-model-settings:agent-center',
    scopeRef: projection.scopeRef,
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `runtime-agent:${capability.capability}`,
      capability: capability.capability,
      profileSliceRef: `runtime-agent:${capability.capability}`,
      readinessPolicy: capability.required ? 'required' : 'optional',
    })),
    setupProjectionPolicy: 'runtime-agent-model-settings',
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
  if (capability.readinessState === 'not_configured' || capability.readinessState === 'blocked') {
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
    title: copy.projectionUnavailableTitle,
    detail: capability.summary,
  };
}

function createModelSettingsService(
  session: AgentCenterSession,
  initial: AgentCenterRuntimeModelSettingsProjection,
): ModelConfigSettingsService & { sync(projection: AgentCenterRuntimeModelSettingsProjection): void } {
  let current: ModelConfigSettingsProjection = initial;
  const listeners = new Set<(projection: ModelConfigSettingsProjection) => void>();
  const publish = (projection: ModelConfigSettingsProjection) => {
    current = projection;
    for (const listener of listeners) listener(projection);
  };
  return {
    sync: publish,
    get: () => current,
    async update(input) {
      await session.updateModelSettings({
        expectedConfigurationRevision: input.expectedConfigurationRevision,
        routeIntents: input.routeIntents,
      });
      const committed = session.getSnapshot().state.modelSettings;
      if (!committed) throw new Error('Committed model-settings projection is unavailable.');
      publish(committed);
      return committed;
    },
    subscribe(_scopeRef, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function AgentCenterModelSection({ session, snapshot, i18n }: AgentCenterModelSectionProps) {
  const [status] = useState('');
  const modelState = snapshot.state;
  const projection = modelState.modelSettings;
  const labels = useMemo(() => resolveModelCopy(undefined, i18n), [i18n]);
  const t = useMemo(() => createTranslator(labels, i18n), [i18n, labels]);
  const superSections = useMemo(() => superSectionsForCopy(labels), [labels]);
  const service = useMemo(
    () => projection ? createModelSettingsService(session, projection) : null,
    [projection?.scopeRef, session],
  );
  useEffect(() => {
    if (projection) service?.sync(projection);
  }, [projection, service]);
  const capabilityById = useMemo(() => new Map(
    modelState.capabilities.map((capability) => [capability.capability, capability]),
  ), [modelState.capabilities]);
  const availability = snapshot.availability.updateModelSettings;
  const actionAvailable = availability.state === 'available';
  const modelMutationDisabled = !actionAvailable
    || modelState.agentAIConfigMutationDisabledReason !== null
    || modelState.configRevision === null
    || !projection
    || !service;

  const surface = useMemo<AppModelConfigSurface | null>(() => {
    if (!projection || !service) return null;
    return {
      scopeRef: projection.scopeRef,
      modelSettingsService: service,
      requirementDeclaration: buildRequirementDeclaration(projection, modelState.capabilities),
      providerResolver: (routeCapability) => session.modelConfig?.providerResolver?.(routeCapability) ?? null,
      projectionResolver: (capabilityId) => {
        const capability = capabilityById.get(capabilityId);
        return capability ? projectionForCapability(capability, labels) : null;
      },
      localAssetSource: session.modelConfig?.localAssetSource || undefined,
      capabilityOverrides: Object.fromEntries(modelState.capabilities.map((capabilityState) => [
        capabilityState.capability,
        {
          disabled: modelMutationDisabled,
          hideEditor: true,
          showClearButton: !capabilityState.required,
          placeholder: modelState.agentAIConfigMutationDisabledReason
            ? labels.revisionUnavailable
            : session.modelConfig?.providerResolver
              ? labels.setupRequiredLabel
              : labels.runtimeModelPickerUnavailableLabel,
        },
      ])),
      runtimeNotReadyLabel: modelState.agentAIConfigMutationDisabledReason
        ? labels.revisionUnavailable
        : session.modelConfig?.providerResolver
          ? labels.setupRequiredLabel
          : labels.runtimeModelPickerUnavailableLabel,
      i18n: { t },
    };
  }, [capabilityById, labels, modelMutationDisabled, modelState.agentAIConfigMutationDisabledReason, modelState.capabilities, projection, service, session.modelConfig, t]);

  if (!actionAvailable || !surface) {
    return (
      <SectionShell labelledBy="agent-center-model-title">
        <SectionHeader id="agent-center-model-title" title={labels.sectionTitle} />
        {availability.state === 'unavailable' ? (
          <AgentCenterProductActionNotice
            action="updateModelSettings"
            availability={availability}
            i18n={i18n}
            session={session}
          />
        ) : <Notice>{labels.revisionUnavailable}</Notice>}
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-model-title">
      <SectionHeader id="agent-center-model-title" title={labels.sectionTitle} />
      <div data-agent-center-model-apply="runtime-agent-model-settings" data-agent-center-model-surface="runtime-model-config-hub">
        {modelState.capabilities.map((capability) => (
          <span data-agent-center-model-binding={capability.capability} hidden key={capability.capability}>
            {capability.binding?.model || labels.notConfiguredLabel}
          </span>
        ))}
        <ModelConfigAiModelHub
          detailActiveModelHint={labels.detailActiveModelHint}
          superSections={superSections}
          surface={surface}
        />
      </div>
      {modelMutationDisabled ? <Notice>{labels.revisionUnavailable}</Notice> : null}
      {status ? <Notice ariaLive="polite">{status}</Notice> : null}
    </SectionShell>
  );
}
