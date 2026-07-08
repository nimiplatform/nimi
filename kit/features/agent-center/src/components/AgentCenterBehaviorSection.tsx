import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import type { AgentCenterBehaviorCopy, AgentCenterRuntimeAdapter, AgentCenterState } from '../types.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionShell,
  agentCenterInputClassName,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

type AgentCenterAutonomyMode = 'off' | 'low' | 'medium' | 'high';

export interface AgentCenterBehaviorSectionProps {
  readonly state: AgentCenterState;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
  readonly copy?: AgentCenterBehaviorCopy;
}

const DEFAULT_BEHAVIOR_COPY: Required<AgentCenterBehaviorCopy> = {
  eyebrow: 'Proactive companion',
  title: 'Let the agent appear at the right time',
  description: 'When enabled, the agent can check in during daily rhythm, long silence, or important changes.',
  enableTitle: 'Allow proactive companion',
  enableDescription: 'When off, the agent only responds after you start a conversation.',
  enabledStatus: 'Enabled',
  disabledStatus: 'Off',
  modeTitle: 'Proactive level',
  quietTitle: 'Quiet',
  quietDescription: 'Only replies when you speak',
  occasionalTitle: 'Occasional',
  occasionalDescription: 'Reminds after long silence',
  dailyTitle: 'Daily',
  dailyDescription: 'Natural greetings and company',
  activeTitle: 'Active',
  activeDescription: 'Joins interaction more often',
  budgetTitle: 'Usage protection',
  budgetDescription: 'Set a token limit for proactive behavior to avoid unexpected background usage.',
  todayUsedLabel: 'Used today',
  dailyLimitLabel: 'Daily limit',
  singleLimitLabel: 'Per hook limit',
  reachedLimitLabel: 'After limit',
  reachedLimitAction: 'Pause proactive behavior',
  adjustLimitLabel: 'Adjust usage limit',
  applyLimitLabel: 'Save usage limit',
  tokensUnit: 'tokens',
  approxPrefix: 'about',
  savingLabel: 'Saving autonomy config.',
  savedLabel: 'Saved autonomy config.',
  unavailableLabel: 'Runtime autonomy mutation unavailable.',
};

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Runtime autonomy update failed.';
}

function resolveCopy(copy: AgentCenterBehaviorCopy | undefined): Required<AgentCenterBehaviorCopy> {
  return {
    ...DEFAULT_BEHAVIOR_COPY,
    ...(copy || {}),
  };
}

function normalizeNonNegative(value: string | number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function budgetPercent(used: number, dailyLimit: number): number {
  if (dailyLimit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((used / dailyLimit) * 100)));
}

function ModeSignalMark({
  mode,
  selected,
}: {
  readonly mode: AgentCenterAutonomyMode;
  readonly selected: boolean;
}) {
  const activeBars = mode === 'high' ? 4 : mode === 'medium' ? 3 : mode === 'low' ? 2 : 1;
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-6 shrink-0 items-end justify-center gap-1"
      data-agent-center-behavior-mode-signal={mode}
    >
      {[1, 2, 3, 4].map((bar) => (
        <span
          className={cnAgentCenter(
            'w-1 rounded-full',
            bar === 1 && 'h-[6px]',
            bar === 2 && 'h-[10px]',
            bar === 3 && 'h-[14px]',
            bar === 4 && 'h-[18px]',
            bar <= activeBars
              ? selected ? 'bg-emerald-500' : 'bg-slate-500'
              : selected ? 'bg-emerald-200' : 'bg-slate-200',
          )}
          key={bar}
        />
      ))}
    </span>
  );
}

