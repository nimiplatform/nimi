import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { runStudioBootstrap } from './studio-platform.js';
import { StudioSessionContext, type StudioSessionState } from './studio-session.js';

type BootstrapViewState = Omit<StudioSessionState, 'refresh'>;

function StudioSessionGate(props: {
  state: StudioSessionState;
  children: ReactNode;
}) {
  if (props.state.status === 'bootstrapping') {
    return (
      <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mx-auto mt-10 max-w-3xl overflow-hidden">
        <div className="grid min-h-[360px] content-between gap-8 p-8">
          <div>
            <StatusBadge tone="info">bootstrapping</StatusBadge>
            <h2 className="m-0 mt-4 text-2xl font-semibold">Opening Realm Agent Studio</h2>
            <p className="m-0 mt-3 text-[var(--nimi-text-muted)]">
              Connecting to your desktop Runtime account session.
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--nimi-surface-active)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
          </div>
        </div>
      </Surface>
    );
  }

  if (props.state.status === 'error') {
    return (
      <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mx-auto mt-10 max-w-4xl overflow-hidden">
        <div className="grid gap-6 p-8 md:grid-cols-[280px_1fr]">
          <div>
            <StatusBadge tone="danger">session unavailable</StatusBadge>
            <h2 className="m-0 mt-4 text-2xl font-semibold">Runtime account session required</h2>
            <p className="m-0 mt-3 text-[var(--nimi-text-muted)]">
              Open this app from the Nimi desktop shell, or sign in through the desktop Runtime account broker.
            </p>
            <Button className="mt-6" onClick={() => void props.state.refresh()}>Retry connection</Button>
          </div>
          <div className="grid content-start gap-4">
            <InlineAlert tone="danger">
              {props.state.error || 'Runtime account bootstrap failed.'}
            </InlineAlert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Surface tone="panel" padding="md">
                <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Realm</div>
                <div className="ras-break-anywhere mt-1 font-medium">{props.state.realmBaseUrl || 'unresolved'}</div>
              </Surface>
              <Surface tone="panel" padding="md">
                <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Session</div>
                <div className="mt-1 font-medium">Desktop Runtime</div>
              </Surface>
            </div>
          </div>
        </div>
      </Surface>
    );
  }

  if (props.state.status === 'unauthenticated') {
    return (
      <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mx-auto mt-10 max-w-4xl overflow-hidden">
        <div className="grid gap-6 p-8 md:grid-cols-[280px_1fr]">
          <div>
            <StatusBadge tone="warning">sign in required</StatusBadge>
            <h2 className="m-0 mt-4 text-2xl font-semibold">Owner session is not active</h2>
            <p className="m-0 mt-3 text-[var(--nimi-text-muted)]">
              Sign in to manage user-owned Realm Agents.
            </p>
            <Button className="mt-6" onClick={() => void props.state.refresh()}>Refresh session</Button>
          </div>
          <InlineAlert tone="warning">
            Sign in through the desktop Runtime account broker, then refresh this Studio session.
          </InlineAlert>
        </div>
      </Surface>
    );
  }

  return <>{props.children}</>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<BootstrapViewState>({
    status: 'bootstrapping',
    user: null,
    realmBaseUrl: '',
    error: null,
  });

  const refresh = useCallback(async () => {
    setViewState((current) => ({
      status: 'bootstrapping',
      user: null,
      realmBaseUrl: current.realmBaseUrl,
      error: null,
    }));
    const result = await runStudioBootstrap();
    if (!result.ok) {
      setViewState({
        status: 'error',
        user: null,
        realmBaseUrl: result.realmBaseUrl,
        error: result.error,
      });
      return;
    }
    setViewState({
      status: result.user ? 'authenticated' : 'unauthenticated',
      user: result.user,
      realmBaseUrl: result.realmBaseUrl,
      error: null,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const session = useMemo<StudioSessionState>(() => ({
    ...viewState,
    refresh,
  }), [refresh, viewState]);

  return (
    <StudioSessionContext.Provider value={session}>
      <StudioSessionGate state={session}>{children}</StudioSessionGate>
    </StudioSessionContext.Provider>
  );
}
