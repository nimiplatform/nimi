import { useEffect, useState, type ReactNode } from 'react';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type {
  RuntimeAgentInspectEventSummary,
  RuntimeAgentInspectSnapshot,
} from '@renderer/infra/runtime-agent-inspect';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import {
  buildAgentDiagnosticsViewModel,
  type DiagnosticsTranslate,
} from './chat-agent-diagnostics-view-model';
import {
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';
import { AgentDiagnosticsAvatarOverrideCard } from './chat-agent-diagnostics-avatar-override';

const DIAGNOSTIC_INPUT_CLASS_NAME = 'mt-1.5 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';
// Same input look but no top margin — used inside DiagnosticsInlineField where the
// label sits to the LEFT, not above, so the field shouldn't push itself down.
const DIAGNOSTIC_INLINE_INPUT_CLASS_NAME = 'w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';

const AUTONOMY_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

/**
 * Compact key/value row used inside the Advanced/Debug Runtime overview grid.
 * Picks a tone class from the value text so "Ready" renders green, "Loading…"
 * sky-blue, all-caps tokens (MASTER_OWNED) mono, and everything else neutral.
 */
function DiagnosticsKv(props: { label: string; value: string; detail?: string }) {
  const trimmed = props.value.trim();
  const isLoading = /^(loading|checking)/i.test(trimmed) || trimmed.endsWith('…') || /loading\.{2,3}$/i.test(trimmed);
  const isReady = /^(ready|runtime ready|on)$/i.test(trimmed);
  const isMonoToken = /^[A-Z][A-Z0-9_]+$/.test(trimmed);
  const valueClass = isLoading
    ? 'text-sky-700'
    : isReady
      ? 'text-emerald-700 font-semibold'
      : isMonoToken
        ? 'font-mono text-[11px] text-slate-900'
        : 'text-slate-900';
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{props.label}</div>
      <div className={`mt-1 truncate text-[13px] font-semibold ${valueClass}`} title={trimmed}>
        {trimmed || '—'}
      </div>
      {props.detail ? (
        <div className="mt-0.5 truncate text-[11.5px] leading-[1.5] text-slate-600">{props.detail}</div>
      ) : null}
    </div>
  );
}

function DiagnosticsSectionCard(props: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DesktopCardSurface kind="operational-solid" as="div" className="space-y-3 px-3.5 py-3">
      <div className="space-y-1">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {props.title}
        </h4>
        {props.hint ? (
          <p className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">{props.hint}</p>
        ) : null}
      </div>
      {props.children}
    </DesktopCardSurface>
  );
}

function DiagnosticsFieldLabel(props: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
      {props.label}
      {props.children}
    </label>
  );
}

function RuntimeInspectActionButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  return (
    <DesktopCompactAction onClick={props.onClick} disabled={props.disabled} tone={props.tone}>
      {props.label}
    </DesktopCompactAction>
  );
}

/**
 * Ghost-red action used for destructive recovery operations (Clear context, Clear override).
 * Same height as DesktopCompactAction but tertiary-weight so the primary "Apply X" stays the
 * single visual focus per section.
 */
function DiagnosticsDangerGhostButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex h-[30px] items-center justify-center whitespace-nowrap rounded-xl border border-transparent bg-transparent px-3 text-[12px] font-medium text-red-700 transition-colors hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.label}
    </button>
  );
}

/**
 * Inline-left labeled row for short, single-line debug inputs. Halves vertical space
 * compared to label-on-top forms while preserving uppercase-tracked label visuals.
 */
function DiagnosticsInlineField(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-[120px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        {props.label}
      </label>
      <div className="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

/** Small icon-only button used in AdvBlock headers (e.g. Refresh inspect). */
function DiagnosticsHeaderIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-slate-200/90 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={props.spinning ? 'animate-spin' : undefined}>{props.children}</span>
    </button>
  );
}

export type AgentDiagnosticsSectionId = 'runtime' | 'runtime-state' | 'autonomy-control' | 'avatar-override' | 'turns';

export type AgentDiagnosticsSection = {
  id: AgentDiagnosticsSectionId;
  title: string;
  body: ReactNode;
  /** Surfaces unsaved local edits (e.g. a status text the user hasn't applied yet). */
  dirty?: boolean;
  /** Optional inline action rendered in the section header (e.g. Refresh inspect). */
  headerAction?: ReactNode;
};

