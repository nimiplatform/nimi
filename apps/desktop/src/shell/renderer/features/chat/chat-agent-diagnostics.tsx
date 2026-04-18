import { useEffect, useState } from 'react';
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

const DIAGNOSTIC_INPUT_CLASS_NAME = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';
const AUTONOMY_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

function RuntimeInspectActionButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <DesktopCompactAction
      onClick={props.onClick}
      disabled={props.disabled}
      tone={props.tone === 'danger' ? 'danger' : 'primary'}
    >
      {props.label}
    </DesktopCompactAction>
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
  onUpdateAutonomyConfig?: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  t: DiagnosticsTranslate;
  targetsPending: boolean;
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
          <DesktopCardSurface kind="operational-solid" as="div" className="px-3 py-3">
            <div className="mb-2 text-sm font-semibold text-gray-900">
              {t('Chat.agentDiagnosticsRuntimeStateTitle', { defaultValue: 'Runtime State' })}
            </div>
            <div className="grid gap-3">
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsStatusTextLabel', { defaultValue: 'Status text' })}
                <input
                  type="text"
                  value={statusText}
                  onChange={(event) => setStatusText(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsWorldContextLabel', { defaultValue: 'World context' })}
                <input
                  type="text"
                  value={worldId}
                  onChange={(event) => setWorldId(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsDyadicUserLabel', { defaultValue: 'Dyadic user' })}
                <input
                  type="text"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsApplyRuntimeState', { defaultValue: 'Apply runtime state' })}
                onClick={() => props.onUpdateRuntimeState?.({ statusText, worldId, userId })}
                disabled={!props.onUpdateRuntimeState || props.mutationPendingAction !== null}
              />
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsClearWorldContext', { defaultValue: 'Clear world context' })}
                onClick={() => props.onClearWorldContext?.()}
                disabled={!props.onClearWorldContext || props.mutationPendingAction !== null}
                tone="danger"
              />
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsClearDyadicContext', { defaultValue: 'Clear dyadic context' })}
                onClick={() => props.onClearDyadicContext?.()}
                disabled={!props.onClearDyadicContext || props.mutationPendingAction !== null}
                tone="danger"
              />
            </div>
          </DesktopCardSurface>
          <RuntimeInspectCard
            label={t('Chat.agentDiagnosticsAutonomyControlTitle', { defaultValue: 'Autonomy Control' })}
            value={props.runtimeInspect.autonomyEnabled === true
              ? t('Chat.agentDiagnosticsAutonomyOn', { defaultValue: 'Runtime autonomy is on' })
              : t('Chat.agentDiagnosticsAutonomyOff', { defaultValue: 'Runtime autonomy is off' })}
            detail={props.runtimeInspect.autonomyEnabled === true
              ? t('Chat.agentDiagnosticsAutonomyOnDetail', {
                defaultValue: 'Disable autonomy when you want chat-only behavior without life-track execution.',
              })
              : props.runtimeInspect.autonomyMode === 'off'
                ? t('Chat.agentDiagnosticsAutonomyOffNeedsModeDetail', {
                  defaultValue: 'Apply a non-off autonomy mode before enabling runtime-owned life-track behavior.',
                })
                : t('Chat.agentDiagnosticsAutonomyOffDetail', {
                  defaultValue: 'Enable autonomy when this agent should resume runtime-owned life-track behavior.',
                })}
          />
          <DesktopCardSurface kind="operational-solid" as="div" className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsAutonomyModeLabel', { defaultValue: 'Autonomy mode' })}
                <select
                  value={autonomyMode}
                  onChange={(event) => setAutonomyMode(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                >
                  {AUTONOMY_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsDailyTokenBudgetLabel', { defaultValue: 'Daily token budget' })}
                <input
                  type="number"
                  min="0"
                  value={dailyTokenBudget}
                  onChange={(event) => setDailyTokenBudget(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </label>
              <label className="text-xs font-semibold text-gray-500">
                {t('Chat.agentDiagnosticsMaxTokensPerHookLabel', { defaultValue: 'Max tokens per hook' })}
                <input
                  type="number"
                  min="0"
                  value={maxTokensPerHook}
                  onChange={(event) => setMaxTokensPerHook(event.target.value)}
                  disabled={props.mutationPendingAction !== null}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsRefreshInspect', { defaultValue: 'Refresh inspect' })}
                onClick={() => props.onRefreshInspect?.()}
                disabled={!props.onRefreshInspect || props.runtimeInspectLoading || props.mutationPendingAction !== null}
              />
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsApplyAutonomyConfig', { defaultValue: 'Apply autonomy config' })}
                onClick={() => props.onUpdateAutonomyConfig?.({ mode: autonomyMode, dailyTokenBudget, maxTokensPerHook })}
                disabled={!props.onUpdateAutonomyConfig || props.mutationPendingAction !== null}
              />
              {props.runtimeInspect.autonomyEnabled === true ? (
                <RuntimeInspectActionButton
                  label={t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' })}
                  onClick={() => props.onDisableAutonomy?.()}
                  disabled={!props.onDisableAutonomy || props.mutationPendingAction !== null}
                  tone="danger"
                />
              ) : (
                <RuntimeInspectActionButton
                  label={t('Chat.agentDiagnosticsEnableAutonomy', { defaultValue: 'Enable autonomy' })}
                  onClick={() => props.onEnableAutonomy?.()}
                  disabled={
                    !props.onEnableAutonomy
                    || props.mutationPendingAction !== null
                    || props.runtimeInspect.autonomyMode === 'off'
                  }
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
          </DesktopCardSurface>
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
