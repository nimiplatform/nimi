import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogIn,
  Settings,
} from 'lucide-react';
import { AccountPanel, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { getRuntimePlatformProjection } from '../auth/runtime-platform.js';

type NimiLabAccountMenuProps = {
  onOpenSettings: () => void;
};

function toAccountStatusMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('protected local-app session')) {
    return 'Nimi Lab requires a verified Desktop-supervised local-app session.';
  }
  return message || fallback;
}

export function NimiLabAccountMenu({ onOpenSettings }: NimiLabAccountMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [localAppSessionReady, setLocalAppSessionReady] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshAccountUser = useCallback(async () => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status !== 'ready') {
      throw new Error(projection.message || 'Protected local-app session unavailable.');
    }
    setLocalAppSessionReady(true);
    setStatusMessage(projection.localAppSession.operationAllowed
      ? 'The protected local-app session has an operation grant; account identity and grant authority remain in Nimi Desktop.'
      : 'The protected identity session has zero grants. This app receives no account token, subject identifier, or implied operation authorization.');
    return projection.localAppSession;
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingUser(true);
    void refreshAccountUser().catch((error) => {
      if (!active) return;
      setStatusMessage(toAccountStatusMessage(error, 'Protected local-app session unavailable.'));
    }).finally(() => {
      if (active) setLoadingUser(false);
    });
    return () => {
      active = false;
    };
  }, [refreshAccountUser]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const displayName = localAppSessionReady ? 'Nimi protected local app' : (loadingUser ? 'Checking local-app session' : 'Local-app session unavailable');
  const fallback = 'N';
  const items = [
    {
      id: 'desktop-account-owner',
      label: localAppSessionReady ? 'Identity protected by Nimi Desktop' : 'Open Nimi Desktop',
      icon: <LogIn size={18} strokeWidth={1.8} aria-hidden="true" />,
      disabled: true,
    },
    {
      id: 'nimi-lab-settings',
      label: 'Nimi Lab Settings',
      icon: <Settings size={18} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: () => {
        setOpen(false);
        onOpenSettings();
      },
    },
  ];

  return (
    <div ref={rootRef} className="lab-account-menu" data-workbench-account-root="">
      <Tooltip content={displayName} placement="right" className="w-full">
        <IconButton
          type="button"
          tone="ghost"
          size="sm"
          data-workbench-account-trigger=""
          data-open={open ? 'true' : undefined}
          aria-label="Open Nimi Lab Desktop-owned account status"
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
            ariaLabel="Nimi Lab account menu"
            statusMessage={statusMessage}
          />
        </div>
      ) : null}
    </div>
  );
}
