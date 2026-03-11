import type { CSSProperties, ReactNode } from 'react';
import { i18n } from '@renderer/i18n';

type ChromeTabProps = {
  active?: boolean;
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
  inactiveBg?: string;
  inactiveHoverBg?: string;
  activeBg?: string;
  inactiveColor?: string;
  activeColor?: string;
};

type ChromeTabStyle = CSSProperties & {
  '--tab-bg'?: string;
  '--tab-hover-bg'?: string;
  '--tab-active-bg'?: string;
  '--tab-color'?: string;
  '--tab-active-color'?: string;
};

export function ChromeTab(props: ChromeTabProps) {
  const {
    active = false,
    title,
    leading,
    trailing,
    onClick,
    onClose,
    className = '',
    style,
    inactiveBg = 'rgba(255,255,255,0.08)',
    inactiveHoverBg = 'rgba(255,255,255,0.16)',
    activeBg = '#ffffff',
    inactiveColor = 'rgba(255,255,255,0.82)',
    activeColor = '#1f2328',
  } = props;

  const cssVars: ChromeTabStyle = {
    ...style,
    '--tab-bg': inactiveBg,
    '--tab-hover-bg': inactiveHoverBg,
    '--tab-active-bg': activeBg,
    '--tab-color': inactiveColor,
    '--tab-active-color': activeColor,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`chrome-tab ${active ? 'active' : ''} ${className}`.trim()}
      style={cssVars}
    >
      <div className="chrome-tab__body">
        {leading ? <span className="chrome-tab__leading">{leading}</span> : null}
        <span className="chrome-tab__title" title={title}>{title}</span>
        {trailing ? <span className="chrome-tab__trailing">{trailing}</span> : null}
        {onClose ? (
          <span
            role="button"
            tabIndex={0}
            className="chrome-tab__close"
            aria-label={`${i18n.t('ModUI.closeTab', { defaultValue: 'Close tab' })} ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
        ) : null}
      </div>
    </button>
  );
}
