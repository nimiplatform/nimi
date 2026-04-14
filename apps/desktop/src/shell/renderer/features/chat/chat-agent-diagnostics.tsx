import { useEffect, useState } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
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

function RuntimeInspectActionButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
        props.tone === 'danger'
          ? 'border-red-300 bg-red-500 text-white hover:bg-red-600'
          : 'border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {props.label}
    </button>
  );
}

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
  onUpdateAutonomyConfig?: (input: { dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  t: DiagnosticsTranslate;
  targetsPending: boolean;
}) {
  const viewModel = buildAgentDiagnosticsViewModel(props);
  const [dailyTokenBudget, setDailyTokenBudget] = useState('');
  const [maxTokensPerHook, setMaxTokensPerHook] = useState('');
  const [statusText, setStatusText] = useState('');
  const [worldId, setWorldId] = useState('');
  const [userId, setUserId] = useState('');
  useEffect(() => {
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
  }, [props.runtimeInspect?.autonomyDailyTokenBudget, props.runtimeInspect?.autonomyMaxTokensPerHook]);
  useEffect(() => {
    setStatusText(props.runtimeInspect?.statusText || '');
    setWorldId(props.runtimeInspect?.activeWorldId || '');
    setUserId(props.runtimeInspect?.activeUserId || '');
  }, [props.runtimeInspect?.statusText, props.runtimeInspect?.activeWorldId, props.runtimeInspect?.activeUserId]);
  return (
    <div className="space-y-3">
      <RuntimeInspectCard
        label={viewModel.runtimeCard.label}
        value={viewModel.runtimeCard.value}
        detail={viewModel.runtimeCard.detail || undefined}
      />
      {viewModel.stateCards.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
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
      {props.activeTarget && props.runtimeInspect ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
            <div className="mb-2 text-sm font-semibold text-gray-900">Runtime State</div>
            <div className="grid gap-3">
              <label className="text-xs font-semibold text-gray-500">
                Status text
                <input
                  type="text"
                  value={statusText}
                  onChange={(event) => setStatusText(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                World context
                <input
                  type="text"
                  value={worldId}
                  onChange={(event) => setWorldId(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                Dyadic user
                <input
                  type="text"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <RuntimeInspectActionButton
                label="Apply runtime state"
                onClick={() => props.onUpdateRuntimeState?.({ statusText, worldId, userId })}
                disabled={!props.onUpdateRuntimeState || props.mutationPendingAction !== null}
              />
              <RuntimeInspectActionButton
                label="Clear world context"
                onClick={() => props.onClearWorldContext?.()}
                disabled={!props.onClearWorldContext || props.mutationPendingAction !== null}
                tone="danger"
              />
              <RuntimeInspectActionButton
                label="Clear dyadic context"
                onClick={() => props.onClearDyadicContext?.()}
                disabled={!props.onClearDyadicContext || props.mutationPendingAction !== null}
                tone="danger"
              />
            </div>
          </div>
          <RuntimeInspectCard
            label="Autonomy Control"
            value={props.runtimeInspect.autonomyEnabled === true ? 'Runtime autonomy is on' : 'Runtime autonomy is off'}
            detail={props.runtimeInspect.autonomyEnabled === true
              ? 'Disable autonomy when you want chat-only behavior without life-track execution.'
              : 'Enable autonomy when this agent should resume runtime-owned life-track behavior.'}
          />
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-gray-500">
                Daily token budget
                <input
                  type="number"
                  min="0"
                  value={dailyTokenBudget}
                  onChange={(event) => setDailyTokenBudget(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                Max tokens per hook
                <input
                  type="number"
                  min="0"
                  value={maxTokensPerHook}
                  onChange={(event) => setMaxTokensPerHook(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <RuntimeInspectActionButton
                label="Refresh inspect"
                onClick={() => props.onRefreshInspect?.()}
                disabled={!props.onRefreshInspect || props.runtimeInspectLoading || props.mutationPendingAction !== null}
              />
              <RuntimeInspectActionButton
                label="Apply autonomy config"
                onClick={() => props.onUpdateAutonomyConfig?.({ dailyTokenBudget, maxTokensPerHook })}
                disabled={!props.onUpdateAutonomyConfig || props.mutationPendingAction !== null}
              />
              {props.runtimeInspect.autonomyEnabled === true ? (
                <RuntimeInspectActionButton
                  label="Disable autonomy"
                  onClick={() => props.onDisableAutonomy?.()}
                  disabled={!props.onDisableAutonomy || props.mutationPendingAction !== null}
                  tone="danger"
                />
              ) : (
                <RuntimeInspectActionButton
                  label="Enable autonomy"
                  onClick={() => props.onEnableAutonomy?.()}
                  disabled={!props.onEnableAutonomy || props.mutationPendingAction !== null}
                />
              )}
              {props.runtimeInspect.pendingHooks.map((hook) => (
                hook.hookId ? (
                  <RuntimeInspectActionButton
                    key={hook.hookId}
                    label={`Cancel ${hook.hookId}`}
                    onClick={() => props.onCancelHook?.(hook.hookId)}
                    disabled={!props.onCancelHook || props.mutationPendingAction !== null}
                    tone="danger"
                  />
                ) : null
              ))}
            </div>
            {props.mutationPendingAction ? (
              <div className="mt-2 text-xs leading-5 text-gray-500">
                {props.mutationPendingAction}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {viewModel.emptyLabel ? (
        <RuntimeInspectUnsupportedNote label={viewModel.emptyLabel} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
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
