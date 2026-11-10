import { useEffect, useMemo, useState } from 'react';
import { runtimeAIConfigStructToJson, type NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';

import { findStudioCapabilityIntent } from './ai-config.js';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration, CapabilityStudioProfile } from './module-registration.js';
import type { StudioCapabilityRunResult, StudioManagedArtifact, StudioRuntimeInspection } from './runtime-types.js';
import {
  getStudioRunIntentLabel,
  type StudioRunConfigSnapshot,
  type StudioRunHistoryRecord,
  type StudioRunTargetSummary,
} from './history.js';
import {
  composeStudioDirective,
  DEFAULT_LENGTH_VALUE,
  DEFAULT_TONE_VALUE,
  LENGTH_OPTIONS,
  TONE_OPTIONS,
} from './studio-directives.js';
import type { StudioTranslate } from './non-success-presentation.js';
import type { StudioParameterValue } from './parameters.js';

export type TextStudioActiveRun = {
  attachmentCount?: number;
  replayMedia?: StudioManagedArtifact;
  // Latest submission's session-only input; history never stores these bytes.
  submittedParameters?: StudioParameterValue;
  jobStatus?: 'queued' | 'running';
  id: string;
  prompt: string;
  context: string;
  createdAt: string;
  configuredTarget?: Pick<StudioRunTargetSummary, 'source' | 'targetLabel'>;
  result: StudioCapabilityRunResult | null;
  record: StudioRunHistoryRecord | null;
  error: string | null;
};

export function textStudioRuntimePrompt(prompt: string, context: string, directive?: string): string {
  const trimmedContext = context.trim();
  return [
    directive?.trim() ? `Instructions:\n${directive.trim()}` : '',
    trimmedContext ? `Context:\n${trimmedContext}` : '',
    `Request:\n${prompt}`,
  ].filter(Boolean).join('\n\n');
}

export function textStudioIntentSummary(
  _result: StudioCapabilityRunResult | null,
  runTarget: StudioRunTargetSummary,
  record: StudioRunHistoryRecord | null,
  translate: StudioTranslate,
): string {
  const intent = record ? getStudioRunIntentLabel(record) : runTarget.intentLabel;
  return translate('Studio.composer.intentSummary', { intent });
}

export function textStudioRunTargetIntentSummary(
  runTarget: StudioRunTargetSummary,
  translate: StudioTranslate,
): string {
  return translate('Studio.composer.intentSummary', { intent: studioConfiguredTargetLabel(runTarget, translate) });
}

export function studioConfiguredTargetLabel(
  target: Pick<StudioRunTargetSummary, 'source' | 'targetLabel'> | undefined,
  translate: StudioTranslate,
): string {
  const route = target?.source === 'local' ? translate('Studio.composer.routeLocal')
    : target?.source === 'cloud' ? translate('Studio.composer.routeCloud')
      : translate('Studio.composer.routeUnknown');
  return target?.targetLabel ? `${route} · ${target.targetLabel}` : route;
}

export function canConfigureRunTarget(runTarget: StudioRunTargetSummary): boolean {
  return !runTarget.canDispatch && runTarget.status === 'blocked' && Boolean(runTarget.capabilityContract);
}

