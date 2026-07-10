import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogIn,
  Settings,
} from 'lucide-react';
import { AccountPanel, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { getRuntimePlatformProjection } from '../auth/runtime-platform.js';
import { loadRuntimeAccountUser } from '../auth/runtime-account-auth.js';

type RuntimeAccountUser = {
  readonly displayName: string;
  readonly email?: string;
};

type NimiLabAccountMenuProps = {
  onOpenSettings: () => void;
};

function toAccountUser(user: Awaited<ReturnType<typeof loadRuntimeAccountUser>>): RuntimeAccountUser | null {
  if (!user) return null;
  return {
    displayName: user.displayName || user.id,
  };
}

function toAccountStatusMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('tauri-ipc Runtime transport requires')) {
    return 'Runtime account login requires the Nimi Lab desktop shell. Browser preview cannot open the Runtime account broker.';
  }
  return message || fallback;
}

export function NimiLabAccountMenu({ onOpenSettings }: NimiLabAccountMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<RuntimeAccountUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshAccountUser = useCallback(async () => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status !== 'ready' && projection.status !== 'login-required') {
      throw new Error(projection.message || 'Runtime account projection unavailable.');
    }
    const nextUser = toAccountUser(await loadRuntimeAccountUser(projection.client));
    setUser(nextUser);
    return nextUser;
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingUser(true);
    void refreshAccountUser().catch((error) => {
      if (!active) return;
      setStatusMessage(toAccountStatusMessage(error, 'Runtime account projection unavailable.'));
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

  const signedIn = Boolean(user);
  const displayName = user?.displayName || (loadingUser ? 'Checking account' : 'Not signed in');
  const fallback = signedIn ? displayName.charAt(0).toUpperCase() || 'N' : 'N';
  const items = [
    {
      id: 'desktop-account-owner',
      label: signedIn ? 'Account managed in Nimi Desktop' : 'Sign in with Nimi Desktop',
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
      <Tooltip content={signedIn ? displayName : 'Sign in'} placement="right" className="w-full">
        <IconButton
          type="button"
          tone="ghost"
          size="sm"
          data-workbench-account-trigger=""
          data-open={open ? 'true' : undefined}
          aria-label={signedIn ? `Open Nimi Lab account menu for ${displayName}` : 'Sign in to Nimi Lab'}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
          className={open ? 'lab-account-menu__trigger lab-account-menu__trigger--open' : 'lab-account-menu__trigger'}
          icon={signedIn ? <span className="lab-account-menu__avatar-glyph" aria-hidden="true">{fallback}</span> : <LogIn size={18} strokeWidth={1.9} aria-hidden="true" />}
        />
      </Tooltip>
      {open ? (
        <div className="lab-account-menu__panel" data-workbench-account-panel="">
          <AccountPanel
            user={{ displayName, email: user?.email, fallback }}
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
