import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@renderer/components/tooltip.js';
import { ModWorkspaceTabs } from '@renderer/features/mod-workspace/mod-workspace-tabs';

type MainLayoutTopBarProps = {
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
  const unreadBadge = props.unreadCount > 99 ? '99+' : String(props.unreadCount);
  const metricCellClass =
    'flex h-full min-w-[58px] items-center justify-center gap-1.5 px-2 text-xs font-semibold text-white transition hover:bg-[#3DB893]';
  const actionCellClass =
    'relative flex h-full min-w-[42px] items-center justify-center text-white transition hover:bg-[#3DB893]';

  return (
    <div
      className={`relative z-10 flex h-12 shrink-0 items-center bg-[#4ECCA3] pr-0 text-white ${props.titlebarLeftInsetClass}`}
      onMouseDown={props.onMouseDown}
    >
      {props.enableModWorkspaceTabs ? (
        <div data-mod-tab-interactive="true" className="h-full w-fit max-w-[52vw]">
          <ModWorkspaceTabs placement="titlebar" />
        </div>
      ) : null}
      <div className="ml-auto flex h-full items-stretch">
        <Tooltip content="Spark" className="h-full">
          <button
            type="button"
            data-mod-tab-interactive="true"
            onClick={props.onOpenWallet}
            className={metricCellClass}
            aria-label={t('Common.openWalletSpark')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="url(#sparkGradient)" className="drop-shadow-sm">
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
        <Tooltip content="Gem" className="h-full">
          <button
            type="button"
            data-mod-tab-interactive="true"
            onClick={props.onOpenWallet}
            className={metricCellClass}
            aria-label={t('Common.openWalletGem')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="url(#gemGradient)" className="drop-shadow-sm">
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
        <div className="w-2" />
        <Tooltip content={t('Navigation.notifications')} className="h-full">
          <button
            type="button"
            data-mod-tab-interactive="true"
            onClick={props.onOpenNotifications}
            className={actionCellClass}
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
        <Tooltip content={t('Common.openAccountMenu')} placement="top" className="h-full">
          <div ref={props.settingsTriggerRef} className="h-full flex items-center">
            <button
              type="button"
              data-mod-tab-interactive="true"
              onClick={props.onToggleSettingsMenu}
              className={`${actionCellClass} min-w-[48px] overflow-hidden px-2`}
              aria-label={t('Common.openAccountMenu')}
              aria-expanded={props.settingsMenuOpen}
            >
              {props.avatarNode}
            </button>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
