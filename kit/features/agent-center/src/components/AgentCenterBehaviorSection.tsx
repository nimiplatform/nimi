import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Check,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  Button,
  InlineAlert,
  ProgressIndicator,
  StatusBadge,
  Toggle,
  type FeedbackTone,
} from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterCatalogRecord } from '../locales/index.js';
import type {
  AgentCenterAutonomyProjection,
  AgentCenterBehaviorCopy,
  AgentCenterI18n,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import {
  Card,
  SectionHeader,
  SectionShell,
  agentCenterInputClassName,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

type AgentCenterAutonomyMode = 'off' | 'low' | 'medium' | 'high';

export interface AgentCenterBehaviorSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

const DEFAULT_BEHAVIOR_COPY = getAgentCenterCatalogRecord('AgentCenter.behavior.') as Required<AgentCenterBehaviorCopy>;

type MutationStatus = {
  readonly text: string;
  readonly tone: FeedbackTone;
};

function normalizeError(error: unknown, labels: Required<AgentCenterBehaviorCopy>): string {
  return error instanceof Error && error.message ? error.message : labels.unavailableLabel;
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
              ? selected ? 'bg-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-text-muted)]'
              : selected ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_25%,transparent)]' : 'bg-[var(--nimi-surface-active)]',
          )}
          key={bar}
        />
      ))}
    </span>
  );
}

