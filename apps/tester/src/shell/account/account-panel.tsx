import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogIn,
  Settings,
} from 'lucide-react';
import { AccountPanel, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { useTesterRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../i18n/index.js';

type NimiLabAccountMenuProps = {
  onOpenSettings: () => void;
};

// runtime-platform projections carry i18n message keys; session-ended keys map
// to the account-menu specific explanation, everything else resolves via t().
// Frozen array: module-scope constructed resources (new Set/Map) are forbidden
// by simulator conformance.
const sessionEndedMessageKeys = Object.freeze([
  'Auth.runtime.messages.revoked',
  'Auth.runtime.messages.accountChanged',
  'Auth.runtime.messages.runtimeRestarted',
]);

function toAccountStatusMessage(error: unknown, fallbackKey: string, translate: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (sessionEndedMessageKeys.includes(message)) {
    return translate('Auth.account.sessionRequired');
  }
  if (message.startsWith('Auth.')) {
    return translate(message);
  }
  return message || translate(fallbackKey);
}

export function NimiLabAccountMenu({ onOpenSettings }: NimiLabAccountMenuProps) {
  const { t } = useTranslation();
  const rendererHost = useTesterRendererHost();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [localAppSessionReady, setLocalAppSessionReady] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshAccountUser = useCallback(async () => {
    const projection = await rendererHost.app.projection.runtimePlatform();
    if (projection.status !== 'ready') {
      // Simulator fixtures may carry a literal `message` without a `messageKey`.
      throw new Error(projection.messageKey || projection.message || 'Auth.account.sessionUnavailable');
    }
    setLocalAppSessionReady(true);
    setStatusMessage(t('Auth.account.sessionBoundDetail'));
    return projection.localAppSession;
  }, [rendererHost, t]);

  useEffect(() => {
    let active = true;
    setLoadingUser(true);
    void refreshAccountUser().catch((error) => {
      if (!active) return;
      setStatusMessage(toAccountStatusMessage(error, 'Auth.account.sessionUnavailable', t));
    }).finally(() => {
      if (active) setLoadingUser(false);
    });
    return () => {
      active = false;
    };
  }, [refreshAccountUser, t]);

  const displayName = localAppSessionReady
    ? t('Auth.account.displayReady')
    : (loadingUser ? t('Auth.account.displayChecking') : t('Auth.account.displayUnavailable'));
  const fallback = 'N';
  const items = [
    {
      id: 'desktop-account-owner',
      label: localAppSessionReady ? t('Auth.account.identityProtected') : t('Auth.account.openDesktop'),
      icon: <LogIn size={18} strokeWidth={1.8} aria-hidden="true" />,
      disabled: true,
    },
    {
      id: 'nimi-lab-settings',
      label: t('Auth.account.settings'),
      icon: <Settings size={18} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: () => {
        setOpen(false);
        onOpenSettings();
      },
    },
  ];

  return (
    <div
      ref={rootRef}
      className="lab-account-menu"
      data-workbench-account-root=""
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <Tooltip content={displayName} placement="right" className="w-full">
        <IconButton
          type="button"
          tone="ghost"
          size="sm"
          data-workbench-account-trigger=""
          data-open={open ? 'true' : undefined}
          aria-label={t('Auth.account.triggerAriaLabel')}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
          className={open ? 'lab-account-menu__trigger lab-account-menu__trigger--open' : 'lab-account-menu__trigger'}
          icon={localAppSessionReady ? <span className="lab-account-menu__avatar-glyph" aria-hidden="true">{fallback}</span> : <LogIn size={18} strokeWidth={1.9} aria-hidden="true" />}
        />
      </Tooltip>
      {open ? (
        <div className="lab-account-menu__panel" data-workbench-account-panel="">
          <AccountPanel
            user={{ displayName, fallback }}
            items={items}
            footerItems={[]}
            ariaLabel={t('Auth.account.menuAriaLabel')}
            statusMessage={statusMessage}
          />
        </div>
      ) : null}
    </div>
  );
}
