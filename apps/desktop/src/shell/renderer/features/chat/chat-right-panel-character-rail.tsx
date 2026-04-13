import type { ReactNode } from 'react';
import { cn, Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

const NO_BIO_FALLBACK = 'This Agent has no public bio.';

// ---------------------------------------------------------------------------
// Right-panel header with settings toggle
// ---------------------------------------------------------------------------

function RightPanelHeader({ onToggleSettings, settingsActive, thinkingState, onThinkingToggle, onToggleFold, handsFreeState }: {
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  handsFreeState?: ChatRightPanelHandsFreeState;
}) {
  const { t } = useTranslation();
  const handsFreeActive = handsFreeState?.mode === 'hands-free';
  const handsFreeDisabled = handsFreeState ? (!handsFreeActive && handsFreeState.disabled) : false;
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-slate-200/60 px-3 py-2">
      {handsFreeState ? (
        <Tooltip
          content={handsFreeActive
            ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
            : t('Chat.voiceSessionHandsFreeHint', { defaultValue: 'Foreground hands-free stays inside this thread only.' })}
          placement="top"
        >
          <button
            type="button"
            disabled={handsFreeDisabled}
            onClick={handsFreeActive ? handsFreeState.onExit : handsFreeState.onEnter}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              'transition-all duration-150',
              handsFreeActive
                ? 'border border-emerald-400 bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.2)]'
                : 'border border-slate-200/80 bg-white/90 text-slate-500',
              handsFreeDisabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:border-emerald-300 hover:text-teal-700',
              handsFreeActive
                ? 'hover:bg-emerald-600 hover:text-white hover:border-emerald-500'
                : '',
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
      {thinkingState ? (
        <Tooltip
          content={thinkingState === 'on'
            ? t('Chat.thinkingTooltipOn', { defaultValue: 'Thinking enabled — click to disable' })
            : thinkingState === 'unsupported'
              ? t('Chat.thinkingTooltipUnsupported', { defaultValue: 'Thinking is not supported by the current route' })
              : t('Chat.thinkingTooltipOff', { defaultValue: 'Thinking disabled — click to enable' })}
          placement="top"
        >
          <button
            type="button"
            disabled={thinkingState === 'unsupported'}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              'transition-all duration-150',
              thinkingState === 'on'
                ? 'border border-emerald-400 bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.2)]'
                : 'border border-slate-200/80 bg-white/90 text-slate-500',
              thinkingState === 'unsupported'
                ? 'cursor-not-allowed opacity-50'
                : 'hover:border-emerald-300 hover:text-teal-700',
              thinkingState === 'on'
                ? 'hover:bg-emerald-600 hover:text-white hover:border-emerald-500'
                : '',
            )}
            aria-label={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
            onClick={thinkingState !== 'unsupported' ? onThinkingToggle : undefined}
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
        data-testid={E2E_IDS.chatSettingsToggle}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          'border border-slate-200/80 bg-white/90 text-slate-500 transition-all duration-150',
          'hover:border-emerald-300 hover:text-teal-700',
          settingsActive && 'border-emerald-300 text-teal-700',
        )}
        aria-label={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
        title={t('Chat.settingsTitle', { defaultValue: 'Settings' })}
        onClick={onToggleSettings}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {onToggleFold ? (
        <Tooltip content={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })} placement="top">
          <button
            type="button"
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              'border border-slate-200/80 bg-white/90 text-slate-500 transition-all duration-150',
              'hover:border-emerald-300 hover:text-teal-700',
            )}
            aria-label={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
            onClick={onToggleFold}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export { RightPanelHeader };

// ---------------------------------------------------------------------------
// Compact CharacterRail for the right panel (~300px)
// ---------------------------------------------------------------------------

export type ChatRightPanelHandsFreeState = {
  mode: 'push-to-talk' | 'hands-free';
  status: 'idle' | 'listening' | 'transcribing' | 'failed';
  disabled: boolean;
  onEnter: () => void;
  onExit: () => void;
};

export type ChatRightPanelCharacterRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  handsFreeState?: ChatRightPanelHandsFreeState;
  children?: ReactNode;
};

export function ChatRightPanelCharacterRail(props: ChatRightPanelCharacterRailProps) {
  const theme = props.characterData?.theme;
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || NO_BIO_FALLBACK;
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeListening = handsFreeActive && props.handsFreeState?.status === 'listening';
  const rippleColor = theme?.accentSoft || 'rgba(16,185,129,0.35)';

  return (
    <aside
      className="relative flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l border-slate-200/60 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="character-rail"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-40px] top-[-32px] h-32 w-32 rounded-full bg-mint-100/50 blur-3xl" />
        <div className="absolute bottom-12 right-[-36px] h-36 w-36 rounded-full bg-sky-100/50 blur-3xl" />
      </div>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
          {/* Compact avatar */}
          <div className="flex min-h-0 flex-1 items-center justify-center pb-4">
            <div className="relative">
              <span
                className="absolute inset-[-16px] rounded-full opacity-60 blur-3xl"
                style={{ background: theme?.accentSoft || 'rgba(167, 243, 208, 0.55)' }}
              />
              {/* Hands-free ripple rings */}
              {handsFreeActive ? (
                <>
                  <span
                    className="hf-ripple-ring pointer-events-none absolute inset-[-8px] rounded-full border-2"
                    style={{
                      borderColor: rippleColor,
                      animation: handsFreeListening
                        ? 'hf-ripple 2.4s cubic-bezier(0.22,1,0.36,1) infinite'
                        : 'hf-ripple-glow 3s ease-in-out infinite',
                    }}
                  />
                  <span
                    className="hf-ripple-ring pointer-events-none absolute inset-[-8px] rounded-full border-2"
                    style={{
                      borderColor: rippleColor,
                      animation: handsFreeListening
                        ? 'hf-ripple 2.4s cubic-bezier(0.22,1,0.36,1) 0.8s infinite'
                        : 'hf-ripple-glow 3s ease-in-out 1s infinite',
                    }}
                  />
                  <span
                    className="hf-ripple-ring pointer-events-none absolute inset-[-8px] rounded-full border-2"
                    style={{
                      borderColor: rippleColor,
                      animation: handsFreeListening
                        ? 'hf-ripple 2.4s cubic-bezier(0.22,1,0.36,1) 1.6s infinite'
                        : 'hf-ripple-glow 3s ease-in-out 2s infinite',
                    }}
                  />
                  {/* Soft ambient glow behind avatar when hands-free */}
                  <span
                    className="hf-ripple-glow pointer-events-none absolute inset-[-12px] rounded-full"
                    style={{
                      background: `radial-gradient(circle, ${rippleColor}, transparent 70%)`,
                      animation: 'hf-ripple-glow 3s ease-in-out infinite',
                    }}
                  />
                </>
              ) : null}
              <span
                className="absolute inset-[-8px] rounded-full border border-white/75"
                style={{ boxShadow: `0 16px 40px ${theme?.accentSoft || 'rgba(16,185,129,0.18)'}` }}
              />
              <span className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border border-white/90 bg-white/82 shadow-[0_16px_40px_rgba(15,23,42,0.12)]">
                {props.characterData?.avatarUrl ? (
                  <img src={props.characterData.avatarUrl} alt={props.characterData.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-4xl font-black text-slate-900">
                    {props.characterData?.avatarFallback || props.selectedTarget.avatarFallback || props.selectedTarget.title.charAt(0) || '?'}
                  </span>
                )}
              </span>
            </div>
          </div>
          {/* Character info */}
          <div className="shrink-0 space-y-3 text-center">
            <p className="text-2xl font-black leading-tight tracking-tight text-slate-950">
              {props.characterData?.name || props.selectedTarget.title}
            </p>
            {props.characterData?.handle || props.selectedTarget.handle ? (
              <p className="text-xs font-medium text-slate-500">
                {props.characterData?.handle || props.selectedTarget.handle}
              </p>
            ) : null}
            <p className="line-clamp-3 text-xs leading-5 text-slate-500">
              {supportingCopy}
            </p>
          </div>
          {/* Extra slot for mode-specific content */}
          {props.children}
        </div>
        <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive={props.settingsActive} thinkingState={props.thinkingState} onThinkingToggle={props.onThinkingToggle} onToggleFold={props.onToggleFold} handsFreeState={props.handsFreeState} />
      </div>
    </aside>
  );
}