export function AgentCenterBehaviorSection({ session, snapshot, i18n }: AgentCenterBehaviorSectionProps) {
  const state = snapshot.state;
  const compatibilityLabels = resolveCopy(undefined);
  const labels = Object.fromEntries(
    Object.entries(compatibilityLabels).map(([key, value]) => [
      key,
      translateAgentCenter(i18n, `AgentCenter.behavior.${key}`, value),
    ]),
  ) as Required<AgentCenterBehaviorCopy>;
  const autonomy = state.autonomy;
  const availability = snapshot.availability.updateAutonomy;
  const actionAvailable = availability.state === 'available';
  const mutationAvailable = actionAvailable && !autonomy.controlsDisabled;
  const [enabled, setEnabled] = useState(autonomy.enabled === true);
  const [mode, setMode] = useState<AgentCenterAutonomyMode>(
    (autonomy.mode || 'off') as AgentCenterAutonomyMode,
  );
  const [dailyTokenBudget, setDailyTokenBudget] = useState(String(autonomy.dailyTokenBudget ?? 0));
  const [maxTokensPerHook, setMaxTokensPerHook] = useState(String(autonomy.maxTokensPerHook ?? 0));
  const [mutationStatus, setMutationStatus] = useState<MutationStatus | null>(null);
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
  const disabledNotice = actionAvailable
    ? autonomy.disabledReason || labels.unavailableLabel
    : availability.reason;

  if (!actionAvailable) {
    return (
      <SectionShell labelledBy="agent-center-behavior-title" className="gap-3.5">
        <div data-agent-center-behavior-page="proactive-companion">
          <SectionHeader
            description={labels.description}
            id="agent-center-behavior-title"
            title={labels.title}
          />
        </div>
        <AgentCenterProductActionNotice
          action="updateAutonomy"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      </SectionShell>
    );
  }

  const commit = async (patch: Partial<{
    readonly enabled: boolean;
    readonly mode: AgentCenterAutonomyMode;
    readonly dailyTokenBudget: number;
    readonly maxTokensPerHook: number;
  }>) => {
    if (!mutationAvailable) {
      setMutationStatus({ text: autonomy.disabledReason || labels.unavailableLabel, tone: 'danger' });
      return;
    }

    const previous = {
      enabled,
      mode,
      dailyTokenBudget,
      maxTokensPerHook,
    };
    const nextMode = patch.enabled === false
      ? 'off'
      : patch.enabled === true && (patch.mode ?? mode) === 'off'
        ? 'medium'
        : patch.mode ?? mode;
    const nextEnabled = patch.enabled ?? nextMode !== 'off';
    const nextDailyBudget = patch.dailyTokenBudget ?? dailyLimit;
    const nextPerHookBudget = patch.maxTokensPerHook ?? singleLimit;

    setEnabled(nextEnabled);
    setMode(nextMode);
    setDailyTokenBudget(String(nextDailyBudget));
    setMaxTokensPerHook(String(nextPerHookBudget));
    setMutationStatus({ text: labels.savingLabel, tone: 'info' });

    try {
      if (!autonomy.revision) {
        throw new Error(labels.unavailableLabel);
      }
      await session.updateAutonomy({
        expectedRevision: autonomy.revision,
        enabled: nextEnabled,
        mode: nextMode,
        dailyTokenBudget: nextDailyBudget,
        maxTokensPerHook: nextPerHookBudget,
      });
      const committed = session.getSnapshot().state.autonomy;
      setEnabled(committed.enabled ?? nextEnabled);
      setMode((committed.mode || nextMode) as AgentCenterAutonomyMode);
      setDailyTokenBudget(String(committed.dailyTokenBudget ?? nextDailyBudget));
      setMaxTokensPerHook(String(committed.maxTokensPerHook ?? nextPerHookBudget));
      setMutationStatus({ text: labels.savedLabel, tone: 'success' });
    } catch (error: unknown) {
      setEnabled(previous.enabled);
      setMode(previous.mode);
      setDailyTokenBudget(previous.dailyTokenBudget);
      setMaxTokensPerHook(previous.maxTokensPerHook);
      setMutationStatus({ text: normalizeError(error, labels), tone: 'danger' });
    }
  };

  // WAI-ARIA radiogroup roaming: arrow keys move focus and selection together
  // (automatic activation matches the click-to-commit model of this section).
  const handleModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!mutationAvailable) return;
    const currentIndex = modeOptions.findIndex((option) => option.id === mode);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % modeOptions.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + modeOptions.length) % modeOptions.length;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = modeOptions[nextIndex];
    if (!next) return;
    void commit({ mode: next.id });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-agent-center-behavior-mode="${next.id}"]`)
      ?.focus();
  };

  return (
    <SectionShell
      labelledBy="agent-center-behavior-title"
      className="gap-3.5"
    >
      <div data-agent-center-behavior-page="proactive-companion">
        <SectionHeader
          description={labels.description}
          id="agent-center-behavior-title"
          title={labels.title}
        />
      </div>

      {!mutationAvailable ? (
        <InlineAlert tone="warning">
          <span data-agent-center-action="updateAutonomy" data-agent-center-action-state={availability.state}>
            {disabledNotice}
          </span>
        </InlineAlert>
      ) : null}

      <Card className="rounded-[14px] border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]">
        <div className="flex min-w-0 items-center justify-between gap-4 px-4 py-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">{labels.enableTitle}</span>
            <span className="text-[length:var(--nimi-type-body-sm-size)] leading-[1.45] text-[var(--nimi-text-muted)]">{labels.enableDescription}</span>
          </div>
          <div className="grid shrink-0 justify-items-end gap-2">
            <span className="inline-flex" data-agent-center-proactive-toggle="true">
              <Toggle
                ariaLabel={labels.enableTitle}
                checked={enabled}
                disabled={!mutationAvailable}
                onChange={(next) => {
                  void commit({ enabled: next });
                }}
              />
            </span>
            <StatusBadge tone={enabled ? 'success' : 'neutral'}>
              {enabled ? labels.enabledStatus : labels.disabledStatus}
            </StatusBadge>
          </div>
        </div>
      </Card>

      <Card className="rounded-[14px] border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3.5 shadow-[var(--nimi-elevation-base)]">
        <h3 className="m-0 mb-2.5 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">{labels.modeTitle}</h3>
        <div
          aria-label={labels.modeTitle}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          onKeyDown={handleModeKeyDown}
          role="radiogroup"
        >
          {modeOptions.map((option) => {
            const selected = mode === option.id;
            return (
              <button
                aria-checked={selected}
                className={cnAgentCenter(
                  'relative flex min-h-[72px] min-w-0 items-center gap-3 rounded-[12px] border p-3 text-left transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-55',
                  FOCUS_RING_CLASS_NAME,
                  selected
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,transparent)] text-[var(--nimi-action-primary-bg)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_4%,transparent)]',
                )}
                data-agent-center-behavior-mode={option.id}
                disabled={!mutationAvailable}
                key={option.id}
                onClick={() => {
                  void commit({ mode: option.id });
                }}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <ModeSignalMark mode={option.id} selected={selected} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-[length:var(--nimi-type-body-size)] font-semibold leading-[1.25]">{option.title}</span>
                  <span className={cnAgentCenter('text-[length:var(--nimi-type-body-sm-size)] leading-[1.35]', selected ? 'text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_80%,transparent)]' : 'text-[var(--nimi-text-muted)]')}>
                    {option.description}
                  </span>
                </span>
                {selected ? (
                  <span className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-[14px] border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]">
        <div className="px-4 pb-3 pt-4">
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <h3 className="m-0 min-w-0 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">{labels.budgetTitle}</h3>
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--nimi-text-muted)]" />
          </div>
          <p className="m-0 text-[length:var(--nimi-type-body-sm-size)] leading-[1.45] text-[var(--nimi-text-muted)]">{labels.budgetDescription}</p>
        </div>
        <div className="mx-4 mb-0 overflow-hidden rounded-[12px] border border-[var(--nimi-border-subtle)]">
          <div className="px-4 py-3.5">
            <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-muted)]">{labels.todayUsedLabel}</div>
                <div className="mt-0.5 text-[length:var(--nimi-type-section-title-size)] font-semibold leading-none text-[var(--nimi-text-primary)] tabular-nums">
                  {usedTokens}
                  <span className="text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)]"> / {dailyLimit} {labels.tokensUnit}</span>
                </div>
              </div>
              <div className="shrink-0 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-muted)]">
                {labels.approxPrefix} {percent}%
              </div>
            </div>
            <ProgressIndicator
              data-agent-center-budget-progress="true"
              max={100}
              value={percent}
            />
          </div>
          <div className="grid border-t border-[var(--nimi-border-subtle)] sm:grid-cols-2">
            <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-3 sm:border-b-0 sm:border-r">
              <div className="text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-muted)]">{labels.dailyLimitLabel}</div>
              <div className="mt-0.5 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-secondary)] tabular-nums">{dailyLimit} {labels.tokensUnit}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-muted)]">{labels.singleLimitLabel}</div>
              <div className="mt-0.5 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-secondary)] tabular-nums">{singleLimit} {labels.tokensUnit}</div>
            </div>
          </div>
          <button
            aria-expanded={budgetEditing}
            className={cnAgentCenter(
              'flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] px-4 py-3 text-left text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,transparent)] disabled:cursor-not-allowed disabled:opacity-55',
              FOCUS_RING_CLASS_NAME,
            )}
            data-agent-center-budget-adjust="true"
            disabled={!mutationAvailable}
            onClick={() => setBudgetEditing((value) => !value)}
            type="button"
          >
            <span className="min-w-0 truncate">{labels.adjustLimitLabel}</span>
            <ChevronRight aria-hidden="true" className={cnAgentCenter('h-4 w-4 shrink-0 text-[var(--nimi-text-muted)] transition-transform', budgetEditing && 'rotate-90')} />
          </button>
          {budgetEditing ? (
            <div className="grid min-w-0 gap-2.5 border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="grid min-w-0 gap-1.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-text-secondary)]">
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
              <label className="grid min-w-0 gap-1.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-text-secondary)]">
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
              <Button
                className="self-end"
                data-agent-center-autonomy-apply="true"
                disabled={!mutationAvailable}
                onClick={() => {
                  void commit({
                    dailyTokenBudget: normalizeNonNegative(dailyTokenBudget),
                    maxTokensPerHook: normalizeNonNegative(maxTokensPerHook),
                  });
                }}
                size="sm"
                tone="primary"
              >
                {labels.applyLimitLabel}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="h-4" />
      </Card>
      {mutationStatus ? (
        <InlineAlert tone={mutationStatus.tone}>
          {mutationStatus.text}
        </InlineAlert>
      ) : null}
    </SectionShell>
  );
}