export function AgentDiagnosticsPanel(props: {
  activeTarget: AgentLocalTargetSnapshot | null;
  lifecycle: AgentTurnLifecycleState | null;
  mutationPendingAction: string | null;
  onCancelHook?: (hookId: string) => void;
  onClearDyadicContext?: () => void;
  onClearWorldContext?: () => void;
  onDisableAutonomy?: () => void;
  onEnableAutonomy?: () => void;
  onRefreshInspect?: () => void;
  onUpdateRuntimeState?: (input: { statusText: string; worldId: string; userId: string }) => void;
  onUpdateAutonomyConfig?: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  t: DiagnosticsTranslate;
  targetsPending: boolean;
  /** Optional shell renderer that wraps each section in a custom container (e.g. AdvBlock). */
  renderShell?: (sections: ReadonlyArray<AgentDiagnosticsSection>) => ReactNode;
}) {
  const viewModel = buildAgentDiagnosticsViewModel(props);
  const t = props.t;
  const [autonomyMode, setAutonomyMode] = useState('off');
  const [dailyTokenBudget, setDailyTokenBudget] = useState('');
  const [maxTokensPerHook, setMaxTokensPerHook] = useState('');
  const [statusText, setStatusText] = useState('');
  const [worldId, setWorldId] = useState('');
  const [userId, setUserId] = useState('');
  useEffect(() => {
    setAutonomyMode(props.runtimeInspect?.autonomyMode || 'off');
    setDailyTokenBudget(
      props.runtimeInspect?.autonomyDailyTokenBudget !== null
      && props.runtimeInspect?.autonomyDailyTokenBudget !== undefined
        ? String(props.runtimeInspect.autonomyDailyTokenBudget)
        : '0',
    );
    setMaxTokensPerHook(
      props.runtimeInspect?.autonomyMaxTokensPerHook !== null
      && props.runtimeInspect?.autonomyMaxTokensPerHook !== undefined
        ? String(props.runtimeInspect.autonomyMaxTokensPerHook)
        : '0',
    );
  }, [
    props.runtimeInspect?.autonomyDailyTokenBudget,
    props.runtimeInspect?.autonomyMaxTokensPerHook,
    props.runtimeInspect?.autonomyMode,
  ]);
  useEffect(() => {
    setStatusText(props.runtimeInspect?.statusText || '');
    setWorldId(props.runtimeInspect?.activeWorldId || '');
    setUserId(props.runtimeInspect?.activeUserId || '');
  }, [props.runtimeInspect?.statusText, props.runtimeInspect?.activeWorldId, props.runtimeInspect?.activeUserId]);
  const hasRuntimeInspect = Boolean(props.activeTarget && props.runtimeInspect);
  const autonomyStatusValue = props.runtimeInspect?.autonomyEnabled === true
    ? t('Chat.agentDiagnosticsAutonomyOn', { defaultValue: 'Runtime autonomy is on' })
    : t('Chat.agentDiagnosticsAutonomyOff', { defaultValue: 'Runtime autonomy is off' });
  const autonomyStatusDetail = props.runtimeInspect?.autonomyEnabled === true
    ? t('Chat.agentDiagnosticsAutonomyOnDetail', {
      defaultValue: 'Disable autonomy when you want chat-only behavior without life-track execution.',
    })
    : props.runtimeInspect?.autonomyMode === 'off'
      ? t('Chat.agentDiagnosticsAutonomyOffNeedsModeDetail', {
        defaultValue: 'Apply a non-off autonomy mode before enabling runtime-owned life-track behavior.',
      })
      : t('Chat.agentDiagnosticsAutonomyOffDetail', {
        defaultValue: 'Enable autonomy when this agent should resume runtime-owned life-track behavior.',
      });
  const mutationPending = props.mutationPendingAction !== null;

  // ── Dirty tracking — devs see explicit unsaved indicators (amber dot in section title)
  //    and the Apply button is disabled until something actually changed. Apply also resets
  //    the dirty signal on commit because the source-of-truth state syncs back on the next
  //    runtime tick (the useEffects above re-seed the inputs from runtimeInspect).
  const runtimeStateInspect = props.runtimeInspect;
  const runtimeStateDirty = !!runtimeStateInspect && (
    statusText !== (runtimeStateInspect.statusText || '')
    || worldId !== (runtimeStateInspect.activeWorldId || '')
    || userId !== (runtimeStateInspect.activeUserId || '')
  );
  const autonomyConfigDirty = !!runtimeStateInspect && (
    autonomyMode !== (runtimeStateInspect.autonomyMode || 'off')
    || dailyTokenBudget !== String(runtimeStateInspect.autonomyDailyTokenBudget ?? 0)
    || maxTokensPerHook !== String(runtimeStateInspect.autonomyMaxTokensPerHook ?? 0)
  );

  // ── Section bodies (extracted so renderShell can wrap them individually) ──
  const runtimeOverviewBody = (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      <DiagnosticsKv label={viewModel.runtimeCard.label} value={viewModel.runtimeCard.value} detail={viewModel.runtimeCard.detail || undefined} />
      {viewModel.stateCards.map((card) => (
        <DiagnosticsKv key={card.key} label={card.label} value={card.value} detail={card.detail || undefined} />
      ))}
    </div>
  );

  // Refresh action lives on the Runtime header (not buried in Autonomy Control). The
  // shared spinner state visualizes both inflight inspect refreshes and any other
  // mutation in flight that would block a parallel inspect call.
  const refreshDisabled = !props.onRefreshInspect || props.runtimeInspectLoading || mutationPending;
  const runtimeOverviewHeaderAction = props.onRefreshInspect ? (
    <DiagnosticsHeaderIconButton
      label={t('Chat.agentDiagnosticsRefreshInspect', { defaultValue: 'Refresh inspect' })}
      onClick={() => props.onRefreshInspect?.()}
      disabled={refreshDisabled}
      spinning={props.runtimeInspectLoading}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </DiagnosticsHeaderIconButton>
  ) : null;

  const runtimeStateBody = runtimeStateInspect ? (
    <div className="space-y-3.5">
      {/* Inline-left labels — short text inputs read like a key/value list, ~50% denser than label-on-top. */}
      <div className="space-y-2.5">
        <DiagnosticsInlineField label={t('Chat.agentDiagnosticsStatusTextLabel', { defaultValue: 'Status text' })}>
          <input
            type="text"
            value={statusText}
            onChange={(event) => setStatusText(event.target.value)}
            disabled={mutationPending}
            className={DIAGNOSTIC_INLINE_INPUT_CLASS_NAME}
          />
        </DiagnosticsInlineField>
        <DiagnosticsInlineField label={t('Chat.agentDiagnosticsWorldContextLabel', { defaultValue: 'World context' })}>
          <input
            type="text"
            value={worldId}
            onChange={(event) => setWorldId(event.target.value)}
            disabled={mutationPending}
            className={DIAGNOSTIC_INLINE_INPUT_CLASS_NAME}
          />
        </DiagnosticsInlineField>
        <DiagnosticsInlineField label={t('Chat.agentDiagnosticsDyadicUserLabel', { defaultValue: 'Dyadic user' })}>
          <input
            type="text"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={mutationPending}
            className={DIAGNOSTIC_INLINE_INPUT_CLASS_NAME}
          />
        </DiagnosticsInlineField>
      </div>
      {/* Apply renders as a solid emerald pill (the single primary action). Clear World /
          Clear Dyadic are flat red-text links — no bg/border — so destructive recovery doesn't
          compete visually with Apply. Matches the Advanced page Runtime State reference. */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => props.onUpdateRuntimeState?.({ statusText, worldId, userId })}
          disabled={!props.onUpdateRuntimeState || mutationPending || !runtimeStateDirty}
          className="inline-flex min-h-[36px] items-center justify-center whitespace-normal rounded-2xl bg-emerald-500 px-4 py-1.5 text-center text-[12.5px] font-semibold leading-tight text-white shadow-[0_4px_10px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          {t('Chat.agentDiagnosticsApplyRuntimeState', { defaultValue: 'Apply runtime state' })}
        </button>
        <button
          type="button"
          onClick={() => props.onClearWorldContext?.()}
          disabled={!props.onClearWorldContext || mutationPending}
          className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
        >
          {t('Chat.agentDiagnosticsClearWorldContext', { defaultValue: 'Clear world context' })}
        </button>
        <button
          type="button"
          onClick={() => props.onClearDyadicContext?.()}
          disabled={!props.onClearDyadicContext || mutationPending}
          className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
        >
          {t('Chat.agentDiagnosticsClearDyadicContext', { defaultValue: 'Clear dyadic context' })}
        </button>
      </div>
    </div>
  ) : null;

  const autonomyControlBody = runtimeStateInspect ? (
    <div className="space-y-3.5">
      <p className="m-0 text-[11px] leading-[1.5] text-slate-500">{autonomyStatusDetail}</p>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            runtimeStateInspect.autonomyEnabled === true
              ? 'bg-[var(--nimi-status-success)]'
              : 'bg-[var(--nimi-text-muted)]'
          }`}
        />
        <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
          {autonomyStatusValue}
        </span>
      </div>
      {/* Mode keeps inline-left; numeric pair stays as a 2-col grid for compact entry. */}
      <div className="space-y-2.5">
        <DiagnosticsInlineField label={t('Chat.agentDiagnosticsAutonomyModeLabel', { defaultValue: 'Autonomy mode' })}>
          <select
            value={autonomyMode}
            onChange={(event) => setAutonomyMode(event.target.value)}
            disabled={mutationPending}
            className={DIAGNOSTIC_INLINE_INPUT_CLASS_NAME}
          >
            {AUTONOMY_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </DiagnosticsInlineField>
        <div className="grid grid-cols-2 gap-2">
          <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsDailyTokenBudgetLabel', { defaultValue: 'Daily token budget' })}>
            <input
              type="number"
              min="0"
              value={dailyTokenBudget}
              onChange={(event) => setDailyTokenBudget(event.target.value)}
              disabled={mutationPending}
              className={DIAGNOSTIC_INPUT_CLASS_NAME}
            />
          </DiagnosticsFieldLabel>
          <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsMaxTokensPerHookLabel', { defaultValue: 'Max tokens per hook' })}>
            <input
              type="number"
              min="0"
              value={maxTokensPerHook}
              onChange={(event) => setMaxTokensPerHook(event.target.value)}
              disabled={mutationPending}
              className={DIAGNOSTIC_INPUT_CLASS_NAME}
            />
          </DiagnosticsFieldLabel>
        </div>
      </div>
      {/* Apply Config (outlined, white) sits as the secondary action; Enable Autonomy is the
          solid emerald primary. When autonomy is already on, the primary slot flips to a red
          filled "Disable autonomy" so the destructive intent is unmistakable. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => props.onUpdateAutonomyConfig?.({ mode: autonomyMode, dailyTokenBudget, maxTokensPerHook })}
          disabled={!props.onUpdateAutonomyConfig || mutationPending || !autonomyConfigDirty}
          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t('Chat.agentDiagnosticsApplyAutonomyConfig', { defaultValue: 'Apply Config' })}
        </button>
        {runtimeStateInspect.autonomyEnabled === true ? (
          <button
            type="button"
            onClick={() => props.onDisableAutonomy?.()}
            disabled={!props.onDisableAutonomy || mutationPending}
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-red-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(239,68,68,0.25)] transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
          >
            {t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.onEnableAutonomy?.()}
            disabled={
              !props.onEnableAutonomy
              || mutationPending
              || runtimeStateInspect.autonomyMode === 'off'
            }
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-emerald-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
          >
            {t('Chat.agentDiagnosticsEnableAutonomy', { defaultValue: 'Enable Autonomy' })}
          </button>
        )}
      </div>
      {runtimeStateInspect.pendingHooks.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
            {t('Chat.agentDiagnosticsPendingHooksLabel', { defaultValue: 'Pending hooks' })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {runtimeStateInspect.pendingHooks.map((hook) => (
              hook.hookId ? (
                <DiagnosticsDangerGhostButton
                  key={hook.hookId}
                  label={`${t('Chat.agentDiagnosticsCancelHook', { defaultValue: 'Cancel' })} ${hook.hookId}`}
                  onClick={() => props.onCancelHook?.(hook.hookId)}
                  disabled={!props.onCancelHook || mutationPending}
                />
              ) : null
            ))}
          </div>
        </div>
      ) : null}
      {props.mutationPendingAction ? (
        <div className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">
          {props.mutationPendingAction}
        </div>
      ) : null}
    </div>
  ) : null;

  const avatarOverrideBody = hasRuntimeInspect ? (
    <AgentDiagnosticsAvatarOverrideCard t={t} disabled={mutationPending} bodyOnly />
  ) : null;

  const turnsBody = !viewModel.emptyLabel && viewModel.turnCards.length > 0 ? (
    <div className="space-y-2.5">
      {viewModel.turnCards.map((card) => (
        <RuntimeInspectCard
          key={card.key}
          label={card.label}
          value={card.value}
          detail={card.detail || undefined}
        />
      ))}
    </div>
  ) : null;

  // Renderer-shell mode: caller controls per-section presentation (e.g. AdvBlock per section).
  if (props.renderShell) {
    const sections: AgentDiagnosticsSection[] = [
      {
        id: 'runtime',
        title: t('Chat.agentDiagnosticsRuntimeOverviewTitle', { defaultValue: 'Runtime' }),
        body: runtimeOverviewBody,
        headerAction: runtimeOverviewHeaderAction,
      },
    ];
    if (runtimeStateBody) {
      sections.push({
        id: 'runtime-state',
        title: t('Chat.agentDiagnosticsRuntimeStateTitle', { defaultValue: 'Runtime State' }),
        body: runtimeStateBody,
        dirty: runtimeStateDirty,
      });
    }
    if (autonomyControlBody) {
      sections.push({
        id: 'autonomy-control',
        title: t('Chat.agentDiagnosticsAutonomyControlTitle', { defaultValue: 'Autonomy Control' }),
        body: autonomyControlBody,
        dirty: autonomyConfigDirty,
      });
    }
    if (avatarOverrideBody) {
      sections.push({
        id: 'avatar-override',
        title: t('Chat.agentDiagnosticsAvatarOverrideTitle', { defaultValue: 'Avatar Override' }),
        body: avatarOverrideBody,
      });
    }
    if (turnsBody) {
      sections.push({ id: 'turns', title: t('Chat.agentDiagnosticsRecentTurnsTitle', { defaultValue: 'Recent turns' }), body: turnsBody });
    }
    return (
      <div data-testid="agent-diagnostics-panel">
        {props.renderShell(sections)}
        {viewModel.emptyLabel ? <RuntimeInspectUnsupportedNote label={viewModel.emptyLabel} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="agent-diagnostics-panel">
      {/* Overview — runtime + state cards in a tighter single column */}
      <RuntimeInspectCard
        label={viewModel.runtimeCard.label}
        value={viewModel.runtimeCard.value}
        detail={viewModel.runtimeCard.detail || undefined}
      />
      {viewModel.stateCards.length > 0 ? (
        <div className="space-y-2.5">
          {viewModel.stateCards.map((card) => (
            <RuntimeInspectCard
              key={card.key}
              label={card.label}
              value={card.value}
              detail={card.detail || undefined}
            />
          ))}
        </div>
      ) : null}

      {hasRuntimeInspect && props.runtimeInspect ? (
        <>
          {/* Runtime state editing */}
          <DiagnosticsSectionCard
            title={t('Chat.agentDiagnosticsRuntimeStateTitle', { defaultValue: 'Runtime State' })}
          >
            <div className="space-y-2.5">
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsStatusTextLabel', { defaultValue: 'Status text' })}>
                <input
                  type="text"
                  value={statusText}
                  onChange={(event) => setStatusText(event.target.value)}
                  disabled={mutationPending}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </DiagnosticsFieldLabel>
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsWorldContextLabel', { defaultValue: 'World context' })}>
                <input
                  type="text"
                  value={worldId}
                  onChange={(event) => setWorldId(event.target.value)}
                  disabled={mutationPending}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </DiagnosticsFieldLabel>
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsDyadicUserLabel', { defaultValue: 'Dyadic user' })}>
                <input
                  type="text"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  disabled={mutationPending}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </DiagnosticsFieldLabel>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => props.onUpdateRuntimeState?.({ statusText, worldId, userId })}
                disabled={!props.onUpdateRuntimeState || mutationPending || !runtimeStateDirty}
                className="inline-flex min-h-[36px] items-center justify-center whitespace-normal rounded-2xl bg-emerald-500 px-4 py-1.5 text-center text-[12.5px] font-semibold leading-tight text-white shadow-[0_4px_10px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                {t('Chat.agentDiagnosticsApplyRuntimeState', { defaultValue: 'Apply runtime state' })}
              </button>
              <button
                type="button"
                onClick={() => props.onClearWorldContext?.()}
                disabled={!props.onClearWorldContext || mutationPending}
                className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
              >
                {t('Chat.agentDiagnosticsClearWorldContext', { defaultValue: 'Clear world context' })}
              </button>
              <button
                type="button"
                onClick={() => props.onClearDyadicContext?.()}
                disabled={!props.onClearDyadicContext || mutationPending}
                className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
              >
                {t('Chat.agentDiagnosticsClearDyadicContext', { defaultValue: 'Clear dyadic context' })}
              </button>
            </div>
          </DiagnosticsSectionCard>

          {/* Autonomy — status + config inline */}
          <DiagnosticsSectionCard
            title={t('Chat.agentDiagnosticsAutonomyControlTitle', { defaultValue: 'Autonomy Control' })}
            hint={autonomyStatusDetail}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  props.runtimeInspect.autonomyEnabled === true
                    ? 'bg-[var(--nimi-status-success)]'
                    : 'bg-[var(--nimi-text-muted)]'
                }`}
              />
              <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
                {autonomyStatusValue}
              </span>
            </div>
            <div className="space-y-2.5">
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsAutonomyModeLabel', { defaultValue: 'Autonomy mode' })}>
                <select
                  value={autonomyMode}
                  onChange={(event) => setAutonomyMode(event.target.value)}
                  disabled={mutationPending}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                >
                  {AUTONOMY_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </DiagnosticsFieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsDailyTokenBudgetLabel', { defaultValue: 'Daily token budget' })}>
                  <input
                    type="number"
                    min="0"
                    value={dailyTokenBudget}
                    onChange={(event) => setDailyTokenBudget(event.target.value)}
                    disabled={mutationPending}
                    className={DIAGNOSTIC_INPUT_CLASS_NAME}
                  />
                </DiagnosticsFieldLabel>
                <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsMaxTokensPerHookLabel', { defaultValue: 'Max tokens per hook' })}>
                  <input
                    type="number"
                    min="0"
                    value={maxTokensPerHook}
                    onChange={(event) => setMaxTokensPerHook(event.target.value)}
                    disabled={mutationPending}
                    className={DIAGNOSTIC_INPUT_CLASS_NAME}
                  />
                </DiagnosticsFieldLabel>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => props.onUpdateAutonomyConfig?.({ mode: autonomyMode, dailyTokenBudget, maxTokensPerHook })}
                disabled={!props.onUpdateAutonomyConfig || mutationPending || !autonomyConfigDirty}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('Chat.agentDiagnosticsApplyAutonomyConfig', { defaultValue: 'Apply Config' })}
              </button>
              {props.runtimeInspect.autonomyEnabled === true ? (
                <button
                  type="button"
                  onClick={() => props.onDisableAutonomy?.()}
                  disabled={!props.onDisableAutonomy || mutationPending}
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-red-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(239,68,68,0.25)] transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                >
                  {t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => props.onEnableAutonomy?.()}
                  disabled={
                    !props.onEnableAutonomy
                    || mutationPending
                    || props.runtimeInspect.autonomyMode === 'off'
                  }
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-emerald-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                >
                  {t('Chat.agentDiagnosticsEnableAutonomy', { defaultValue: 'Enable Autonomy' })}
                </button>
              )}
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsRefreshInspect', { defaultValue: 'Refresh inspect' })}
                onClick={() => props.onRefreshInspect?.()}
                disabled={!props.onRefreshInspect || props.runtimeInspectLoading || mutationPending}
              />
            </div>
            {props.runtimeInspect.pendingHooks.length > 0 ? (
              <div className="space-y-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
                  {t('Chat.agentDiagnosticsPendingHooksLabel', { defaultValue: 'Pending hooks' })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {props.runtimeInspect.pendingHooks.map((hook) => (
                    hook.hookId ? (
                      <RuntimeInspectActionButton
                        key={hook.hookId}
                        tone="danger"
                        label={`${t('Chat.agentDiagnosticsCancelHook', { defaultValue: 'Cancel' })} ${hook.hookId}`}
                        onClick={() => props.onCancelHook?.(hook.hookId)}
                        disabled={!props.onCancelHook || mutationPending}
                      />
                    ) : null
                  ))}
                </div>
              </div>
            ) : null}
            {props.mutationPendingAction ? (
              <div className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">
                {props.mutationPendingAction}
              </div>
            ) : null}
          </DiagnosticsSectionCard>

          <AgentDiagnosticsAvatarOverrideCard t={t} disabled={mutationPending} />

        </>
      ) : null}

      {viewModel.emptyLabel ? (
        <RuntimeInspectUnsupportedNote label={viewModel.emptyLabel} />
      ) : (
        <div className="space-y-2.5">
          {viewModel.turnCards.map((card) => (
            <RuntimeInspectCard
              key={card.key}
              label={card.label}
              value={card.value}
              detail={card.detail || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
