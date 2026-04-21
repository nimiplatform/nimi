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
  applyChatAgentAvatarDebugOverride,
  CHAT_AGENT_AVATAR_DEBUG_DEFAULTS,
  CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS,
  CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS,
  CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT,
  clearChatAgentAvatarDebugOverride,
  readChatAgentAvatarDebugOverride,
  resolveChatAgentAvatarDebugFormState,
} from './chat-agent-avatar-debug-override';
import {
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';

const DIAGNOSTIC_INPUT_CLASS_NAME = 'mt-1.5 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';

const AUTONOMY_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

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
  const [avatarOverridePhase, setAvatarOverridePhase] = useState(CHAT_AGENT_AVATAR_DEBUG_DEFAULTS.phase);
  const [avatarOverrideEmotion, setAvatarOverrideEmotion] = useState(CHAT_AGENT_AVATAR_DEBUG_DEFAULTS.emotion);
  const [avatarOverrideLabel, setAvatarOverrideLabel] = useState(CHAT_AGENT_AVATAR_DEBUG_DEFAULTS.label);
  const [avatarOverrideAmplitude, setAvatarOverrideAmplitude] = useState(CHAT_AGENT_AVATAR_DEBUG_DEFAULTS.amplitude);
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
  useEffect(() => {
    const syncFromOverride = () => {
      const formState = resolveChatAgentAvatarDebugFormState(readChatAgentAvatarDebugOverride());
      setAvatarOverridePhase(formState.phase);
      setAvatarOverrideEmotion(formState.emotion);
      setAvatarOverrideLabel(formState.label);
      setAvatarOverrideAmplitude(formState.amplitude);
    };
    syncFromOverride();
    if (typeof window === 'undefined') {
      return undefined;
    }
    window.addEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, syncFromOverride);
    return () => {
      window.removeEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, syncFromOverride);
    };
  }, []);
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
            <div className="flex flex-wrap gap-2 pt-1">
              <RuntimeInspectActionButton
                tone="primary"
                label={t('Chat.agentDiagnosticsApplyRuntimeState', { defaultValue: 'Apply runtime state' })}
                onClick={() => props.onUpdateRuntimeState?.({ statusText, worldId, userId })}
                disabled={!props.onUpdateRuntimeState || mutationPending}
              />
              <RuntimeInspectActionButton
                tone="danger"
                label={t('Chat.agentDiagnosticsClearWorldContext', { defaultValue: 'Clear world context' })}
                onClick={() => props.onClearWorldContext?.()}
                disabled={!props.onClearWorldContext || mutationPending}
              />
              <RuntimeInspectActionButton
                tone="danger"
                label={t('Chat.agentDiagnosticsClearDyadicContext', { defaultValue: 'Clear dyadic context' })}
                onClick={() => props.onClearDyadicContext?.()}
                disabled={!props.onClearDyadicContext || mutationPending}
              />
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
            <div className="flex flex-wrap gap-2 pt-1">
              <RuntimeInspectActionButton
                tone="primary"
                label={t('Chat.agentDiagnosticsApplyAutonomyConfig', { defaultValue: 'Apply autonomy config' })}
                onClick={() => props.onUpdateAutonomyConfig?.({ mode: autonomyMode, dailyTokenBudget, maxTokensPerHook })}
                disabled={!props.onUpdateAutonomyConfig || mutationPending}
              />
              {props.runtimeInspect.autonomyEnabled === true ? (
                <RuntimeInspectActionButton
                  tone="danger"
                  label={t('Chat.disableAgentAutonomyTitle', { defaultValue: 'Disable autonomy' })}
                  onClick={() => props.onDisableAutonomy?.()}
                  disabled={!props.onDisableAutonomy || mutationPending}
                />
              ) : (
                <RuntimeInspectActionButton
                  tone="primary"
                  label={t('Chat.agentDiagnosticsEnableAutonomy', { defaultValue: 'Enable autonomy' })}
                  onClick={() => props.onEnableAutonomy?.()}
                  disabled={
                    !props.onEnableAutonomy
                    || mutationPending
                    || props.runtimeInspect.autonomyMode === 'off'
                  }
                />
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

          {/* Avatar Override (debug) */}
          <DiagnosticsSectionCard
            title={t('Chat.agentDiagnosticsAvatarOverrideTitle', { defaultValue: 'Avatar Override' })}
            hint={t('Chat.agentDiagnosticsAvatarOverrideDetail', {
              defaultValue: 'Debug-only override for avatar phase and mood. Does not mutate RuntimeAgent status.',
            })}
          >
            <div className="grid grid-cols-2 gap-2">
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsAvatarOverridePhaseLabel', { defaultValue: 'Phase' })}>
                <select
                  value={avatarOverridePhase}
                  onChange={(event) => setAvatarOverridePhase(
                    event.target.value as (typeof CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS)[number]['value'],
                  )}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                >
                  {CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </DiagnosticsFieldLabel>
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsAvatarOverrideEmotionLabel', { defaultValue: 'Mood' })}>
                <select
                  value={avatarOverrideEmotion}
                  onChange={(event) => setAvatarOverrideEmotion(
                    event.target.value as (typeof CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS)[number]['value'],
                  )}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                >
                  {CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </DiagnosticsFieldLabel>
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsAvatarOverrideAmplitudeLabel', { defaultValue: 'Amplitude' })}>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={avatarOverrideAmplitude}
                  onChange={(event) => setAvatarOverrideAmplitude(event.target.value)}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </DiagnosticsFieldLabel>
              <DiagnosticsFieldLabel label={t('Chat.agentDiagnosticsAvatarOverrideLabelLabel', { defaultValue: 'Label' })}>
                <input
                  type="text"
                  value={avatarOverrideLabel}
                  onChange={(event) => setAvatarOverrideLabel(event.target.value)}
                  placeholder={t('Chat.agentDiagnosticsAvatarOverrideLabelPlaceholder', { defaultValue: 'Joy test' })}
                  className={DIAGNOSTIC_INPUT_CLASS_NAME}
                />
              </DiagnosticsFieldLabel>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <RuntimeInspectActionButton
                tone="primary"
                label={t('Chat.agentDiagnosticsApplyAvatarOverride', { defaultValue: 'Apply avatar override' })}
                onClick={() => {
                  applyChatAgentAvatarDebugOverride({
                    phase: avatarOverridePhase as (typeof CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS)[number]['value'],
                    emotion: avatarOverrideEmotion as (typeof CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS)[number]['value'],
                    label: avatarOverrideLabel,
                    amplitude: Number(avatarOverrideAmplitude),
                  });
                }}
              />
              <RuntimeInspectActionButton
                tone="danger"
                label={t('Chat.agentDiagnosticsClearAvatarOverride', { defaultValue: 'Clear avatar override' })}
                onClick={() => {
                  clearChatAgentAvatarDebugOverride();
                  setAvatarOverridePhase('idle');
                  setAvatarOverrideEmotion('joy');
                  setAvatarOverrideLabel('');
                  setAvatarOverrideAmplitude('0.34');
                }}
              />
            </div>
          </DiagnosticsSectionCard>
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
