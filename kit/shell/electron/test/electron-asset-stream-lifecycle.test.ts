import { describe, expect, it } from 'vitest';
import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID, NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from '../src/main/host.js';
import { NimiElectronLocalAppHostError, type NimiElectronLocalAppHost } from '../src/main/local-app-host.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

function setup(open?: () => Promise<{ streamId: string }>, activityOpen?: () => Promise<{ streamId: string }>, conversationOpen?: () => Promise<{ streamId: string }>) {
  const ipcMain = new FakeIpcMain();
  const aborted: string[] = [];
  const readsClosed: string[] = [];
  const activitiesClosed: string[] = [];
  const conversationsClosed: string[] = [];
  const conversations = new Set<string>();
  const conversationNext = new Map<string, (value: { completed: boolean }) => void>();
  let next = 0;
  const host = {
    assetWriteOpen: open ?? (async () => ({ streamId: `write-${++next}` })),
    assetWriteCommit: async () => ({ relativePath: 'session.json' }),
    assetWriteAbort: async ({ streamId }: { streamId: string }) => { aborted.push(streamId); return { closed: true }; },
    assetReadOpen: async () => ({ streamId: `read-${++next}` }),
    assetReadClose: async ({ streamId }: { streamId: string }) => { readsClosed.push(streamId); return { closed: true }; },
    activitySubscribe: activityOpen ?? (async () => ({ streamId: `activity-${++next}` })),
    activityOpenDeliveriesSubscribe: async () => ({ streamId: `delivery-${++next}` }),
    activityStreamClose: async ({ streamId }: { streamId: string }) => { activitiesClosed.push(streamId); return { closed: true }; },
    conversationSubscribe: async () => {
      if (conversations.size >= 8) throw new NimiElectronLocalAppHostError('resource-exhausted', false);
      const opened = conversationOpen ? await conversationOpen() : { streamId: `conversation-${++next}` };
      conversations.add(opened.streamId);
      return opened;
    },
    conversationStreamNext: ({ streamId }: { streamId: string }) => conversations.has(streamId)
      ? new Promise(resolve => { conversationNext.set(streamId, resolve); }) : Promise.resolve({ completed: true }),
    conversationStreamClose: async ({ streamId }: { streamId: string }) => {
      const closed = conversations.delete(streamId);
      if (closed) conversationsClosed.push(streamId);
      conversationNext.get(streamId)?.({ completed: true });
      conversationNext.delete(streamId);
      return { closed };
    },
  } as unknown as NimiElectronLocalAppHost;
  const bridge = registerNimiElectronRuntimeBridge({
    appId: 'example.asset-app', runtimeEndpoint: '127.0.0.1:46371', allowedOrigins: ['http://localhost:1430'], ipcMain,
    createGrpcClient: async () => { throw new Error('ordinary gRPC is not used'); },
    standardShellHost: { capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID, localAppHost: host },
  });
  const call = (event: ReturnType<typeof createInvokeEvent>['event'], name: keyof typeof NIMI_STANDARD_SHELL_COMMANDS, payload: unknown) => (
    invokeBridge(ipcMain, event, { command: NIMI_STANDARD_SHELL_COMMANDS[name], payload: { payload } })
  );
  return { bridge, aborted, readsClosed, activitiesClosed, conversationsClosed, conversations, call };
}

