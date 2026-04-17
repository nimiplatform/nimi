import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { ModWorkspaceTabs } from '@renderer/features/mod-workspace/mod-workspace-tabs';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  SHELL_CHROME_ACTION_CELL_CLASS,
} from './shell-chrome-classes';

type MainLayoutTopBarProps = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  enableModWorkspaceTabs: boolean;
  titlebarLeftInsetClass: string;
  sparkBalance: number;
  gemBalance: number;
  balancesPending: boolean;
  unreadCount: number;
  avatarNode: ReactNode;
  settingsMenuOpen: boolean;
  settingsTriggerRef: RefObject<HTMLDivElement | null>;
  onOpenWallet: () => void;
  onOpenNotifications: () => void;
  onToggleSettingsMenu: () => void;
  activeTab: string;
  onLogin: () => void;
  onOpenChat: () => void;
  onOpenRuntimeConfig: () => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

function formatMetricValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function MainLayoutTopBar(props: MainLayoutTopBarProps) {
  const { t } = useTranslation();
  const anonymousMode = props.authStatus !== 'authenticated';
  const unreadBadge = props.unreadCount > 99 ? '99+' : String(props.unreadCount);

  return (
    <div
      className={`absolute inset-x-0 top-0 z-[11000] flex h-14 items-center bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_12%,transparent)] px-3 backdrop-blur-md ${props.titlebarLeftInsetClass}`}
      onMouseDown={props.onMouseDown}
    >
      <div className="flex h-full w-full items-center border-b border-transparent px-1">
        {props.enableModWorkspaceTabs ? (
          <div data-mod-tab-interactive="true" className="h-full w-fit max-w-[52vw]">
            <ModWorkspaceTabs placement="titlebar" />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {anonymousMode ? (
            <div className="flex items-center gap-2">
              {props.activeTab !== 'chat' ? (
                <Tooltip content={t('Navigation.chat', { defaultValue: 'Chat' })} className="h-10">
                  <button
                  type="button"
                  data-mod-tab-interactive="true"
                  onClick={props.onOpenChat}
                  className={SHELL_CHROME_ACTION_CELL_CLASS}
                  aria-label={t('Navigation.chat', { defaultValue: 'Chat' })}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                </Tooltip>
              ) : null}
              {props.activeTab !== 'runtime' ? (
                <Tooltip content={t('Navigation.runtime', { defaultValue: 'Runtime' })} className="h-10">
                  <button
                  type="button"
                  data-mod-tab-interactive="true"
                  onClick={props.onOpenRuntimeConfig}
                  className={SHELL_CHROME_ACTION_CELL_CLASS}
                  aria-label={t('Navigation.runtime', { defaultValue: 'Runtime' })}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                      <line x1="6" y1="6" x2="6.01" y2="6" />
                      <line x1="6" y1="18" x2="6.01" y2="18" />
                    </svg>
                  </button>
                </Tooltip>
              ) : null}
              <Tooltip content={t('Auth.login', { defaultValue: 'Login' })} className="h-10">
                <button
                  type="button"
                  data-testid={E2E_IDS.topbarLoginButton}
                  data-mod-tab-interactive="true"
                  onClick={props.onLogin}
                  className={`${SHELL_CHROME_ACTION_CELL_CLASS} px-3`}
                  aria-label={t('Auth.login', { defaultValue: 'Login' })}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          ) : (
            <>
              <div className="flex h-9 items-center gap-1 rounded-full bg-white/40 px-1 backdrop-blur-sm">
                <Tooltip content="Spark" className="h-9">
                  <button
                    type="button"
                    data-mod-tab-interactive="true"
                    onClick={props.onOpenWallet}
                    className="flex h-7 items-center justify-center gap-1.5 rounded-full bg-transparent px-2.5 text-xs font-semibold text-[var(--nimi-text-primary)] transition hover:bg-white/40"
                    aria-label={t('Common.openWalletSpark')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="url(#sparkGradient)" className="drop-shadow-sm">
                      <defs>
                        <linearGradient id="sparkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#fbbf24" />
                          <stop offset="50%" stopColor="#f59e0b" />
                          <stop offset="100%" stopColor="#d97706" />
                        </linearGradient>
                      </defs>
                      <path d="M13 2L3 14h9l-1 8 10-12h-7z" />
                    </svg>
                    <span>{props.balancesPending ? '--' : formatMetricValue(props.sparkBalance)}</span>
                  </button>
                </Tooltip>
                <Tooltip content="Gem" className="h-9">
                  <button
                    type="button"
                    data-mod-tab-interactive="true"
                    onClick={props.onOpenWallet}
                    className="flex h-7 items-center justify-center gap-1.5 rounded-full bg-transparent px-2.5 text-xs font-semibold text-[var(--nimi-text-primary)] transition hover:bg-white/40"
                    aria-label={t('Common.openWalletGem')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="url(#gemGradient)" className="drop-shadow-sm">
                      <defs>
                        <linearGradient id="gemGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#a78bfa" />
                          <stop offset="50%" stopColor="#8b5cf6" />
                          <stop offset="100%" stopColor="#7c3aed" />
                        </linearGradient>
                      </defs>
                      <path d="M6 3h12l4 6-10 13L2 9z" />
                    </svg>
                    <span>{props.balancesPending ? '--' : formatMetricValue(props.gemBalance)}</span>
                  </button>
                </Tooltip>
              </div>
              <Tooltip content={t('Navigation.notifications')} className="h-10">
                <button
                  type="button"
                  data-mod-tab-interactive="true"
                  onClick={props.onOpenNotifications}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--nimi-text-primary)] transition hover:bg-white/40"
                  aria-label={t('Common.openNotifications')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {props.unreadCount > 0 ? (
                    <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-[16px] text-white">
                      {unreadBadge}
                    </span>
                  ) : null}
                </button>
              </Tooltip>
              <Tooltip content={t('Common.openAccountMenu')} placement="top" className="h-10">
                <div ref={props.settingsTriggerRef} className="mr-2 flex h-10 items-center">
                  <button
                    type="button"
                    data-mod-tab-interactive="true"
                    onClick={props.onToggleSettingsMenu}
                    className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-transparent p-0 text-[var(--nimi-text-primary)] transition-transform duration-150 hover:scale-[1.03]"
                    aria-label={t('Common.openAccountMenu')}
                    aria-expanded={props.settingsMenuOpen}
                  >
                    {props.avatarNode}
                  </button>
                </div>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
