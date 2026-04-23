// Retained for spec surface `chat.utility.rail_controls`
// (.nimi/spec/desktop/kernel/tables/renderer-design-surfaces.yaml, D-SHELL-030).
// No runtime consumer today; chat modes use `chat-shared-side-sheet.tsx` instead.
import type { ReactNode } from 'react';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ChatRightColumn, ChatRightColumnCard, ChatRightColumnCardTitle } from './chat-shared-right-column-primitives';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

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
          <DesktopIconToggleAction
            icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
            )}
            active={handsFreeActive}
            disabled={handsFreeDisabled}
            onClick={handsFreeActive ? handsFreeState.onExit : handsFreeState.onEnter}
            aria-label={t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
            title={handsFreeActive
              ? t('Chat.voiceSessionHandsFreeExit', { defaultValue: 'Exit hands-free' })
              : t('Chat.voiceSessionHandsFreeEnter', { defaultValue: 'Enter hands-free' })}
          />
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
          <DesktopIconToggleAction
            icon={(
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 13.5V12a3.5 3.5 0 0 1-1.73-6.55A4 4 0 0 1 11.5 4a3.5 3.5 0 0 1 .77 6.91V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
            </svg>
            )}
            active={thinkingState === 'on'}
            disabled={thinkingState === 'unsupported'}
            aria-label={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
            title={t('Chat.toggleThinking', { defaultValue: 'Toggle thinking' })}
            onClick={thinkingState !== 'unsupported' ? onThinkingToggle : undefined}
          />
        </Tooltip>
      ) : null}
      <div className="flex-1" />
      <DesktopIconToggleAction
        icon={(
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        )}
        data-testid={E2E_IDS.chatSettingsToggle}
        active={settingsActive}
        aria-label={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
        title={t('Chat.settingsTitle', { defaultValue: 'Settings' })}
        onClick={onToggleSettings}
      />
      {onToggleFold ? (
        <Tooltip content={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })} placement="top">
          <DesktopIconToggleAction
            icon={(
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
            )}
            aria-label={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
            title={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
            onClick={onToggleFold}
          />
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
    <DesktopIconToggleAction
      icon={props.children}
      active={props.active}
      disabled={props.disabled}
      onClick={props.disabled ? undefined : props.onClick}
      aria-label={props.ariaLabel}
      title={props.title}
      className="h-10 w-10 rounded-xl"
    />
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
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || NO_BIO_FALLBACK;
  const handsFreeActive = props.handsFreeState?.mode === 'hands-free';
  const handsFreeListening = handsFreeActive && props.handsFreeState?.status === 'listening';
  const presenceLabel = props.characterData?.interactionState?.label
    || (handsFreeActive ? 'Hands-free ready' : 'Here with you');
  const phase = props.characterData?.interactionState?.phase;
  const presenceBusy = phase === 'thinking' || phase === 'speaking' || handsFreeListening;

  return (
    <ChatRightColumn data-chat-mode-column="human">
      <ChatRightColumnCard cardKey="primary" className="flex min-h-0 flex-1 flex-col justify-center px-5 py-5">
        <div className="space-y-3 text-center">
          <p className="text-[1.8rem] font-black leading-tight tracking-tight text-slate-950">
            {props.characterData?.name || props.selectedTarget.title}
          </p>
          {props.characterData?.handle || props.selectedTarget.handle ? (
            <p className="text-xs font-medium text-slate-500">
              {props.characterData?.handle || props.selectedTarget.handle}
            </p>
          ) : null}
          <p className="text-sm leading-7 text-slate-500">
            {supportingCopy}
          </p>
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,white)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_94%,white)] px-3 py-1.5 text-[11px] font-semibold text-[var(--nimi-text-primary)] shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
              <span className={`inline-block h-2.5 w-2.5 rounded-full bg-[var(--nimi-action-primary-bg)] ${presenceBusy ? 'animate-pulse' : ''}`} />
              <span>{presenceLabel}</span>
            </span>
          </div>
        </div>
      </ChatRightColumnCard>

      <ChatRightColumnCard cardKey="status" className="px-4 py-4">
        <ChatRightColumnCardTitle
          title={t('Chat.presenceCardTitle', { defaultValue: 'Presence' })}
          subtitle={t('Chat.agentPresenceCardSubtitle', {
            defaultValue: 'Status and conversation controls for this agent on this device.',
          })}
        />
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
