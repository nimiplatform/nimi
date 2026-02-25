import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
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
    'flex h-full min-w-[58px] items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[#0b4f43] transition hover:bg-white/16';
  const actionCellClass =
    'relative flex h-full min-w-[42px] items-center justify-center text-[#0b4f43] transition hover:bg-white/16';

  return (
    <div
      className={`flex h-12 shrink-0 items-center bg-[linear-gradient(90deg,rgba(79,201,173,0.64)_0%,rgba(72,195,168,0.62)_50%,rgba(69,188,163,0.6)_100%)] pr-0 text-[#073b33] shadow-[inset_0_1px_0_rgba(255,255,255,0.34)] backdrop-blur-xl backdrop-saturate-150 ${props.titlebarLeftInsetClass}`}
      onMouseDown={props.onMouseDown}
    >
      {props.enableModWorkspaceTabs ? (
        <div data-mod-tab-interactive="true" className="h-full w-fit max-w-[52vw]">
          <ModWorkspaceTabs placement="titlebar" />
        </div>
      ) : null}
      <div className="ml-auto flex h-full items-stretch">
        <button
          type="button"
          data-mod-tab-interactive="true"
          onClick={props.onOpenWallet}
          className={metricCellClass}
          title="Spark"
          aria-label={t('Common.openWalletSpark')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400">
            <path d="M13 2L3 14h9l-1 8 10-12h-7z" />
          </svg>
          <span>{props.balancesPending ? '--' : formatMetricValue(props.sparkBalance)}</span>
        </button>
        <button
          type="button"
          data-mod-tab-interactive="true"
          onClick={props.onOpenWallet}
          className={metricCellClass}
          title="Gem"
          aria-label={t('Common.openWalletGem')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
            <path d="M6 3h12l4 6-10 13L2 9z" />
            <path d="M12 22V9" />
            <path d="M12 9L2 9" />
            <path d="M12 9l10 0" />
            <path d="M6 3l6 6" />
            <path d="M18 3l-6 6" />
          </svg>
          <span>{props.balancesPending ? '--' : formatMetricValue(props.gemBalance)}</span>
        </button>
        <button
          type="button"
          data-mod-tab-interactive="true"
          onClick={props.onOpenNotifications}
          className={actionCellClass}
          title={t('Navigation.notifications')}
          aria-label={t('Common.openNotifications')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
          {props.unreadCount > 0 ? (
            <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-[16px] text-white">
              {unreadBadge}
            </span>
          ) : null}
        </button>
        <div ref={props.settingsTriggerRef} className="h-full">
          <button
            type="button"
            data-mod-tab-interactive="true"
            onClick={props.onToggleSettingsMenu}
            className={`${actionCellClass} min-w-[48px] overflow-hidden px-2`}
            aria-label={t('Common.openAccountMenu')}
            title={t('Common.openAccountMenu')}
            aria-expanded={props.settingsMenuOpen}
          >
            {props.avatarNode}
          </button>
        </div>
      </div>
    </div>
  );
}
