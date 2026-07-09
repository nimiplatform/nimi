import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogIn,
  LogOut,
  Settings,
  X,
} from 'lucide-react';
import { AccountPanel, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { getRuntimePlatformProjection, type RuntimePlatformReadyProjection } from '../auth/runtime-platform.js';
import { loadRuntimeAccountUser, logoutRuntimeAccount } from '../auth/runtime-account-auth.js';
import { RuntimeLoginPage } from '../auth/runtime-login-page.js';

type RuntimeAccountUser = {
  readonly displayName: string;
  readonly email?: string;
};

type RuntimeLoginClient = RuntimePlatformReadyProjection['client'];

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
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginClient, setLoginClient] = useState<RuntimeLoginClient | null>(null);
  const [user, setUser] = useState<RuntimeAccountUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshAccountUser = useCallback(async () => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status !== 'ready' && projection.status !== 'login-required') {
      throw new Error(projection.message || 'Runtime account projection unavailable.');
    }
    const nextUser = toAccountUser(await loadRuntimeAccountUser(projection.client));
    setUser(nextUser);
    return {
      client: projection.client as RuntimeLoginClient,
      user: nextUser,
    };
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

  const handleOpenLogin = useCallback(async () => {
    setStatusMessage(null);
    try {
      const next = await refreshAccountUser();
      if (next.user) {
        setStatusMessage(`Signed in as ${next.user.displayName}.`);
        setOpen(true);
        return;
      }
      setLoginClient(next.client);
      setLoginOpen(true);
      setOpen(false);
    } catch (error) {
      setStatusMessage(toAccountStatusMessage(error, 'Runtime account login unavailable.'));
      setOpen(true);
    }
  }, [refreshAccountUser]);

  const handleLoginComplete = useCallback(async () => {
    try {
      await refreshAccountUser();
      setLoginOpen(false);
      setStatusMessage('Signed in.');
      setOpen(true);
    } catch (error) {
      setStatusMessage(toAccountStatusMessage(error, 'Runtime account projection unavailable after login.'));
      setOpen(true);
    }
  }, [refreshAccountUser]);

  const handleLogout = async () => {
    setStatusMessage(null);
    setLoggingOut(true);
    try {
      const projection = await getRuntimePlatformProjection();
      if (projection.status !== 'ready' && projection.status !== 'login-required') {
        throw new Error(projection.message || 'Runtime account logout unavailable.');
      }
      await logoutRuntimeAccount(projection.client as Parameters<typeof logoutRuntimeAccount>[0]);
      setUser(null);
      setLoginOpen(false);
      setStatusMessage('Signed out.');
      setOpen(true);
    } catch (error) {
      setStatusMessage(toAccountStatusMessage(error, 'Runtime account logout failed.'));
      setOpen(true);
    } finally {
      setLoggingOut(false);
    }
  };

  const signedIn = Boolean(user);
  const displayName = user?.displayName || (loadingUser ? 'Checking account' : 'Not signed in');
  const fallback = signedIn ? displayName.charAt(0).toUpperCase() || 'N' : 'N';
  const items = [
    !signedIn
      ? {
          id: 'sign-in',
          label: 'Sign in',
          icon: <LogIn size={18} strokeWidth={1.8} aria-hidden="true" />,
          active: true,
          onSelect: () => void handleOpenLogin(),
        }
      : null,
    {
      id: 'nimi-lab-settings',
      label: 'Nimi Lab Settings',
      icon: <Settings size={18} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: () => {
        setOpen(false);
        onOpenSettings();
      },
    },
  ].filter((item): item is Exclude<typeof item, null> => Boolean(item));

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
          icon={signedIn ? <span aria-hidden="true">{fallback}</span> : <LogIn size={18} strokeWidth={1.9} aria-hidden="true" />}
        />
      </Tooltip>
      {open ? (
        <div className="lab-account-menu__panel" data-workbench-account-panel="">
          <AccountPanel
            user={{ displayName, email: user?.email, fallback }}
            items={items}
            footerItems={signedIn
              ? [
                  {
                    id: 'logout',
                    label: loggingOut ? 'Logging out' : 'Log out',
                    icon: <LogOut size={18} strokeWidth={1.8} aria-hidden="true" />,
                    tone: 'danger',
                    disabled: loggingOut,
                    onSelect: () => void handleLogout(),
                  },
                ]
              : []}
            ariaLabel="Nimi Lab account menu"
            statusMessage={statusMessage}
          />
        </div>
      ) : null}
      {loginOpen && loginClient ? (
        <div className="lab-account-login-popover">
          <IconButton
            type="button"
            tone="ghost"
            size="sm"
            className="lab-account-login-popover__close"
            aria-label="Close Nimi Lab account login"
            onClick={() => setLoginOpen(false)}
            icon={<X size={17} strokeWidth={1.8} aria-hidden="true" />}
          />
          <RuntimeLoginPage
            client={loginClient}
            layout="panel"
            errorMessage={statusMessage || undefined}
            onReady={() => { void handleLoginComplete(); }}
          />
        </div>
      ) : null}
    </div>
  );
}
