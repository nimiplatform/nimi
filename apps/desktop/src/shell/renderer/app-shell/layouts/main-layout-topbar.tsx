import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@nimiplatform/kit/ui';
import { motion } from 'motion/react';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  SHELL_CHROME_ACTION_CELL_CLASS,
} from './shell-chrome-classes';
import { useDesktopInteractiveMotion } from '../../ui/motion/desktop-motion';
import type { AuthStatus } from '../providers/app-store';

type MainLayoutTopBarProps = {
  authStatus: AuthStatus;
  titlebarTopInsetClass: string;
  titlebarLeftInsetClass: string;
  activeTab: string;
  onLogin: () => void;
  onOpenChat: () => void;
  onOpenRuntimeConfig: () => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function MainLayoutTopBar(props: MainLayoutTopBarProps) {
  const { t } = useTranslation();
  const interactiveMotion = useDesktopInteractiveMotion();
  const anonymousMode = props.authStatus !== 'authenticated';

  return (
    <div
      className={`desktop-shell-topbar absolute inset-x-0 ${props.titlebarTopInsetClass} z-[11000] flex h-14 items-center nimi-material-glass-regular bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_12%,transparent)] px-2 backdrop-blur-[var(--nimi-backdrop-blur-regular)] ${props.titlebarLeftInsetClass}`}
      data-shell-titlebar="true"
      onMouseDown={props.onMouseDown}
    >
      <div className="flex h-full w-full min-w-0 items-center overflow-hidden border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_78%,white)] px-1">
        <div className="desktop-shell-topbar__actions ml-2 flex shrink-0 items-center gap-2" data-titlebar-region="actions">
          {anonymousMode ? (
            <div className="flex items-center gap-2">
              {props.activeTab !== 'chat' ? (
                <Tooltip content={t('Navigation.chat', { defaultValue: 'Chat' })} className="h-10">
                  <motion.button
                  type="button"
                  data-titlebar-interactive="true"
                  onClick={props.onOpenChat}
                  whileHover={interactiveMotion.whileHover}
                  whileTap={interactiveMotion.whileTap}
                  transition={interactiveMotion.transition}
                  className={SHELL_CHROME_ACTION_CELL_CLASS}
                  aria-label={t('Navigation.chat', { defaultValue: 'Chat' })}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </motion.button>
                </Tooltip>
              ) : null}
              {props.activeTab !== 'runtime' ? (
                <Tooltip content={t('Navigation.runtime', { defaultValue: 'Runtime' })} className="h-10">
                  <motion.button
                    type="button"
                    data-testid={E2E_IDS.topbarRuntimeButton}
                    data-titlebar-interactive="true"
                    onClick={props.onOpenRuntimeConfig}
                    whileHover={interactiveMotion.whileHover}
                    whileTap={interactiveMotion.whileTap}
                    transition={interactiveMotion.transition}
                    className={SHELL_CHROME_ACTION_CELL_CLASS}
                    aria-label={t('Navigation.runtime', { defaultValue: 'Runtime' })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                      <line x1="6" y1="6" x2="6.01" y2="6" />
                      <line x1="6" y1="18" x2="6.01" y2="18" />
                    </svg>
                  </motion.button>
                </Tooltip>
              ) : null}
              <Tooltip content={t('Auth.login', { defaultValue: 'Login' })} className="h-10">
                <motion.button
                  type="button"
                  data-testid={E2E_IDS.topbarLoginButton}
                  data-titlebar-interactive="true"
                  onClick={props.onLogin}
                  whileHover={interactiveMotion.whileHover}
                  whileTap={interactiveMotion.whileTap}
                  transition={interactiveMotion.transition}
                  className={SHELL_CHROME_ACTION_CELL_CLASS}
                  aria-label={t('Auth.login', { defaultValue: 'Login' })}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </motion.button>
              </Tooltip>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
