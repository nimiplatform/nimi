import { useMemo, useState, type ReactNode } from 'react';
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

/** Local ghost-red action — same visual contract as the one in chat-agent-diagnostics.tsx
 *  but kept inline here so this file stays self-contained for the bodyOnly export path. */
function DangerGhostButton(props: {
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

export function AgentDiagnosticsAvatarOverrideCard(props: {
  t: DiagnosticsTranslate;
  disabled: boolean;
  bodyOnly?: boolean;
}) {
  const [form, setForm] = useState(() => resolveChatAgentAvatarDebugFormState(readChatAgentAvatarDebugOverride()));
  // Snapshot of the last-applied (or read-on-mount) state so we can compute dirty without
  // re-reading from storage every render.
  const [appliedSnapshot, setAppliedSnapshot] = useState(form);
  const setPhase = (phase: ChatAgentAvatarDebugPhaseOption) => setForm((current) => ({ ...current, phase }));
  const setEmotion = (emotion: ChatAgentAvatarDebugEmotionOption) => setForm((current) => ({ ...current, emotion }));
  const setLabel = (label: string) => setForm((current) => ({ ...current, label }));
  const setAmplitude = (amplitude: string) => setForm((current) => ({ ...current, amplitude }));
  const overrideDirty = useMemo(
    () => form.phase !== appliedSnapshot.phase
      || form.emotion !== appliedSnapshot.emotion
      || form.label !== appliedSnapshot.label
      || form.amplitude !== appliedSnapshot.amplitude,
    [form, appliedSnapshot],
  );
  const applyOverride = () => {
    const amplitude = Number(form.amplitude);
    applyChatAgentAvatarDebugOverride({
      phase: form.phase,
      emotion: form.emotion,
      label: form.label,
      amplitude: Number.isFinite(amplitude) ? amplitude : undefined,
    });
    setAppliedSnapshot(form);
  };
  const clearOverride = () => {
    clearChatAgentAvatarDebugOverride();
    const cleared = resolveChatAgentAvatarDebugFormState(null);
    setForm(cleared);
    setAppliedSnapshot(cleared);
  };

  const body = (
    <>
      {props.bodyOnly ? (
        <p className="m-0 text-[11px] leading-[1.5] text-slate-500">
          {props.t('Chat.agentDiagnosticsAvatarOverrideDetail', {
            defaultValue: 'Debug-only override for avatar phase and mood. Does not mutate RuntimeAgent status.',
          })}
        </p>
      ) : null}
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
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <ActionButton
          tone="primary"
          label={props.t('Chat.agentDiagnosticsApplyAvatarOverride', { defaultValue: 'Apply avatar override' })}
          onClick={applyOverride}
          disabled={props.disabled || !overrideDirty}
        />
        <DangerGhostButton
          label={props.t('Chat.agentDiagnosticsClearAvatarOverride', { defaultValue: 'Clear avatar override' })}
          onClick={clearOverride}
          disabled={props.disabled}
        />
      </div>
    </>
  );

  if (props.bodyOnly) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <SectionCard
      title={props.t('Chat.agentDiagnosticsAvatarOverrideTitle', { defaultValue: 'Avatar Override' })}
      hint={props.t('Chat.agentDiagnosticsAvatarOverrideDetail', {
        defaultValue: 'Debug-only override for avatar phase and mood. Does not mutate RuntimeAgent status.',
      })}
    >
      {body}
    </SectionCard>
  );
}
