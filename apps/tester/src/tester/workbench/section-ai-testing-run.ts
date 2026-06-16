import { useEffect, useMemo, useState } from 'react';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type { TesterCapability } from '../tester-capabilities.js';
import type { TesterRunConfigSnapshot, TesterRunHistoryRecord } from '../tester-history.js';
import { createTesterAIConfigService, createTesterAppLabAIScopeRef } from '../tester-ai-config-store.js';
import { createTesterRunTargetSummary, type TesterRunTargetLocalModel, type TesterRunTargetSummary } from '../tester-run-target.js';
import type { TesterCapabilityRunResult, TesterRuntimeInspection } from '../tester-runtime.js';

export type TextStudioActiveRun = {
  id: string;
  prompt: string;
  context: string;
  createdAt: string;
  result: TesterCapabilityRunResult | null;
  record: TesterRunHistoryRecord | null;
  error: string | null;
};

export function textStudioRuntimePrompt(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `Context:\n${trimmedContext}\n\nRequest:\n${prompt}`;
}

function compactStudioModelLabel(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

export function textStudioModelSummary(result: TesterCapabilityRunResult | null, runTarget: TesterRunTargetSummary): string {
  const resolved = result?.ok ? result.trace?.modelResolved?.trim() : '';
  return `Model: ${resolved ? compactStudioModelLabel(resolved) : runTarget.modelLabel}`;
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

export function createRunConfigSnapshot(input: {
  target: TesterRunTargetSummary;
  tone: string;
  toneSelected: boolean;
  length: string;
  lengthSelected: boolean;
  context: string;
  attachmentCount: number;
}): TesterRunConfigSnapshot {
  const { target } = input;
  return {
    target: {
      capabilityId: target.capabilityId,
      bindingCapabilityId: target.bindingCapabilityId,
      section: target.section,
      status: target.status,
      source: target.source,
      modelLabel: target.modelLabel,
      detail: target.detail,
      params: { ...target.params },
      paramsSummary: [...target.paramsSummary],
      profileOrigin: target.profileOrigin,
    },
    promptControls: {
      tone: input.tone,
      toneSelected: input.toneSelected,
      length: input.length,
      lengthSelected: input.lengthSelected,
      contextAttached: Boolean(input.context.trim()),
      context: input.context.trim(),
      attachmentCount: input.attachmentCount,
    },
  };
}
