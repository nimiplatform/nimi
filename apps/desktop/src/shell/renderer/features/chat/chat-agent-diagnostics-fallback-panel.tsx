import type { Dispatch, SetStateAction } from 'react';
import { CompactAction } from '@nimiplatform/kit/ui';
import type { NimiRuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';
import type {
  buildAgentDiagnosticsViewModel,
  DiagnosticsTranslate,
} from './chat-agent-diagnostics-view-model';
import {
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';
import { AgentDiagnosticsAvatarOverrideCard } from './chat-agent-diagnostics-avatar-override';
import {
  CHAT_DIAGNOSTICS_AUTONOMY_MODE_OPTIONS,
  DIAGNOSTIC_INPUT_CLASS_NAME,
  DiagnosticsFieldLabel,
  DiagnosticsSectionCard,
  RuntimeInspectActionButton,
} from './chat-agent-diagnostics-controls';

type AgentDiagnosticsViewModel = ReturnType<typeof buildAgentDiagnosticsViewModel>;

type AgentDiagnosticsFallbackPanelProps = {
  autonomyConfigDirty: boolean;
  autonomyMode: string;
  autonomyStatusDetail: string;
  autonomyStatusValue: string;
  dailyTokenBudget: string;
  hasRuntimeInspect: boolean;
  maxTokensPerHook: string;
  mutationPending: boolean;
  mutationPendingAction: string | null;
  onCancelHook?: (hookId: string) => void;
  onClearDyadicContext?: () => void;
  onClearWorldContext?: () => void;
  onDisableAutonomy?: () => void;
  onEnableAutonomy?: () => void;
  onRefreshInspect?: () => void;
  onUpdateAutonomyConfig?: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  onUpdateRuntimeState?: (input: { statusText: string; worldId: string; userId: string }) => void;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  runtimeStateDirty: boolean;
  setAutonomyMode: Dispatch<SetStateAction<string>>;
  setDailyTokenBudget: Dispatch<SetStateAction<string>>;
  setMaxTokensPerHook: Dispatch<SetStateAction<string>>;
  setStatusText: Dispatch<SetStateAction<string>>;
  setUserId: Dispatch<SetStateAction<string>>;
  setWorldId: Dispatch<SetStateAction<string>>;
  statusText: string;
  t: DiagnosticsTranslate;
  userId: string;
  viewModel: AgentDiagnosticsViewModel;
  worldId: string;
};

export function AgentDiagnosticsFallbackPanel({
  autonomyConfigDirty,
  autonomyMode,
  autonomyStatusDetail,
  autonomyStatusValue,
  dailyTokenBudget,
  hasRuntimeInspect,
  maxTokensPerHook,
  mutationPending,
  mutationPendingAction,
  onCancelHook,
  onClearDyadicContext,
  onClearWorldContext,
  onDisableAutonomy,
  onEnableAutonomy,
  onRefreshInspect,
  onUpdateAutonomyConfig,
  onUpdateRuntimeState,
  runtimeInspect,
  runtimeInspectLoading,
  runtimeStateDirty,
  setAutonomyMode,
  setDailyTokenBudget,
  setMaxTokensPerHook,
  setStatusText,
  setUserId,
  setWorldId,
  statusText,
  t,
  userId,
  viewModel,
  worldId,
}: AgentDiagnosticsFallbackPanelProps) {
  return (
    <div className="space-y-3" data-testid="agent-diagnostics-panel">
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

      {hasRuntimeInspect && runtimeInspect ? (
        <>
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
              <CompactAction
                type="button"
                onClick={() => onUpdateRuntimeState?.({ statusText, worldId, userId })}
                disabled={!onUpdateRuntimeState || mutationPending || !runtimeStateDirty}
                tone="primary"
              >
                {t('Chat.agentDiagnosticsApplyRuntimeState', { defaultValue: 'Apply runtime state' })}
              </CompactAction>
              <button
                type="button"
                onClick={() => onClearWorldContext?.()}
                disabled={!onClearWorldContext || mutationPending}
                className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
              >
                {t('Chat.agentDiagnosticsClearWorldContext', { defaultValue: 'Clear world context' })}
              </button>
              <button
                type="button"
                onClick={() => onClearDyadicContext?.()}
                disabled={!onClearDyadicContext || mutationPending}
                className="inline-flex items-center text-[12.5px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
              >
                {t('Chat.agentDiagnosticsClearDyadicContext', { defaultValue: 'Clear dyadic context' })}
              </button>
            </div>
          </DiagnosticsSectionCard>

          <DiagnosticsSectionCard
            title={t('Chat.agentDiagnosticsAutonomyControlTitle', { defaultValue: 'Autonomy Control' })}
            hint={autonomyStatusDetail}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  runtimeInspect.autonomyEnabled === true
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
                  {CHAT_DIAGNOSTICS_AUTONOMY_MODE_OPTIONS.map((option) => (
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
                onClick={() => onUpdateAutonomyConfig?.({ mode: autonomyMode, dailyTokenBudget, maxTokensPerHook })}
                disabled={!onUpdateAutonomyConfig || mutationPending || !autonomyConfigDirty}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-[12.5px] font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('Chat.agentDiagnosticsApplyAutonomyConfig', { defaultValue: 'Apply Config' })}
              </button>
              {runtimeInspect.autonomyEnabled === true ? (
                <button
                  type="button"
                  onClick={() => onDisableAutonomy?.()}
                  disabled={!onDisableAutonomy || mutationPending}
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-red-500 px-4 text-[12.5px] font-semibold text-white shadow-[0_4px_10px_rgba(239,68,68,0.25)] transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                >
                  {t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' })}
                </button>
              ) : (
                <CompactAction
                  type="button"
                  onClick={() => onEnableAutonomy?.()}
                  disabled={!onEnableAutonomy || mutationPending || runtimeInspect.autonomyMode === 'off'}
                  tone="primary"
                >
                  {t('Chat.agentDiagnosticsEnableAutonomy', { defaultValue: 'Enable Autonomy' })}
                </CompactAction>
              )}
              <RuntimeInspectActionButton
                label={t('Chat.agentDiagnosticsRefreshInspect', { defaultValue: 'Refresh inspect' })}
                onClick={() => onRefreshInspect?.()}
                disabled={!onRefreshInspect || runtimeInspectLoading || mutationPending}
              />
            </div>
            {runtimeInspect.pendingHooks.length > 0 ? (
              <div className="space-y-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
                  {t('Chat.agentDiagnosticsPendingHooksLabel', { defaultValue: 'Pending hooks' })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {runtimeInspect.pendingHooks.map((hook) => (
                    hook.hookId ? (
                      <RuntimeInspectActionButton
                        key={hook.hookId}
                        tone="danger"
                        label={`${t('Chat.agentDiagnosticsCancelHook', { defaultValue: 'Cancel' })} ${hook.hookId}`}
                        onClick={() => onCancelHook?.(hook.hookId)}
                        disabled={!onCancelHook || mutationPending}
                      />
                    ) : null
                  ))}
                </div>
              </div>
            ) : null}
            {mutationPendingAction ? (
              <div className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">
                {mutationPendingAction}
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
