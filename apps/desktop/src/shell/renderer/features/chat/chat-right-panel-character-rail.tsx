import type { ReactNode } from 'react';
import { cn, Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  AvatarStage,
  createAvatarStageSnapshot,
  resolveAvatarPresentationProfile,
  resolveSpriteAvatarImageUrl,
} from '@nimiplatform/nimi-kit/features/avatar';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { DESKTOP_AGENT_AVATAR_RENDERERS } from './chat-agent-avatar-renderers';
import { ChatRightColumn, ChatRightColumnCard, ChatRightColumnCardTitle } from './chat-right-column-primitives';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

const NO_BIO_FALLBACK = 'This Agent has no public bio.';
const UTILITY_RAIL_BUTTON_BASE_CLASS =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border transition-all duration-150 shadow-[0_8px_18px_rgba(15,23,42,0.08)]';

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

function UtilityIconButton(props: {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.disabled ? undefined : props.onClick}
      className={cn(
        UTILITY_RAIL_BUTTON_BASE_CLASS,
        props.active
          ? 'border-emerald-400 bg-emerald-500 text-white'
          : 'border-slate-200/80 bg-white/92 text-slate-500',
        props.disabled
          ? 'cursor-not-allowed opacity-50'
          : props.active
            ? 'hover:border-emerald-500 hover:bg-emerald-600 hover:text-white'
            : 'hover:border-emerald-300 hover:text-teal-700',
      )}
      aria-label={props.ariaLabel}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

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
  settingsContent?: ReactNode;
  children?: ReactNode;
};

export type ChatRightPanelUtilityRailProps = {
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  handsFreeState?: ChatRightPanelHandsFreeState;
};