export function useStudioRunTargetSummary(
  registration: StudioCapabilityRegistration,
  runtime: StudioRuntimeInspection | null,
): StudioRunTargetSummary & { readonly snapshot: NimiAIConfigSnapshot | null; readonly configReadFailed: boolean } {
  const host = useAIStudioHost();
  const [configProjection, setConfigProjection] = useState<{
    state: 'loading' | 'loaded' | 'failed';
    snapshot: NimiAIConfigSnapshot | null;
    error: string | null;
  }>({ state: 'loading', snapshot: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let requestGeneration = 0;
    const refresh = () => {
      const generation = ++requestGeneration;
      setConfigProjection({ state: 'loading', snapshot: null, error: null });
      void host.sdk.aiConfig.getSnapshot()
        .then((next) => {
          if (!cancelled && generation === requestGeneration) {
            setConfigProjection({ state: 'loaded', snapshot: next, error: null });
          }
        })
        .catch((cause) => {
          if (!cancelled && generation === requestGeneration) {
            setConfigProjection({
              state: 'failed',
              snapshot: null,
              error: cause instanceof Error ? cause.message : String(cause || host.translate('Studio.run.aiConfigLoadFailed')),
            });
          }
        });
    };
    refresh();
    const unsubscribe = host.app.events.subscribeAIConfigRefresh(refresh);
    return () => {
      cancelled = true;
      requestGeneration += 1;
      unsubscribe();
    };
  }, [host]);

  return useMemo(() => {
    const { snapshot } = configProjection;
    const config = snapshot?.config ?? null;
    const target = host.app.projection.projectRunTarget({
      capability: registration.descriptor,
      runtime,
      config,
      configState: configProjection.state,
      configError: configProjection.error,
    });
    const readState = { snapshot, configReadFailed: configProjection.state === 'failed' };
    if (!target.capabilityContract || !target.canDispatch) return { ...target, ...readState };
    const selection = snapshot?.effectiveSelections.find((item) => item.capabilityContract === target.capabilityContract);
    const resource = selection?.resource;
    const intent = findStudioCapabilityIntent(config, target.capabilityContract);
    const configuredCloudModel = intent?.route.oneofKind === 'cloud'
      ? runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget).providerModelId
      : undefined;
    const label = resource?.oneofKind === 'local' ? resource.local.label
      : resource?.oneofKind === 'cloud' ? resource.cloud.target.label
        : configuredCloudModel;
    const targetLabel = typeof label === 'string' && label.trim() ? label : undefined;
    const targetRef = resource?.oneofKind === 'local' ? resource.local.loadoutRef
      : typeof configuredCloudModel === 'string' ? configuredCloudModel : undefined;
    const recordedConfig = {
      targetLabel,
      targetRef,
      configuredDefaults: intent ? runtimeAIConfigStructToJson(intent.defaults) : undefined,
    };
    if (selection && selection.state !== 'ready') {
      return { ...target, ...readState, ...recordedConfig, status: 'blocked', canDispatch: false,
        detail: host.translate('Studio.run.effectiveTargetUnavailable') };
    }
    return { ...target, ...readState, ...recordedConfig };
  }, [configProjection, host, registration.descriptor, runtime]);
}

export type TextStudioPromptStyle = { tone: string; length: string };

function selectedStudioParamValue(
  params: Readonly<Record<string, unknown>>,
  key: string,
  options: readonly { value: string }[],
  fallback: string,
): string {
  const raw = params[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return options.some((option) => option.value === value) ? value : fallback;
}

export function effectiveTextStudioPromptStyle(target: StudioRunTargetSummary): TextStudioPromptStyle {
  return {
    tone: selectedStudioParamValue(target.params, 'tone', TONE_OPTIONS, DEFAULT_TONE_VALUE),
    length: selectedStudioParamValue(target.params, 'length', LENGTH_OPTIONS, DEFAULT_LENGTH_VALUE),
  };
}

export function textStudioDirectiveForTarget(
  target: StudioRunTargetSummary,
  profile: CapabilityStudioProfile,
): string | undefined {
  if (!profile.controls.includes('tone') && !profile.controls.includes('length')) return undefined;
  const style = effectiveTextStudioPromptStyle(target);
  return composeStudioDirective(style.tone, style.length);
}

export function createRunConfigSnapshot(input: {
  target: StudioRunTargetSummary;
  promptStyle?: TextStudioPromptStyle | null;
  context: string;
  attachmentCount: number;
  requestParameters?: Readonly<Record<string, unknown>>;
}): StudioRunConfigSnapshot {
  const { target } = input;
  const params = {
    ...target.params,
    ...(input.requestParameters ?? {}),
    ...(input.promptStyle ? { tone: input.promptStyle.tone, length: input.promptStyle.length } : {}),
  };
  return {
    target: {
      capabilityId: target.capabilityId,
      capabilityContract: target.capabilityContract,
      section: target.section,
      status: target.status,
      source: target.source,
      intentLabel: target.intentLabel,
      ...(target.targetLabel ? { targetLabel: target.targetLabel } : {}),
      ...(target.targetRef ? { targetRef: target.targetRef } : {}),
      ...(target.configuredDefaults ? { configuredDefaults: target.configuredDefaults } : {}),
      detail: target.detail,
      params,
      paramsSummary: [...target.paramsSummary],
      profileOrigin: target.profileOrigin,
    },
    promptControls: {
      contextAttached: Boolean(input.context.trim()),
      context: input.context.trim(),
      attachmentCount: input.attachmentCount,
    },
  };
}
