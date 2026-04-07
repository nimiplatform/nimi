import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';

const NO_BIO_FALLBACK = 'This Agent has no public bio.';

// ---------------------------------------------------------------------------
// Right-panel header with settings toggle
// ---------------------------------------------------------------------------

function RightPanelHeader({ onToggleSettings, settingsActive, routeLabel }: { onToggleSettings: () => void; settingsActive: boolean; routeLabel?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-slate-200/60 px-3 py-2">
      {routeLabel ? (
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-400" title={routeLabel}>
          {routeLabel}
        </p>
      ) : (
        <div className="flex-1" />
      )}
      <button
        type="button"
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10.91 3H11a2 2 0 1 1 4 0h.09a1.65 1.65 0 0 0 1.51 1 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

export { RightPanelHeader };

// ---------------------------------------------------------------------------
// Compact CharacterRail for the right panel (~300px)
// ---------------------------------------------------------------------------

export type ChatRightPanelCharacterRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
  children?: ReactNode;
};

export function ChatRightPanelCharacterRail(props: ChatRightPanelCharacterRailProps) {
  const theme = props.characterData?.theme;
  const supportingCopy = String(props.characterData?.bio || props.selectedTarget.bio || '').trim() || NO_BIO_FALLBACK;

  return (
    <aside
      className="relative flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l border-white/70 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
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
        <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive={props.settingsActive} />
      </div>
    </aside>
  );
}
