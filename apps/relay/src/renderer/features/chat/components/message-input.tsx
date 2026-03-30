// Message input — custom composer using useChatComposer headless hook
// Inspired by desktop TurnInput: bordered container, large textarea, icon toolbar

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatComposer } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { TurnSendPhase } from '../../../app-shell/providers/chat-store.js';

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

interface MessageInputProps {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  toolbar?: ReactNode;
  modelPickerSlot?: ReactNode;
  isSending?: boolean;
  sendPhase?: TurnSendPhase;
  onCancelTurn?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  placeholder,
  toolbar,
  modelPickerSlot,
  isSending,
  sendPhase,
  onCancelTurn,
}: MessageInputProps) {
  const { t } = useTranslation();

  const state = useChatComposer({
    adapter: {
      submit: async ({ text }) => {
        await onSend(text);
      },
    },
    disabled,
  });

  const showPhaseBar = isSending || (sendPhase && sendPhase !== 'idle');
  const canSend = state.canSubmit && !disabled;

  return (
    <section className="relative flex h-full flex-col px-5 pb-4 pt-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void state.handleSubmit();
        }}
        className="relative flex h-full min-h-0 flex-col rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] p-3 transition-colors focus-within:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,var(--nimi-border-subtle))]"
      >
        {/* Textarea — fills available space */}
        <textarea
          ref={state.textareaRef}
          value={state.text}
          onChange={state.handleTextChange}
          onKeyDown={state.handleKeyDown}
          disabled={disabled || state.isSubmitting}
          placeholder={placeholder || t('chat.typeMessage')}
          rows={2}
          className="min-h-0 flex-1 resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-[color:var(--nimi-text-primary)] outline-none placeholder:text-[color:var(--nimi-text-muted)]"
        />

        {/* Toolbar row */}
        <div className="mt-2 flex shrink-0 items-center justify-between">
          {/* Left: voice controls + phase */}
          <div className="flex items-center gap-1">
            {toolbar}
            {showPhaseBar ? (
              <>
                {isSending && onCancelTurn ? (
                  <button
                    type="button"
                    onClick={onCancelTurn}
                    className="rounded-md px-2 py-0.5 text-[11px] text-[color:var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[color:var(--nimi-text-primary)]"
                  >
                    {t('chat.stopGenerating')}
                  </button>
                ) : null}
                {sendPhase && sendPhase !== 'idle' ? (
                  <span className="text-[10px] text-[color:var(--nimi-text-muted)]">
                    {sendPhase.replace(/-/g, ' ')}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Right: model picker + send button */}
          <div className="flex items-center gap-2">
            {modelPickerSlot}
            <button
              type="submit"
              disabled={!canSend}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm transition-all ${
                canSend
                  ? 'bg-[var(--nimi-action-primary-bg)] hover:brightness-110 active:scale-95'
                  : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,var(--nimi-surface-card))] cursor-not-allowed'
              }`}
              aria-label={t('chat.send', { defaultValue: 'Send' })}
            >
              {SEND_ICON}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