export function AgentCenterBehaviorSection({ state, runtimeAdapter, copy }: AgentCenterBehaviorSectionProps) {
  const labels = resolveCopy(copy);
  const autonomy = state.autonomy;
  const mutationAvailable = !autonomy.controlsDisabled && typeof runtimeAdapter?.setAutonomyConfig === 'function';
  const [enabled, setEnabled] = useState(autonomy.enabled === true);
  const [mode, setMode] = useState<AgentCenterAutonomyMode>(
    (autonomy.mode || 'off') as AgentCenterAutonomyMode,
  );
  const [dailyTokenBudget, setDailyTokenBudget] = useState(String(autonomy.dailyTokenBudget ?? 0));
  const [maxTokensPerHook, setMaxTokensPerHook] = useState(String(autonomy.maxTokensPerHook ?? 0));
  const [mutationStatus, setMutationStatus] = useState('');
  const [budgetEditing, setBudgetEditing] = useState(false);

  useEffect(() => {
    setEnabled(autonomy.enabled === true);
    setMode((autonomy.mode || 'off') as AgentCenterAutonomyMode);
    setDailyTokenBudget(String(autonomy.dailyTokenBudget ?? 0));
    setMaxTokensPerHook(String(autonomy.maxTokensPerHook ?? 0));
  }, [autonomy.dailyTokenBudget, autonomy.enabled, autonomy.maxTokensPerHook, autonomy.mode]);

  const usedTokens = normalizeNonNegative(autonomy.usedTokensInWindow);
  const dailyLimit = normalizeNonNegative(dailyTokenBudget);
  const singleLimit = normalizeNonNegative(maxTokensPerHook);
  const percent = budgetPercent(usedTokens, dailyLimit);
  const modeOptions: readonly {
    readonly id: AgentCenterAutonomyMode;
    readonly title: string;
    readonly description: string;
  }[] = [
    { id: 'off', title: labels.quietTitle, description: labels.quietDescription },
    { id: 'low', title: labels.occasionalTitle, description: labels.occasionalDescription },
    { id: 'medium', title: labels.dailyTitle, description: labels.dailyDescription },
    { id: 'high', title: labels.activeTitle, description: labels.activeDescription },
  ];

  const commit = async (patch: Partial<{
    readonly enabled: boolean;
    readonly mode: AgentCenterAutonomyMode;
    readonly dailyTokenBudget: number;
    readonly maxTokensPerHook: number;
  }>) => {
    if (!runtimeAdapter?.setAutonomyConfig || !mutationAvailable) {
      setMutationStatus(autonomy.disabledReason || labels.unavailableLabel);
      return;
    }

    const previous = {
      enabled,
      mode,
      dailyTokenBudget,
      maxTokensPerHook,
    };
    const nextEnabled = patch.enabled ?? enabled;
    const nextMode = patch.mode ?? mode;
    const nextDailyBudget = patch.dailyTokenBudget ?? dailyLimit;
    const nextPerHookBudget = patch.maxTokensPerHook ?? singleLimit;

    setEnabled(nextEnabled);
    setMode(nextMode);
    setDailyTokenBudget(String(nextDailyBudget));
    setMaxTokensPerHook(String(nextPerHookBudget));
    setMutationStatus(labels.savingLabel);

    try {
      const snapshot = await runtimeAdapter.setAutonomyConfig({
        enabled: nextEnabled,
        mode: nextMode,
        dailyTokenBudget: nextDailyBudget,
        maxTokensPerHook: nextPerHookBudget,
      });
      setEnabled(snapshot.enabled ?? nextEnabled);
      setMode((snapshot.mode || nextMode) as AgentCenterAutonomyMode);
      setDailyTokenBudget(String(snapshot.dailyTokenBudget ?? nextDailyBudget));
      setMaxTokensPerHook(String(snapshot.maxTokensPerHook ?? nextPerHookBudget));
      setMutationStatus(labels.savedLabel);
    } catch (error: unknown) {
      setEnabled(previous.enabled);
      setMode(previous.mode);
      setDailyTokenBudget(previous.dailyTokenBudget);
      setMaxTokensPerHook(previous.maxTokensPerHook);
      setMutationStatus(normalizeError(error));
    }
  };

  return (
    <SectionShell
      labelledBy="agent-center-behavior-title"
      className="gap-3.5"
    >
      <div
        className="grid min-w-0 gap-2"
        data-agent-center-behavior-page="proactive-companion"
      >
        <p className="m-0 text-[12px] font-semibold leading-none text-emerald-700">{labels.eyebrow}</p>
        <div className="grid min-w-0 gap-1">
          <h2 id="agent-center-behavior-title" className="m-0 text-[21px] font-semibold leading-[1.24] tracking-normal text-slate-950">
            {labels.title}
          </h2>
          <p className="m-0 text-[13.5px] leading-[1.5] text-slate-500">{labels.description}</p>
        </div>
      </div>

      <Card className="rounded-[14px] border-slate-200/80 bg-white/95 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 items-center justify-between gap-4 px-4 py-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-[15px] font-semibold leading-[1.35] text-slate-950">{labels.enableTitle}</span>
            <span className="text-[12.5px] leading-[1.45] text-slate-500">{labels.enableDescription}</span>
          </div>
          <div className="grid shrink-0 justify-items-end gap-2">
            <label
              className={cnAgentCenter(
                'relative inline-flex h-[30px] w-[58px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
                enabled ? 'bg-emerald-600' : 'bg-slate-300',
                !mutationAvailable && 'opacity-55',
              )}
            >
              <input
                aria-label="Autonomy enabled"
                checked={enabled}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                data-agent-center-proactive-toggle="true"
                disabled={!mutationAvailable}
                onChange={(event) => {
                  void commit({ enabled: event.currentTarget.checked });
                }}
                role="switch"
                type="checkbox"
              />
              <span
                aria-hidden="true"
                className={cnAgentCenter(
                  'h-[24px] w-[24px] rounded-full bg-white shadow-[0_3px_8px_rgba(15,23,42,0.22)] transition-transform',
                  enabled ? 'translate-x-[28px]' : 'translate-x-[2px]',
                )}
              />
            </label>
            <span className={cnAgentCenter(
              'rounded-full px-2 py-1 text-[11.5px] font-semibold leading-none',
              enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-slate-500/10 text-slate-600',
            )}>
              {enabled ? labels.enabledStatus : labels.disabledStatus}
            </span>
          </div>
        </div>
      </Card>

      <Card className="rounded-[14px] border-slate-200/80 bg-white/95 p-3.5 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
        <h3 className="m-0 mb-2.5 text-[15px] font-semibold leading-[1.35] text-slate-950">{labels.modeTitle}</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {modeOptions.map((option) => {
            const selected = mode === option.id;
            return (
              <button
                aria-pressed={selected}
                className={cnAgentCenter(
                  'relative flex min-h-[72px] min-w-0 items-center gap-3 rounded-[12px] border p-3 text-left transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-55',
                  selected
                    ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]'
                    : 'border-slate-200/90 bg-white text-slate-900 hover:border-emerald-200 hover:bg-emerald-50/30',
                )}
                data-agent-center-behavior-mode={option.id}
                disabled={!mutationAvailable}
                key={option.id}
                onClick={() => {
                  void commit({ mode: option.id });
                }}
                type="button"
              >
                <ModeSignalMark mode={option.id} selected={selected} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-[14px] font-semibold leading-[1.25]">{option.title}</span>
                  <span className={cnAgentCenter('text-[12.5px] leading-[1.35]', selected ? 'text-emerald-700/80' : 'text-slate-500')}>
                    {option.description}
                  </span>
                </span>
                {selected ? (
                  <span className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-emerald-500 text-white">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-[14px] border-slate-200/80 bg-white/95 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
        <div className="px-4 pb-3 pt-4">
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <h3 className="m-0 min-w-0 text-[15px] font-semibold leading-[1.35] text-slate-950">{labels.budgetTitle}</h3>
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </div>
          <p className="m-0 text-[12.5px] leading-[1.45] text-slate-500">{labels.budgetDescription}</p>
        </div>
        <div className="mx-4 mb-0 overflow-hidden rounded-[12px] border border-slate-200/90">
          <div className="px-4 py-3.5">
            <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-slate-500">{labels.todayUsedLabel}</div>
                <div className="mt-0.5 text-[18px] font-semibold leading-none text-slate-950 tabular-nums">
                  {usedTokens}
                  <span className="text-[14px] text-slate-400"> / {dailyLimit} {labels.tokensUnit}</span>
                </div>
              </div>
              <div className="shrink-0 text-[13px] font-medium text-slate-500">
                {labels.approxPrefix} {percent}%
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/75">
              <div
                className="h-full rounded-full bg-emerald-500"
                data-agent-center-budget-progress="true"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <div className="grid border-t border-slate-200/90 sm:grid-cols-2">
            <div className="border-b border-slate-200/90 px-4 py-3 sm:border-b-0 sm:border-r">
              <div className="text-[12px] font-semibold text-slate-500">{labels.dailyLimitLabel}</div>
              <div className="mt-0.5 text-[13px] font-semibold text-slate-600 tabular-nums">{dailyLimit} {labels.tokensUnit}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[12px] font-semibold text-slate-500">{labels.singleLimitLabel}</div>
              <div className="mt-0.5 text-[13px] font-semibold text-slate-600 tabular-nums">{singleLimit} {labels.tokensUnit}</div>
            </div>
          </div>
          <button
            aria-expanded={budgetEditing}
            className="flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3 text-left text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
            data-agent-center-budget-policy="true"
            disabled={!mutationAvailable}
            onClick={() => setBudgetEditing((value) => !value)}
            type="button"
          >
            <span className="min-w-0 truncate">{labels.reachedLimitLabel}</span>
            <span className="inline-flex shrink-0 items-center gap-2 text-slate-700">
              {labels.reachedLimitAction}
              <ChevronDown aria-hidden="true" className={cnAgentCenter('h-4 w-4 text-slate-400 transition-transform', budgetEditing && 'rotate-180')} />
            </span>
          </button>
          <button
            aria-expanded={budgetEditing}
            className="flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3 text-left text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50/40 disabled:cursor-not-allowed disabled:opacity-55"
            data-agent-center-budget-adjust="true"
            disabled={!mutationAvailable}
            onClick={() => setBudgetEditing((value) => !value)}
            type="button"
          >
            <span className="min-w-0 truncate">{labels.adjustLimitLabel}</span>
            <ChevronRight aria-hidden="true" className={cnAgentCenter('h-4 w-4 shrink-0 text-slate-400 transition-transform', budgetEditing && 'rotate-90')} />
          </button>
          {budgetEditing ? (
            <div className="grid min-w-0 gap-2.5 border-t border-slate-200/90 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="grid min-w-0 gap-1.5 text-[12px] font-medium text-slate-600">
                <span>{labels.dailyLimitLabel}</span>
                <input
                  aria-label={labels.dailyLimitLabel}
                  className={agentCenterInputClassName}
                  disabled={!mutationAvailable}
                  min={0}
                  onInput={(event) => setDailyTokenBudget(event.currentTarget.value)}
                  type="number"
                  value={dailyTokenBudget}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-[12px] font-medium text-slate-600">
                <span>{labels.singleLimitLabel}</span>
                <input
                  aria-label={labels.singleLimitLabel}
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
                onClick={() => {
                  void commit({
                    dailyTokenBudget: normalizeNonNegative(dailyTokenBudget),
                    maxTokensPerHook: normalizeNonNegative(maxTokensPerHook),
                  });
                }}
                variant="accent"
              >
                {labels.applyLimitLabel}
              </AgentButton>
            </div>
          ) : null}
        </div>
        <div className="h-4" />
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
