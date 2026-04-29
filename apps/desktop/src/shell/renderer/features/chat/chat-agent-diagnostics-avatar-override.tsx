import { useMemo, useState } from 'react';
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

const PHASE_EMOJI: Record<ChatAgentAvatarDebugPhaseOption, string> = {
  idle: '💤',
  thinking: '💭',
  listening: '👂',
  speaking: '💬',
  loading: '⏳',
};

const EMOTION_EMOJI: Record<ChatAgentAvatarDebugEmotionOption, string> = {
  neutral: '😐',
  joy: '✨',
  focus: '🎯',
  calm: '🌊',
  playful: '🎉',
  concerned: '😟',
  surprised: '😲',
};

const SECTION_LABEL_CLASS =
  'block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500';

const FIELD_INPUT_CLASS =
  'mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] font-medium text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50';

const SELECT_TRIGGER_CLASS = `${FIELD_INPUT_CLASS} appearance-none pr-8 [color-scheme:light]`;

function formatAmplitude(raw: string): string {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return '0.00';
  return parsed.toFixed(2);
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function InfoIcon(props: { title?: string }) {
  return (
    <span
      title={props.title}
      className="inline-flex h-5 w-5 cursor-help items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </span>
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

  const phaseLabel = props.t('Chat.agentDiagnosticsAvatarOverridePhaseLabel', { defaultValue: 'Phase' });
  const moodLabel = props.t('Chat.agentDiagnosticsAvatarOverrideEmotionLabel', { defaultValue: 'Mood' });
  const amplitudeLabel = props.t('Chat.agentDiagnosticsAvatarOverrideAmplitudeLabel', { defaultValue: 'Amplitude' });
  const applyButtonLabel = props.t('Chat.agentDiagnosticsApplyAvatarOverride', { defaultValue: 'Apply Override' });
  const clearButtonLabel = props.t('Chat.agentDiagnosticsClearAvatarOverrideShort', { defaultValue: 'Clear' });

  const amplitudeDisplay = formatAmplitude(form.amplitude);

  const body = (
    <div className="space-y-4">
      {/* Amplitude — uppercase label + readout chip + drag-to-set slider. Replaces the prior
          numeric input, since 0–1 is the natural range and a slider reads at a glance. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={SECTION_LABEL_CLASS}>{amplitudeLabel}</span>
          <span className="text-[13px] font-semibold tabular-nums text-slate-900">{amplitudeDisplay}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={Number.isFinite(Number(form.amplitude)) ? Number(form.amplitude) : 0}
          onChange={(event) => setAmplitude(event.target.value)}
          disabled={props.disabled}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(15,23,42,0.18)] [&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-slate-300"
        />
      </div>

      {/* Phase / Mood — 2-col grid. Native <select> with emoji-prefixed labels reads natively
          on every platform without pulling in a custom dropdown widget. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={SECTION_LABEL_CLASS}>{phaseLabel}</label>
          <div className="relative">
            <select
              value={form.phase}
              onChange={(event) => setPhase(event.target.value as ChatAgentAvatarDebugPhaseOption)}
              disabled={props.disabled}
              className={SELECT_TRIGGER_CLASS}
            >
              {CHAT_AGENT_AVATAR_DEBUG_PHASE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {`${PHASE_EMOJI[option.value]} ${option.label}`}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </div>
        </div>
        <div>
          <label className={SECTION_LABEL_CLASS}>{moodLabel}</label>
          <div className="relative">
            <select
              value={form.emotion}
              onChange={(event) => setEmotion(event.target.value as ChatAgentAvatarDebugEmotionOption)}
              disabled={props.disabled}
              className={SELECT_TRIGGER_CLASS}
            >
              {CHAT_AGENT_AVATAR_DEBUG_EMOTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {`${EMOTION_EMOJI[option.value]} ${option.label}`}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </div>
        </div>
      </div>

      {/* Apply Override (primary, emerald, takes the row) + flat red Clear text. */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={applyOverride}
          disabled={props.disabled || !overrideDirty}
          className="inline-flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-xl bg-emerald-500 px-4 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.28)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          {applyButtonLabel}
        </button>
        <button
          type="button"
          onClick={clearOverride}
          disabled={props.disabled}
          className="inline-flex shrink-0 items-center px-1 text-[13px] font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-red-600"
        >
          {clearButtonLabel}
        </button>
      </div>
    </div>
  );

  if (props.bodyOnly) {
    return body;
  }

  const titleLabel = props.t('Chat.agentDiagnosticsAvatarOverrideTitle', { defaultValue: 'Avatar Override' });
  const hintLabel = props.t('Chat.agentDiagnosticsAvatarOverrideDetail', {
    defaultValue: 'Debug-only override for avatar phase and mood. Does not mutate RuntimeAgent status.',
  });

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <header className="flex items-center justify-between gap-2">
        <h4 className="m-0 text-[14px] font-semibold tracking-tight text-slate-900">{titleLabel}</h4>
        <InfoIcon title={hintLabel} />
      </header>
      {body}
    </section>
  );
}
