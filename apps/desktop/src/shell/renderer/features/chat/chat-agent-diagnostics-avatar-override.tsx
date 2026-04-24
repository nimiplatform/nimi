import { useState, type ReactNode } from 'react';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import {
  applyChatAgentAvatarDebugOverride,
  CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS,
  CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS,
  clearChatAgentAvatarDebugOverride,
  readChatAgentAvatarDebugOverride,
  resolveChatAgentAvatarDebugFormState,
  type ChatAgentAvatarDebugEmotionOption,
  type ChatAgentAvatarDebugPhaseOption,
} from './chat-agent-avatar-debug-override';
import type { DiagnosticsTranslate } from './chat-agent-diagnostics-view-model';

const DIAGNOSTIC_INPUT_CLASS_NAME = 'mt-1.5 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] outline-none transition focus:border-[color:var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] disabled:cursor-not-allowed disabled:opacity-50';

function SectionCard(props: {
  title: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <DesktopCardSurface kind="operational-solid" as="div" className="space-y-3 px-3.5 py-3">
      <div className="space-y-1">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
          {props.title}
        </h4>
        <p className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">{props.hint}</p>
      </div>
      {props.children}
    </DesktopCardSurface>
  );
}

function FieldLabel(props: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-text-muted)]">
      {props.label}
      {props.children}
    </label>
  );
}

function ActionButton(props: {
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

export function AgentDiagnosticsAvatarOverrideCard(props: {
  t: DiagnosticsTranslate;
  disabled: boolean;
}) {
  const [form, setForm] = useState(() => resolveChatAgentAvatarDebugFormState(readChatAgentAvatarDebugOverride()));
  const setPhase = (phase: ChatAgentAvatarDebugPhaseOption) => setForm((current) => ({ ...current, phase }));
  const setEmotion = (emotion: ChatAgentAvatarDebugEmotionOption) => setForm((current) => ({ ...current, emotion }));
  const setLabel = (label: string) => setForm((current) => ({ ...current, label }));
  const setAmplitude = (amplitude: string) => setForm((current) => ({ ...current, amplitude }));
  const applyOverride = () => {
    const amplitude = Number(form.amplitude);
    applyChatAgentAvatarDebugOverride({
      phase: form.phase,
      emotion: form.emotion,
      label: form.label,
      amplitude: Number.isFinite(amplitude) ? amplitude : undefined,
    });
  };
  const clearOverride = () => {
    clearChatAgentAvatarDebugOverride();
    setForm(resolveChatAgentAvatarDebugFormState(null));
  };

  return (
    <SectionCard
      title={props.t('Chat.agentDiagnosticsAvatarOverrideTitle', { defaultValue: 'Avatar Override' })}
      hint={props.t('Chat.agentDiagnosticsAvatarOverrideDetail', {
        defaultValue: 'Debug-only override for avatar phase and mood. Does not mutate RuntimeAgent status.',
      })}
    >
      <div className="grid grid-cols-2 gap-2">
        <FieldLabel label={props.t('Chat.agentDiagnosticsAvatarOverridePhaseLabel', { defaultValue: 'Phase' })}>
          <select
            value={form.phase}
            onChange={(event) => setPhase(event.target.value as ChatAgentAvatarDebugPhaseOption)}
            disabled={props.disabled}
            className={DIAGNOSTIC_INPUT_CLASS_NAME}
          >
            {CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label={props.t('Chat.agentDiagnosticsAvatarOverrideEmotionLabel', { defaultValue: 'Mood' })}>
          <select
            value={form.emotion}
            onChange={(event) => setEmotion(event.target.value as ChatAgentAvatarDebugEmotionOption)}
            disabled={props.disabled}
            className={DIAGNOSTIC_INPUT_CLASS_NAME}
          >
            {CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label={props.t('Chat.agentDiagnosticsAvatarOverrideLabelLabel', { defaultValue: 'Label' })}>
          <input
            type="text"
            value={form.label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={props.disabled}
            className={DIAGNOSTIC_INPUT_CLASS_NAME}
          />
        </FieldLabel>
        <FieldLabel label={props.t('Chat.agentDiagnosticsAvatarOverrideAmplitudeLabel', { defaultValue: 'Amplitude' })}>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={form.amplitude}
            onChange={(event) => setAmplitude(event.target.value)}
            disabled={props.disabled}
            className={DIAGNOSTIC_INPUT_CLASS_NAME}
          />
        </FieldLabel>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <ActionButton
          tone="primary"
          label={props.t('Chat.agentDiagnosticsApplyAvatarOverride', { defaultValue: 'Apply avatar override' })}
          onClick={applyOverride}
          disabled={props.disabled}
        />
        <ActionButton
          label={props.t('Chat.agentDiagnosticsClearAvatarOverride', { defaultValue: 'Clear avatar override' })}
          onClick={clearOverride}
          disabled={props.disabled}
        />
      </div>
    </SectionCard>
  );
}
