import type { ReactNode } from 'react';
import { ScrollArea, cn, Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { ChatRightColumnCard } from './chat-right-column-primitives';

// ---------------------------------------------------------------------------
// Unified Settings panel — right panel content when settings is toggled
// ---------------------------------------------------------------------------

export type ChatRightPanelSettingsProps = {
  onToggleSettings: () => void;
  /** The mode-specific settings content (e.g. ChatSettingsPanel instance). */
  children: ReactNode;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: {
    mode: 'push-to-talk' | 'hands-free';
    status: 'idle' | 'listening' | 'transcribing' | 'failed';
    disabled: boolean;
    onEnter: () => void;
    onExit: () => void;
  };
  onToggleFold?: () => void;
  expanded?: boolean;
  collapsedSummary?: ReactNode;
};

export function ChatRightPanelSettings(props: ChatRightPanelSettingsProps) {
  const { t } = useTranslation();
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeDisabled = props.handsFreeState ? (!handsFreeActive && props.handsFreeState.disabled) : false;
  return (
    <ChatRightColumnCard
      cardKey="settings"
      className="flex flex-col"
    >
      {props.expanded ? (
        <ScrollArea className="min-h-0 flex-1 px-3 py-3">
          {props.children}
        </ScrollArea>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        {props.handsFreeState ? (
          <Tooltip
            content={handsFreeActive
              ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
              : t('Chat.voiceSessionHandsFreeHint', { defaultValue: 'Foreground hands-free stays inside this thread only.' })}
            placement="top"
          >
            <button
              type="button"
              disabled={handsFreeDisabled}
              onClick={handsFreeActive ? props.handsFreeState.onExit : props.handsFreeState.onEnter}
              className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                handsFreeActive
                  ? 'border border-emerald-400 bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.2)]'
                  : 'border border-slate-200/80 bg-white/90 text-slate-500',
                handsFreeDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-emerald-300 hover:text-teal-700',
              )}
              aria-label={t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
        {props.thinkingState ? (
          <Tooltip
            content={props.thinkingState === 'on'
              ? t('Chat.thinkingTooltipOn', { defaultValue: 'Thinking enabled — click to disable' })
              : props.thinkingState === 'unsupported'
                ? t('Chat.thinkingTooltipUnsupported', { defaultValue: 'Thinking is not supported by the current route' })
                : t('Chat.thinkingTooltipOff', { defaultValue: 'Thinking disabled — click to enable' })}
            placement="top"
          >
            <button
              type="button"
              disabled={props.thinkingState === 'unsupported'}
              className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                props.thinkingState === 'on'
                  ? 'border border-emerald-400 bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.2)]'
                  : 'border border-slate-200/80 bg-white/90 text-slate-500',
                props.thinkingState === 'unsupported' ? 'cursor-not-allowed opacity-50' : 'hover:border-emerald-300 hover:text-teal-700',
              )}
              aria-label={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
              onClick={props.thinkingState !== 'unsupported' ? props.onThinkingToggle : undefined}
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path d="M5.5 13.5V12a3.5 3.5 0 0 1-1.73-6.55A4 4 0 0 1 11.5 4a3.5 3.5 0 0 1 .77 6.91V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          data-chat-settings-toggle="true"
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-slate-500 transition-all duration-150',
            'hover:border-emerald-300 hover:text-teal-700',
            props.expanded && 'border-emerald-300 text-teal-700',
          )}
          aria-label={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
          title={t('Chat.settingsTitle', { defaultValue: 'Settings' })}
          onClick={props.onToggleSettings}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        {props.onToggleFold ? (
          <Tooltip content={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })} placement="top">
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-slate-500 transition-all duration-150 hover:border-emerald-300 hover:text-teal-700"
              aria-label={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
              onClick={props.onToggleFold}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M15 3v18" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
      </div>
    </ChatRightColumnCard>
  );
}
