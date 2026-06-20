import { useEffect, useMemo, useState } from 'react';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type { TesterCapability } from '../tester-capabilities.js';
import { getTesterRunModelLabel, type TesterRunConfigSnapshot, type TesterRunHistoryRecord } from '../tester-history.js';
import { createTesterAIConfigService, createTesterAppLabAIScopeRef } from '../tester-ai-config-store.js';
import { createTesterRunTargetSummary, type TesterRunTargetLocalModel, type TesterRunTargetSummary } from '../tester-run-target.js';
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

function compactStudioModelLabel(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

function isOpaqueRuntimeModelId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{20,32}$/u.test(value.trim());
}

export function textStudioModelSummary(
  result: TesterCapabilityRunResult | null,
  runTarget: TesterRunTargetSummary,
  record: TesterRunHistoryRecord | null,
): string {
  if (record) return `Model: ${getTesterRunModelLabel(record)}`;
  const resolved = result?.ok ? result.trace?.modelResolved?.trim() : '';
  return `Model: ${resolved && !isOpaqueRuntimeModelId(resolved) ? compactStudioModelLabel(resolved) : runTarget.modelLabel}`;
}

export function textStudioRunTargetModelSummary(runTarget: TesterRunTargetSummary): string {
  return `Model: ${runTarget.modelLabel}`;
}

export function canConfigureRunTarget(runTarget: TesterRunTargetSummary): boolean {
  return (
    !runTarget.canDispatch
    && runTarget.status === 'blocked'
    && Boolean(runTarget.bindingCapabilityId)
    && (runTarget.modelLabel === 'Target required' || runTarget.source === 'profile-slice')
  );
}

function targetRefHydrationKey(bindingCapabilityId: string | null, config: NimiAIConfig | null): string {
  if (!bindingCapabilityId || !config) return '';
  const targetRef = config.capabilities.targetRefs[bindingCapabilityId] || null;
  if (!targetRef) return '';
  return JSON.stringify(targetRef);
}

export function useTesterRunTargetSummary(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
): TesterRunTargetSummary {
  const scopeRef = useMemo(() => createTesterAppLabAIScopeRef(), []);
  const service = useMemo(() => createTesterAIConfigService(), []);
  const [config, setConfig] = useState(() => {
    try {
      return service.aiConfig.get(scopeRef);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      setConfig(service.aiConfig.get(scopeRef));
      return service.aiConfig.subscribe(scopeRef, setConfig);
    } catch {
      setConfig(null);
      return undefined;
    }
  }, [scopeRef, service]);

  const [localModels, setLocalModels] = useState<TesterRunTargetLocalModel[]>([]);
  const target = useMemo(
    () => createTesterRunTargetSummary({ capability, runtime, config, localModels }),
    [capability, config, localModels, runtime],
  );
  const hydrationKey = useMemo(
    () => targetRefHydrationKey(target.bindingCapabilityId, config),
    [config, target.bindingCapabilityId],
  );

  useEffect(() => {
    let cancelled = false;
    setLocalModels([]);
    if (runtime?.status !== 'ready' || target.source !== 'local' || !target.bindingCapabilityId) {
      return () => {
        cancelled = true;
      };
    }
    const bindingCapabilityId = target.bindingCapabilityId;
    void import('../tester-runtime-model-provider.js')
      .then((module) => module.createTesterRuntimeModelPickerProvider(bindingCapabilityId).listLocalModels())
      .then((models) => {
        if (!cancelled) {
          setLocalModels([...models]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalModels([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hydrationKey, runtime?.status, target.bindingCapabilityId, target.source]);

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
      bindingCapabilityId: target.bindingCapabilityId,
      section: target.section,
      status: target.status,
      source: target.source,
      modelLabel: target.modelLabel,
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