describe('renderer asset stream lifetime', () => {
  it('aborts an unfinished write when its document reloads and leaves another window alone', async () => {
    const state = setup();
    const first = createInvokeEvent().event;
    const second = createInvokeEvent().event;
    try {
      await state.call(first, 'storage.assetWriteOpen', { relativePath: 'session.json', mediaType: 'application/json', overwrite: true });
      await state.call(second, 'storage.assetWriteOpen', { relativePath: 'other.json', mediaType: 'application/json', overwrite: true });
      first.sender.emit('did-start-navigation', { url: 'http://localhost:1430/', isSameDocument: false, isMainFrame: true });
      await Promise.resolve();
      expect(state.aborted).toEqual(['write-1']);
      await state.call(first, 'storage.assetWriteOpen', { relativePath: 'new.json', mediaType: 'application/json', overwrite: true });
      first.sender.emit('destroyed');
      await Promise.resolve();
      expect(state.aborted).toEqual(['write-1', 'write-3']);
    } finally { state.bridge.unregister(); }
  });

  it('closes a stream whose open resolves after navigation', async () => {
    let finish!: (value: { streamId: string }) => void;
    let started!: () => void;
    const opening = new Promise<void>((resolve) => { started = resolve; });
    const state = setup(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const event = createInvokeEvent().event;
    try {
      const result = state.call(event, 'storage.assetWriteOpen', { relativePath: 'session.json', mediaType: 'application/json', overwrite: true });
      await opening;
      event.sender.emit('did-start-navigation', { url: 'http://localhost:1430/', isSameDocument: false, isMainFrame: true });
      finish({ streamId: 'late-write' });
      await expect(result).rejects.toMatchObject({ reasonCode: 'renderer-context-replaced' });
      expect(state.aborted).toEqual(['late-write']);
    } finally { state.bridge.unregister(); }
  });

  it('preserves same-document and child-frame navigation, and forgets a committed write', async () => {
    const state = setup();
    const event = createInvokeEvent().event;
    try {
      await state.call(event, 'storage.assetWriteOpen', { relativePath: 'session.json', mediaType: 'application/json', overwrite: true });
      event.sender.emit('did-start-navigation', { url: 'http://localhost:1430/#view', isSameDocument: true, isMainFrame: true });
      event.sender.emit('did-start-navigation', { url: 'http://localhost:1430/editor', isSameDocument: false, isMainFrame: false });
      await Promise.resolve();
      expect(state.aborted).toEqual([]);
      await state.call(event, 'storage.assetWriteCommit', { streamId: 'write-1' });
      event.sender.emit('did-start-navigation', { url: 'http://localhost:1430/', isSameDocument: false, isMainFrame: true });
      await Promise.resolve();
      expect(state.aborted).toEqual([]);
    } finally { state.bridge.unregister(); }
  });

  it('closes pending reads and writes when a renderer is lost or the bridge is unregistered', async () => {
    const state = setup();
    const event = createInvokeEvent().event;
    await state.call(event, 'storage.assetReadOpen', { relativePath: 'session.json' });
    event.sender.emit('render-process-gone', {}, { reason: 'crashed' });
    await Promise.resolve();
    expect(state.readsClosed).toEqual(['read-1']);
    await state.call(event, 'storage.assetWriteOpen', { relativePath: 'session.json', mediaType: 'application/json', overwrite: true });
    state.bridge.unregister();
    await Promise.resolve();
    expect(state.aborted).toEqual(['write-2']);
    expect(event.sender.listenerCount('did-start-navigation')).toBe(0);
  });
});

describe('renderer Conversation subscription lifetime', () => {
  const request = { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', conversationAnchorId: 'anchor' };

  it('releases live subscriptions on repeated main-frame reloads without exhausting eight slots or closing another renderer', async () => {
    const state = setup();
    const first = createInvokeEvent().event;
    const second = createInvokeEvent().event;
    try {
      await state.call(second, 'local-app.conversationSubscribe', request);
      for (let reload = 0; reload < 16; reload++) {
        await state.call(first, 'local-app.conversationSubscribe', request);
        // Let the actual Host pump hold a pending next() before navigation.
        await new Promise(resolve => setTimeout(resolve, 0));
        first.sender.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true });
        await Promise.resolve();
        expect(state.conversations.size).toBe(1);
        expect(state.conversationsClosed).toHaveLength(reload + 1);
      }
      expect(state.conversationsClosed).not.toContain('conversation-1');
      second.sender.emit('destroyed');
      await Promise.resolve();
      expect(state.conversations.size).toBe(0);
    } finally { state.bridge.unregister(); }
  });

  it('retires a Conversation stream whose native open resolves after its document reloads', async () => {
    let finish!: (value: { streamId: string }) => void;
    let started!: () => void;
    const opening = new Promise<void>(resolve => { started = resolve; });
    const state = setup(undefined, undefined, () => { started(); return new Promise(resolve => { finish = resolve; }); });
    const event = createInvokeEvent().event;
    try {
      const result = state.call(event, 'local-app.conversationSubscribe', request);
      await opening;
      event.sender.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true });
      finish({ streamId: 'late-conversation' });
      await expect(result).rejects.toMatchObject({ reasonCode: 'renderer-context-replaced' });
      expect(state.conversationsClosed).toEqual(['late-conversation']);
      expect(state.conversations.size).toBe(0);
    } finally { state.bridge.unregister(); }
  });
});

describe('renderer activity subscription lifetime', () => {
  it('releases all three views and open deliveries across repeated reloads without closing another window', async () => {
    const state = setup();
    const first = createInvokeEvent().event;
    const second = createInvokeEvent().event;
    try {
      await state.call(second, 'local-app.activitySubscribe', { afterChangeSeq: '0' });
      for (let reload = 0; reload < 24; reload++) {
        for (let view = 0; view < 3; view++) await state.call(first, 'local-app.activitySubscribe', { afterChangeSeq: '0' });
        await state.call(first, 'local-app.activityOpenRequestsSubscribe', {});
        first.sender.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true });
        await Promise.resolve();
        expect(state.activitiesClosed).toHaveLength((reload + 1) * 4);
      }
      expect(state.activitiesClosed).not.toContain('activity-1');
      second.sender.emit('destroyed');
      await Promise.resolve();
      expect(state.activitiesClosed).toContain('activity-1');
    } finally { state.bridge.unregister(); }
  });

  it('cancels an activity subscription that opens after its renderer has navigated away', async () => {
    let finish!: (value: { streamId: string }) => void;
    let started!: () => void;
    const opening = new Promise<void>(resolve => { started = resolve; });
    const state = setup(undefined, () => { started(); return new Promise(resolve => { finish = resolve; }); });
    const event = createInvokeEvent().event;
    try {
      const result = state.call(event, 'local-app.activitySubscribe', { afterChangeSeq: '0' });
      await opening;
      event.sender.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true });
      finish({ streamId: 'late-activity' });
      await expect(result).rejects.toMatchObject({ reasonCode: 'renderer-context-replaced' });
      expect(state.activitiesClosed).toEqual(['late-activity']);
    } finally { state.bridge.unregister(); }
  });

  it('keeps same-document subscriptions and forgets explicitly cancelled ones', async () => {
    const state = setup();
    const event = createInvokeEvent().event;
    try {
      await state.call(event, 'local-app.activitySubscribe', { afterChangeSeq: '0' });
      event.sender.emit('did-start-navigation', { isSameDocument: true, isMainFrame: true });
      await Promise.resolve();
      expect(state.activitiesClosed).toEqual([]);
      await state.call(event, 'local-app.activitySubscribe', { action: 'cancel', subscriptionId: 'activity-1' });
      event.sender.emit('render-process-gone');
      await Promise.resolve();
      expect(state.activitiesClosed).toEqual(['activity-1']);
    } finally { state.bridge.unregister(); }
  });
});
