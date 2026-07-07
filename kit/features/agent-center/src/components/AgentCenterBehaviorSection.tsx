import { useState } from 'react';
import type { AgentCenterRuntimeAdapter, AgentCenterState } from '../types.js';
import {
  AgentButton,
  Card,
  ModePicker,
  Notice,
  SectionHeader,
  SectionShell,
  StatusPill,
  agentCenterInputClassName,
} from './AgentCenterPrimitives.js';

type AgentCenterAutonomyMode = 'off' | 'low' | 'medium' | 'high';

export interface AgentCenterBehaviorSectionProps {
  readonly state: AgentCenterState;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
}

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Runtime autonomy update failed.';
}

export function AgentCenterBehaviorSection({ state, runtimeAdapter }: AgentCenterBehaviorSectionProps) {
  const autonomy = state.autonomy;
  const mutationAvailable = !autonomy.controlsDisabled && typeof runtimeAdapter?.setAutonomyConfig === 'function';
  const [enabled, setEnabled] = useState(autonomy.enabled === true);
  const [mode, setMode] = useState<AgentCenterAutonomyMode>(
    (autonomy.mode || 'off') as AgentCenterAutonomyMode,
  );
  const [dailyTokenBudget, setDailyTokenBudget] = useState(String(autonomy.dailyTokenBudget ?? 0));
  const [maxTokensPerHook, setMaxTokensPerHook] = useState(String(autonomy.maxTokensPerHook ?? 0));
  const [mutationStatus, setMutationStatus] = useState('');

  const commit = () => {
    if (!runtimeAdapter?.setAutonomyConfig || !mutationAvailable) {
      setMutationStatus(autonomy.disabledReason || 'Runtime autonomy mutation unavailable.');
      return;
    }
    setMutationStatus('Saving Runtime autonomy config.');
    void runtimeAdapter.setAutonomyConfig({
      enabled,
      mode,
      dailyTokenBudget: Number(dailyTokenBudget),
      maxTokensPerHook: Number(maxTokensPerHook),
    }).then((snapshot) => {
      setMutationStatus(`Saved autonomy ${snapshot.mode || mode}.`);
    }).catch((error: unknown) => {
      setMutationStatus(normalizeError(error));
    });
  };

  return (
    <SectionShell labelledBy="agent-center-behavior-title">
      <SectionHeader
        description={`Autonomy ${autonomy.enabled === true ? 'enabled' : autonomy.enabled === false ? 'disabled' : 'unavailable'}`}
        id="agent-center-behavior-title"
        right={<StatusPill label={autonomy.mode || 'unknown'} tone={autonomy.enabled ? 'ready' : 'muted'} />}
        title="Behavior"
      />
      <Card>
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-200/90 px-4 py-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-[13px] font-semibold text-slate-950">Autonomy mode</span>
            <span className="text-[12.5px] leading-[1.45] text-slate-600">
              Runtime-owned proactive lifecycle entry point.
            </span>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 text-[12.5px] font-semibold text-slate-700">
            <input
              aria-label="Autonomy enabled"
              checked={enabled}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              disabled={!mutationAvailable}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
            {enabled ? 'Enabled' : 'Off'}
          </label>
        </div>
        <ModePicker
          disabled={!mutationAvailable}
          onChange={(value) => setMode(value as AgentCenterAutonomyMode)}
          value={mode}
        />
        <div className="grid min-w-0 gap-2.5 border-t border-slate-200/90 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="grid min-w-0 gap-1.5 text-[12px] font-medium text-slate-600">
            <span>Daily budget</span>
            <input
              aria-label="Autonomy daily token budget"
              className={agentCenterInputClassName}
              disabled={!mutationAvailable}
              min={0}
              onInput={(event) => setDailyTokenBudget(event.currentTarget.value)}
              type="number"
              value={dailyTokenBudget}
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-[12px] font-medium text-slate-600">
            <span>Per hook</span>
            <input
              aria-label="Autonomy max tokens per hook"
              className={agentCenterInputClassName}
              disabled={!mutationAvailable}
              min={0}
              onInput={(event) => setMaxTokensPerHook(event.currentTarget.value)}
              type="number"
              value={maxTokensPerHook}
            />
          </label>
          <AgentButton
            className="self-end"
            dataAttrs={{ 'data-agent-center-autonomy-apply': 'true' }}
            disabled={!mutationAvailable}
            onClick={commit}
            variant="primary"
          >
            Apply
          </AgentButton>
        </div>
        <div className="border-t border-slate-200/90 px-4 py-3 text-[12.5px] text-slate-600">
          Budget: {autonomy.budgetExhausted ? 'exhausted' : 'available'}
        </div>
      </Card>
      {autonomy.controlsDisabled ? (
        <Notice tone="warn">{autonomy.disabledReason}</Notice>
      ) : null}
      {mutationStatus ? (
        <Notice>{mutationStatus}</Notice>
      ) : null}
    </SectionShell>
  );
}
