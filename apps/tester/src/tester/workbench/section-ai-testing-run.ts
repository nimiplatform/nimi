import { useEffect, useMemo, useState } from 'react';
import type { NimiCapabilityAIConfig } from '@nimiplatform/sdk/ai';
import { hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { TesterCapability } from '../tester-capabilities.js';
import { getTesterRunIntentLabel, type TesterRunConfigSnapshot, type TesterRunHistoryRecord } from '../tester-history.js';
import { useTesterRendererHost } from '../../renderer/context.js';
import { createTesterRunTargetSummary, type TesterRunTargetSummary } from '../tester-run-target.js';
import type { TesterCapabilityRunResult, TesterRuntimeInspection } from '../tester-runtime.js';
import { composeStudioDirective, DEFAULT_LENGTH_VALUE, DEFAULT_TONE_VALUE, getCapabilityStudioProfile, LENGTH_OPTIONS, TONE_OPTIONS } from './capability-studio-profiles.js';

export type TextStudioActiveRun = {
  id: string;
  prompt: string;
  context: string;
  createdAt: string;
  result: TesterCapabilityRunResult | null;
  record: TesterRunHistoryRecord | null;
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
  _result: TesterCapabilityRunResult | null,
  runTarget: TesterRunTargetSummary,
  record: TesterRunHistoryRecord | null,
): string {
  if (record) return `Intent: ${getTesterRunIntentLabel(record)}`;
  return `Intent: ${runTarget.intentLabel}`;
}

export function textStudioRunTargetIntentSummary(runTarget: TesterRunTargetSummary): string {
  return `Intent: ${runTarget.intentLabel}`;
}

export function canConfigureRunTarget(runTarget: TesterRunTargetSummary): boolean {
  return (
    !runTarget.canDispatch
    && runTarget.status === 'blocked'
    && Boolean(runTarget.capabilityContract)
  );
}

export function useTesterRunTargetSummary(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
  refreshKey = 0,
): TesterRunTargetSummary {
  const rendererHost = useTesterRendererHost();
  const [configProjection, setConfigProjection] = useState<{
    state: 'loading' | 'loaded' | 'failed';
    config: NimiCapabilityAIConfig | null;
    error: string | null;
  }>({ state: 'loading', config: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setConfigProjection({ state: 'loading', config: null, error: null });
    void rendererHost.sdk.aiConfig.get()
      .then((next) => {
        if (!cancelled) setConfigProjection({ state: 'loaded', config: next, error: null });
      })
      .catch((cause) => {
        if (!cancelled) {
          setConfigProjection({
            state: 'failed',
            config: null,
            error: cause instanceof Error ? cause.message : String(cause || 'App AIConfig load failed.'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rendererHost, refreshKey]);

  const standaloneTauriAvailable = hasTauriRuntime();
  const target = useMemo(
    () => createTesterRunTargetSummary({
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

export function effectiveTextStudioPromptStyle(target: TesterRunTargetSummary): TextStudioPromptStyle {
  return {
    tone: selectedStudioParamValue(target.params, 'tone', TONE_OPTIONS, DEFAULT_TONE_VALUE),
    length: selectedStudioParamValue(target.params, 'length', LENGTH_OPTIONS, DEFAULT_LENGTH_VALUE),
  };
}

export function textStudioDirectiveForTarget(
  target: TesterRunTargetSummary,
  profile: ReturnType<typeof getCapabilityStudioProfile>,
): string | undefined {
  if (!profile.controls.includes('tone') && !profile.controls.includes('length')) return undefined;
  const style = effectiveTextStudioPromptStyle(target);
  return composeStudioDirective(style.tone, style.length);
}

export function createRunConfigSnapshot(input: {
  target: TesterRunTargetSummary;
  promptStyle?: TextStudioPromptStyle | null;
  context: string;
  attachmentCount: number;
}): TesterRunConfigSnapshot {
  const { target } = input;
  const params = {
    ...target.params,
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