export function ChatRightPanelUtilityRail(props: ChatRightPanelUtilityRailProps) {
  const { t } = useTranslation();
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeDisabled = props.handsFreeState ? (!handsFreeActive && props.handsFreeState.disabled) : false;

  return (
    <aside
      className="relative flex w-[72px] shrink-0 flex-col"
      data-right-panel="agent-utility-rail"
      data-utility-rail-chrome="transparent"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-end gap-2 px-3 py-4">
        {props.handsFreeState ? (
          <Tooltip
            content={handsFreeActive
              ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
              : t('Chat.voiceSessionHandsFreeHint', { defaultValue: 'Foreground hands-free stays inside this thread only.' })}
            placement="top"
          >
            <span>
              <UtilityIconButton
                active={handsFreeActive}
                ariaLabel={t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
                disabled={handsFreeDisabled}
                onClick={handsFreeActive ? props.handsFreeState.onExit : props.handsFreeState.onEnter}
                title={handsFreeActive
                  ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
                  : t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                </svg>
              </UtilityIconButton>
            </span>
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
            <span>
              <UtilityIconButton
                active={props.thinkingState === 'on'}
                ariaLabel={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
                disabled={props.thinkingState === 'unsupported'}
                onClick={props.thinkingState !== 'unsupported' ? props.onThinkingToggle : undefined}
                title={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                  <path d="M5.5 13.5V12a3.5 3.5 0 0 1-1.73-6.55A4 4 0 0 1 11.5 4a3.5 3.5 0 0 1 .77 6.91V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
                </svg>
              </UtilityIconButton>
            </span>
          </Tooltip>
        ) : null}
        <Tooltip content={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })} placement="top">
          <span>
            <UtilityIconButton
              active={props.settingsActive}
              ariaLabel={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
              onClick={props.onToggleSettings}
              title={t('Chat.settingsTitle', { defaultValue: 'Settings' })}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </UtilityIconButton>
          </span>
        </Tooltip>
        {props.onToggleFold ? (
          <Tooltip content={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })} placement="top">
            <span>
              <UtilityIconButton
                ariaLabel={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
                onClick={props.onToggleFold}
                title={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </UtilityIconButton>
            </span>
          </Tooltip>
        ) : null}
      </div>
    </aside>
  );
}

export function ChatRightPanelCharacterRail(props: ChatRightPanelCharacterRailProps) {
  const { t } = useTranslation();
  const theme = props.characterData?.theme;
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || NO_BIO_FALLBACK;
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeListening = handsFreeActive && props.handsFreeState?.status === 'listening';
  const rippleColor = theme?.accentSoft || 'rgba(16,185,129,0.35)';
  const avatarPresentationProfile = resolveAvatarPresentationProfile({
    presentation: props.characterData?.avatarPresentationProfile,
    fallbackAssetRef: props.characterData?.avatarUrl || null,
    fallbackProfileRef: 'fallback://agent-right-panel',
  });
  const avatarImageUrl = resolveSpriteAvatarImageUrl(
    avatarPresentationProfile,
    props.characterData?.avatarUrl || null,
  );
  const avatarSnapshot = createAvatarStageSnapshot(
    avatarPresentationProfile,
    {
      phase: props.characterData?.interactionState?.phase === 'loading'
        ? 'transitioning'
        : props.characterData?.interactionState?.phase === 'thinking'
          ? 'thinking'
          : props.characterData?.interactionState?.phase === 'listening'
            ? 'listening'
            : props.characterData?.interactionState?.phase === 'speaking'
              ? 'speaking'
              : handsFreeListening
                ? 'listening'
                : 'idle',
      emotion: props.characterData?.interactionState?.emotion || (handsFreeActive ? 'calm' : undefined),
      actionCue: props.characterData?.interactionState?.label
        || (handsFreeActive ? 'Hands-free ready' : 'Here with you'),
      amplitude: typeof props.characterData?.interactionState?.amplitude === 'number'
        ? props.characterData.interactionState.amplitude
        : handsFreeListening
          ? 0.6
          : handsFreeActive
            ? 0.18
            : 0.08,
      visemeId: props.characterData?.interactionState?.visemeId || undefined,
    },
  );
  const presenceLabel = props.characterData?.interactionState?.label
    || (handsFreeActive ? 'Hands-free ready' : 'Here with you');
  const phase = props.characterData?.interactionState?.phase;
  const presenceBusy = phase === 'thinking' || phase === 'speaking' || handsFreeListening;

  return (
    <ChatRightColumn data-chat-mode-column="human">
      <ChatRightColumnCard cardKey="primary" className="flex min-h-0 flex-1 flex-col justify-center px-5 py-5">
        <div className="space-y-5 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <span
                className="absolute inset-[-16px] rounded-full opacity-60 blur-3xl"
                style={{ background: theme?.accentSoft || 'rgba(167, 243, 208, 0.55)' }}
              />
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
              <AvatarStage
                snapshot={avatarSnapshot}
                label={props.characterData?.name || props.selectedTarget.title}
                imageUrl={avatarImageUrl}
                fallbackLabel={props.characterData?.avatarFallback || props.selectedTarget.avatarFallback || props.selectedTarget.title}
                showStatusBadge={false}
                size="lg"
                renderers={DESKTOP_AGENT_AVATAR_RENDERERS}
                className="relative"
              />
            </div>
            <div className="space-y-2">
              <p className="text-[1.8rem] font-black leading-tight tracking-tight text-slate-950">
                {props.characterData?.name || props.selectedTarget.title}
              </p>
              {props.characterData?.handle || props.selectedTarget.handle ? (
                <p className="text-xs font-medium text-slate-500">
                  {props.characterData?.handle || props.selectedTarget.handle}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </ChatRightColumnCard>

      <ChatRightColumnCard cardKey="status" className="px-4 py-4">
        <ChatRightColumnCardTitle
          title={t('Chat.presenceCardTitle', { defaultValue: 'Presence' })}
          subtitle={supportingCopy}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/60 bg-white/86 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/90', presenceBusy ? 'animate-pulse' : '')} />
            <span>{presenceLabel}</span>
          </span>
        </div>
        {props.children ? <div className="mt-4">{props.children}</div> : null}
      </ChatRightColumnCard>

      <ChatRightPanelSettings
        onToggleSettings={props.onToggleSettings}
        thinkingState={props.thinkingState}
        onThinkingToggle={props.onThinkingToggle}
        onToggleFold={props.onToggleFold}
        handsFreeState={props.handsFreeState}
        expanded={props.settingsActive}
        collapsedSummary={t('Chat.humanSettingsCollapsedSummary', {
          defaultValue: 'Profile, diagnostics, and conversation controls stay docked here.',
        })}
      >
        {props.settingsContent ?? null}
      </ChatRightPanelSettings>
    </ChatRightColumn>
  );
}
