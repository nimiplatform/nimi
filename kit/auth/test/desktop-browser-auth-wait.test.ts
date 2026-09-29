import { describe, expect, it, vi } from 'vitest';
import {
  isDesktopBrowserAuthWaitEnded,
  performDesktopBrowserAuth,
} from '../src/logic/desktop-browser-auth.js';

const AUTHORIZE_URL = 'https://realm.example/api/auth/oauth/authorize?client_id=nimi&state=state-1';

function harness() {
  let deliver: ((value: { code: string; state: string }) => void) | undefined;
  const opened: string[] = [];
  const complete = vi.fn(async () => ({ user: { id: 'account-1' } }));
  const bridge = {
    hasShellHostInvoke: () => true,
    oauthListenForCode: () => new Promise<{ code: string; state: string }>((resolve) => { deliver = resolve; }),
    openExternalUrl: async (url: string) => { opened.push(url); return { opened: true }; },
    focusMainWindow: async () => undefined,
  };
  const runtimeAccountBroker = {
    begin: async () => ({ loginAttemptId: 'attempt-1', authorizationUrl: AUTHORIZE_URL, state: 'state-1', nonce: 'nonce-1' }),
    complete,
  };
  return { bridge, runtimeAccountBroker, complete, opened, deliver: (value: { code: string; state: string }) => deliver?.(value) };
}

describe('desktop browser sign-in wait', () => {
  it('reopens the same authorization URL and completes a callback that arrives while waiting', async () => {
    const h = harness();
    let reopen: (() => Promise<boolean>) | undefined;
    const done = performDesktopBrowserAuth(h.bridge as never, {
      runtimeAccountBroker: h.runtimeAccountBroker,
      onBrowserOpened: (open) => { reopen = open; },
    });
    await vi.waitFor(() => expect(reopen).toBeDefined());
    await expect(reopen!()).resolves.toBe(true);
    expect(h.opened).toEqual([AUTHORIZE_URL, AUTHORIZE_URL]);
    h.deliver({ code: 'code-1', state: 'state-1' });
    await expect(done).resolves.toEqual({ user: { id: 'account-1' } });
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it('ends the local wait without cancelling Runtime, and a later callback never completes', async () => {
    const h = harness();
    const wait = new AbortController();
    let opened = false;
    const done = performDesktopBrowserAuth(h.bridge as never, {
      runtimeAccountBroker: h.runtimeAccountBroker,
      signal: wait.signal,
      onBrowserOpened: () => { opened = true; },
    });
    await vi.waitFor(() => expect(opened).toBe(true));
    wait.abort();
    await expect(done).rejects.toSatisfy(isDesktopBrowserAuthWaitEnded);
    h.deliver({ code: 'late-code', state: 'state-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.complete).not.toHaveBeenCalled();
  });
});
