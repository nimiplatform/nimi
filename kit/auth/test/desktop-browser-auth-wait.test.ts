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
    oauthListenForCode: vi.fn((_payload: unknown, _signal?: AbortSignal) =>
      new Promise<{ code: string; state: string }>((resolve) => { deliver = resolve; })),
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
    expect(h.bridge.oauthListenForCode.mock.calls[0]?.[1]?.aborted).toBe(true);
  });
});

it('ends a pending Runtime begin immediately without creating a listener or dispatching an open', async () => {
  const h = harness();
  const wait = new AbortController();
  const begin = await h.runtimeAccountBroker.begin();
  let resolveBegin!: (attempt: typeof begin) => void;
  h.runtimeAccountBroker.begin = () => new Promise(resolve => { resolveBegin = resolve; });
  const outcome = performDesktopBrowserAuth(h.bridge as never, { runtimeAccountBroker: h.runtimeAccountBroker, signal: wait.signal });
  wait.abort();
  await expect(outcome).rejects.toSatisfy(isDesktopBrowserAuthWaitEnded);
  resolveBegin(begin);
  await Promise.resolve();
  expect(h.bridge.oauthListenForCode).not.toHaveBeenCalled();
  expect(h.opened).toEqual([]);
});

it('closes its native listener while an already-dispatched open is still pending', async () => {
  const h = harness();
  const wait = new AbortController();
  let finishOpen!: (result: { opened: boolean }) => void;
  const open = vi.fn(() => new Promise<{ opened: boolean }>(resolve => { finishOpen = resolve; }));
  h.bridge.openExternalUrl = open;
  const onBrowserOpened = vi.fn();
  const outcome = performDesktopBrowserAuth(h.bridge as never, {
    runtimeAccountBroker: h.runtimeAccountBroker, signal: wait.signal, onBrowserOpened,
  });
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  wait.abort();
  await expect(outcome).rejects.toSatisfy(isDesktopBrowserAuthWaitEnded);
  expect(h.bridge.oauthListenForCode.mock.calls[0]?.[1]?.aborted).toBe(true);
  finishOpen({ opened: true });
  await Promise.resolve();
  expect(onBrowserOpened).not.toHaveBeenCalled();
});

it('leaves an already-submitted callback under Runtime ownership when the local wait ends', async () => {
  const h = harness();
  const wait = new AbortController();
  const focus = vi.fn(async () => undefined);
  h.bridge.focusMainWindow = focus;
  let complete!: (result: { user: { id: string } }) => void;
  h.complete.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const outcome = performDesktopBrowserAuth(h.bridge as never, { runtimeAccountBroker: h.runtimeAccountBroker, signal: wait.signal });
  await vi.waitFor(() => expect(h.opened).toHaveLength(1));
  h.deliver({ code: 'code-1', state: 'state-1' });
  await vi.waitFor(() => expect(h.complete).toHaveBeenCalledTimes(1));
  wait.abort();
  complete({ user: { id: 'account-1' } });
  await expect(outcome).resolves.toEqual({ user: { id: 'account-1' } });
  expect(focus).not.toHaveBeenCalled();
});
