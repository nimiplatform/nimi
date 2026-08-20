import { useEffect, useMemo, useState } from 'react';
import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';
import { hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { t } from '../../shell/i18n/index.js';
import type { LabCapability } from '../lab-capabilities.js';
import { getLabRunIntentLabel, type LabRunConfigSnapshot, type LabRunHistoryRecord } from '../lab-history.js';
import { useLabRendererHost } from '../../renderer/context.js';
import {
  loadLabAIConfig,
  subscribeLabAIConfigOwnerRefresh,
} from '../lab-ai-config-store.js';
import { createLabRunTargetSummary, type LabRunTargetSummary } from '../lab-run-target.js';
import type { LabCapabilityRunResult, LabRuntimeInspection } from '../lab-runtime.js';
import { composeStudioDirective, DEFAULT_LENGTH_VALUE, DEFAULT_TONE_VALUE, getCapabilityStudioProfile, LENGTH_OPTIONS, TONE_OPTIONS } from './capability-studio-profiles.js';

export type TextStudioActiveRun = {
  id: string;
  prompt: string;
  context: string;
  createdAt: string;
  result: LabCapabilityRunResult | null;
  record: LabRunHistoryRecord | null;
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
  _result: LabCapabilityRunResult | null,
  runTarget: LabRunTargetSummary,
  record: LabRunHistoryRecord | null,
): string {
  if (record) return t('Studio.composer.intentSummary', { intent: getLabRunIntentLabel(record) });
  return t('Studio.composer.intentSummary', { intent: runTarget.intentLabel });
}

export function textStudioRunTargetIntentSummary(runTarget: LabRunTargetSummary): string {
  return t('Studio.composer.intentSummary', { intent: runTarget.intentLabel });
}

export function canConfigureRunTarget(runTarget: LabRunTargetSummary): boolean {
  return (
    !runTarget.canDispatch
    && runTarget.status === 'blocked'
    && Boolean(runTarget.capabilityContract)
  );
}

export function useLabRunTargetSummary(
  capability: LabCapability,
  runtime: LabRuntimeInspection | null,
): LabRunTargetSummary {
  const rendererHost = useLabRendererHost();
  const [configProjection, setConfigProjection] = useState<{
    state: 'loading' | 'loaded' | 'failed';
    config: NimiPortableAppAIConfig | null;
    error: string | null;
  }>({ state: 'loading', config: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let requestGeneration = 0;
    const refresh = () => {
      const generation = ++requestGeneration;
      setConfigProjection({ state: 'loading', config: null, error: null });
      void loadLabAIConfig(rendererHost.sdk.aiConfig)
        .then((next) => {
          if (!cancelled && generation === requestGeneration) {
            setConfigProjection({ state: 'loaded', config: next, error: null });
          }
        })
        .catch((cause) => {
          if (!cancelled && generation === requestGeneration) {
            setConfigProjection({
              state: 'failed',
              config: null,
              error: cause instanceof Error ? cause.message : String(cause || t('Studio.run.aiConfigLoadFailed')),
            });
          }
        });
    };
    refresh();
    const unsubscribe = subscribeLabAIConfigOwnerRefresh(refresh, window, document);
    return () => {
      cancelled = true;
      requestGeneration += 1;
      unsubscribe();
    };
  }, [rendererHost]);

  const standaloneTauriAvailable = hasTauriRuntime();
  const target = useMemo(
    () => createLabRunTargetSummary({
      capability,
      runtime,
      config: configProjection.config,
      configState: configProjection.state,
      configError: configProjection.error,
      standaloneTauriAvailable,
    }),
    [capability, configProjection, runtime, standaloneTauriAvailable],
  );

  return target;
}

export type TextStudioPromptStyle = {
  tone: string;
  length: string;
};

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

export function effectiveTextStudioPromptStyle(target: LabRunTargetSummary): TextStudioPromptStyle {
  return {
    tone: selectedStudioParamValue(target.params, 'tone', TONE_OPTIONS, DEFAULT_TONE_VALUE),
    length: selectedStudioParamValue(target.params, 'length', LENGTH_OPTIONS, DEFAULT_LENGTH_VALUE),
  };
}

export function textStudioDirectiveForTarget(
  target: LabRunTargetSummary,
  profile: ReturnType<typeof getCapabilityStudioProfile>,
): string | undefined {
  if (!profile.controls.includes('tone') && !profile.controls.includes('length')) return undefined;
  const style = effectiveTextStudioPromptStyle(target);
  return composeStudioDirective(style.tone, style.length);
}

export function createRunConfigSnapshot(input: {
  target: LabRunTargetSummary;
  promptStyle?: TextStudioPromptStyle | null;
  context: string;
  attachmentCount: number;
  requestParameters?: Readonly<Record<string, unknown>>;
}): LabRunConfigSnapshot {
  const { target } = input;
  const params = {
    ...target.params,
    ...(input.requestParameters ?? {}),
    ...(input.promptStyle ? {
      tone: input.promptStyle.tone,
      length: input.promptStyle.length,
    } : {}),
  };
  return {
    target: {
      capabilityId: target.capabilityId,
      capabilityContract: target.capabilityContract,
      section: target.section,
      status: target.status,
      source: target.source,
      intentLabel: target.intentLabel,
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
