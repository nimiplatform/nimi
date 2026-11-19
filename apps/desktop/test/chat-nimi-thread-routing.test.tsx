import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import { createDesktopElectronChatAiStoreHost } from '../src-electron/chat-ai-store-host.js';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { chatAiStoreClient } from '../src/shell/renderer/bridge/runtime-bridge/chat-ai-store.js';
import type { ChatAiThreadBundle } from '../src/shell/shared/chat-ai-store-types.js';
import { nimiComposerDraftRef, nimiComposerMemory } from '../src/shell/renderer/features/chat/chat-nimi-composer-draft.js';
import { bundleQueryKey, THREADS_QUERY_KEY } from '../src/shell/renderer/features/chat/chat-nimi-shell-core.js';
import { useAiConversationHostActions } from '../src/shell/renderer/features/chat/chat-nimi-shell-host-actions.js';
import { createPlainTextMessageContent, resolveAiConversationActiveThreadId } from '../src/shell/renderer/features/chat/chat-nimi-thread-model.js';

for (const route of ['leave for friends', 'direct switch', 'direct switch with empty draft'] as const) {
for (const outcome of ['success', 'failure', 'lost commit response', ...(route === 'direct switch' ? ['stop and replace'] : [])]) {
  test(`after a ${route}, a historical thread owns the send and its ${outcome} cleanup`, async (t) => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-routing-'));
    const scope = new AbortController();
    const host = createDesktopElectronChatAiStoreHost({
      resolveSelectedDataRoot: () => dataRoot,
      resolveTurnScope: async () => ({ signal: scope.signal, revision: 'current', accountKey: 'realm/account' }),
      workerUrl: new URL('../src-electron/chat-ai-store-worker.ts', import.meta.url),
    });
    const globals = globalThis as Record<string, unknown>;
    const previousBridge = globals.__NIMI_ELECTRON_RUNTIME__;
    const calls: string[] = [];
    let loseResponse = outcome === 'lost commit response';
    let modelCalls = 0;
    // Exercise the renderer parsers and actual SQLite host; only model execution
    // is controlled here. The real model journey is checked in Home separately.
    globals.__NIMI_ELECTRON_RUNTIME__ = {
      invoke: async (command: keyof typeof host.commandHandlers, payload: Record<string, unknown>) => {
        calls.push(command);
        const result = await host.commandHandlers[command]({ command, payload });
        if (command === 'chat_ai_commit_turn' && loseResponse) {
          loseResponse = false;
          throw new Error('commit response lost');
        }
        return result;
      },
    };
    const navigation = createHomeNavigation();
    const client = new QueryClient();
    t.after(async () => {
      client.clear(); navigation.dispose();
      if (previousBridge === undefined) delete globals.__NIMI_ELECTRON_RUNTIME__;
      else globals.__NIMI_ELECTRON_RUNTIME__ = previousBridge;
      await host.close();
      await rm(dataRoot, { recursive: true, force: true });
    });
    const history = await chatAiStoreClient.createThread({
      id: 'historical-thread', title: 'Historical conversation', createdAtMs: 10, updatedAtMs: 20, lastMessageAtMs: 20,
    });
    await chatAiStoreClient.createMessage({
      id: 'original-message', threadId: history.id, role: 'user', status: 'complete',
      contentText: 'Earlier message', content: createPlainTextMessageContent('Earlier message'),
      error: null, traceId: null, parentMessageId: null, createdAtMs: 20, updatedAtMs: 20,
    });
    client.setQueryData(THREADS_QUERY_KEY, await chatAiStoreClient.listThreads());
    client.setQueryData(bundleQueryKey(history.id), await chatAiStoreClient.getThreadBundle(history.id));
    let complete!: (result: { text: string; traceId: null; finishReason: 'stop' }) => void;
    let fail!: (error: Error) => void;
    const execution = new Promise<{ text: string; traceId: null; finishReason: 'stop' }>((resolve, reject) => { complete = resolve; fail = reject; });
    let started!: () => void;
    const executionStarted = new Promise<void>(resolve => { started = resolve; });
    let firstDelta: (text: string) => void;
    let secondDelta: (text: string) => void;
    let finishSecond!: (value: {text: string; traceId: null; finishReason: 'stop'}) => void;
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve; });
    const reported: unknown[] = [];
    function actions() {
      let result!: ReturnType<typeof useAiConversationHostActions>;
      function Hook() {
        const activeThreadId = navigation.getSnapshot().current.destination.chat?.threadId ?? null;
        const memory = nimiComposerMemory(navigation);
        const { ephemeralThread } = memory.getSnapshot();
        const bundle = activeThreadId ? client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(activeThreadId)) : null;
        result = useAiConversationHostActions({
          activeThreadId, ephemeralThread: ephemeralThread,
          selectedThreadRecord: activeThreadId === history.id ? history : ephemeralThread?.id === activeThreadId ? ephemeralThread : null,
          currentDraftTextRef: nimiComposerDraftRef(navigation, activeThreadId, bundle?.draft?.text ?? ''),
          navigation, composerMemory: memory, reportTruncation() {}, reportExpiredSave() {},
          setEphemeralThread: memory.setEphemeralThread,
          threads: [history, ...(ephemeralThread ? [ephemeralThread] : [])],
          syncSelectionToThread: threadId => { void navigation.replace({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant', threadId: threadId ?? undefined } }); },
          setBundleCache: (threadId, update) => { client.setQueryData<ChatAiThreadBundle | null>(bundleQueryKey(threadId), update); },
          executeTextCapability: (_prompt, _history, _signal, onText) => {
            modelCalls++;
            if (modelCalls === 1) {
              firstDelta = onText;
              started();
              return execution;
            }
            secondDelta = onText;
            markSecondStarted();
            return new Promise(resolve => { finishSecond = resolve; });
          },
          clearHostError() {}, reportHostError: error => { reported.push(error); }, now: () => 100, queryClient: client,
        });
        return null;
      }
      renderToString(<Hook />);
      return result;
    }
    await navigation.push({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant', threadId: history.id } });
    await actions().handleCreateThread();
    const temporary = nimiComposerMemory(navigation).getSnapshot().ephemeralThread!;
    const retainedDraft = nimiComposerDraftRef(navigation, temporary.id, '');
    const temporaryText = route === 'direct switch with empty draft' ? '' : 'Keep this unsent temporary draft';
    retainedDraft.current = temporaryText;
    const temporaryBundle = client.getQueryData(bundleQueryKey(temporary.id));
    if (route === 'leave for friends') {
      await navigation.push({ id: 'contacts' });
      await navigation.push({ id: 'chat' });
      assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, undefined);
    }
    await actions().handleSelectThread(history.id);
    assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, history.id);
    assert.deepEqual(reported, []);
    assert.equal(retainedDraft.current, temporaryText);
    const historicalDraft = nimiComposerDraftRef(navigation, history.id, '');
    historicalDraft.current = 'Send only in history';
    // Both drafts must remain independently reachable through ordinary selection.
    await actions().handleSelectThread(temporary.id);
    assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, temporary.id);
    assert.equal(nimiComposerDraftRef(navigation, temporary.id, '').current, temporaryText);
    assert.equal((await chatAiStoreClient.getDraft(history.id))?.text, 'Send only in history');
    await actions().handleSelectThread(history.id);
    assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, history.id);
    assert.equal(historicalDraft.current, 'Send only in history');
    assert.deepEqual(reported, []);
    calls.length = 0;
    const send = actions().handleSubmit(historicalDraft.current);
    // Register failure observation before settling the controlled model boundary.
    const settled = send.then(() => null, error => error);
    assert.equal(nimiComposerMemory(navigation).getSnapshot().pending?.threadId, history.id);
    await executionStarted;
    if (route === 'leave for friends') {
      await navigation.push({ id: 'contacts' });
      await navigation.push({ id: 'chat' });
      assert.equal(resolveAiConversationActiveThreadId({
        threads: [history], selectionThreadId: null, lastSelectedThreadId: null,
        pendingThreadId: nimiComposerMemory(navigation).getSnapshot().pending?.threadId,
      }), history.id);
      await navigation.replace({ id: 'chat', chat: { mode: 'ai', threadId: history.id } });
    }
    assert.equal(client.getQueryData(bundleQueryKey(temporary.id)), temporaryBundle);
    assert.equal(client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(history.id))?.messages.at(-1)?.contentText, 'Send only in history');
    if (outcome === 'stop and replace') {
      const memory = nimiComposerMemory(navigation);
      firstDelta!('First visible text from A');
      assert.equal(memory.getSnapshot().pending?.text, 'First visible text from A');
      memory.getSnapshot().pending!.stop!();
      assert.equal(memory.getSnapshot().pending, null);
      historicalDraft.current = 'Replacement B';
      const replacement = actions().handleSubmit('Replacement B');
      await secondStarted;
      secondDelta!('B in progress');
      firstDelta!('Late A body');
      fail(new Error('Late A failure'));
      await settled;
      assert.equal(memory.getSnapshot().pending?.text, 'B in progress');
      assert.deepEqual(reported, []);
      finishSecond({ text: 'Saved B', traceId: null, finishReason: 'stop' });
      await replacement;
      const persisted = await chatAiStoreClient.getThreadBundle(history.id);
      assert.deepEqual(persisted?.messages.map(message => message.contentText), ['Earlier message', 'Replacement B', 'Saved B']);
      assert.equal(modelCalls, 2);
      assert.equal(calls.filter(command => command === 'chat_ai_commit_turn').length, 1);
      return;
    }
    if (outcome !== 'failure') complete({ text: 'Unit test model reply', traceId: null, finishReason: 'stop' });
    else fail(new Error('Model execution failed'));
    const error = await settled;
    if (outcome === 'lost commit response') {
      const pending = nimiComposerMemory(navigation).getSnapshot().pending;
      assert.equal(pending?.phase, 'unconfirmed');
      pending!.retrySave!();
      await new Promise<void>(resolve => {
        const memory = nimiComposerMemory(navigation);
        const off = memory.subscribe(() => { if (!memory.getSnapshot().pending) { off(); resolve(); } });
      });
      assert.equal(calls.filter(command => command === 'chat_ai_commit_turn').length, 2);
      assert.equal(modelCalls, 1);
    }
    assert.equal(nimiComposerMemory(navigation).getSnapshot().pending, null);
    assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, history.id);
    assert.equal(nimiComposerMemory(navigation).getSnapshot().ephemeralThread?.id, temporary.id);
    assert.equal(retainedDraft.current, temporaryText);
    assert.equal(client.getQueryData(bundleQueryKey(temporary.id)), temporaryBundle);
    if (outcome !== 'failure') {
      assert.equal(error, null);
      assert.deepEqual(reported, []);
      assert.ok(calls.includes('chat_ai_get_turn_context'), 'verify the existing selected thread before persisting');
      assert.ok(!calls.includes('chat_ai_create_thread'), 'never recreate an existing history thread');
      const persisted = await chatAiStoreClient.getThreadBundle(history.id);
      assert.deepEqual(persisted?.messages.map(message => message.contentText), ['Earlier message', 'Send only in history', 'Unit test model reply']);
      assert.equal(historicalDraft.current, '');
    } else {
      assert.equal(error, null);
      assert.match(String(reported[0]), /Model execution failed/);
      assert.equal(historicalDraft.current, 'Send only in history');
      assert.equal(client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(history.id))?.draft?.text, 'Send only in history');
      assert.deepEqual((await chatAiStoreClient.getThreadBundle(history.id))?.messages.map(message => message.id), ['original-message']);
    }
    assert.equal(await chatAiStoreClient.getThreadBundle(temporary.id), null, 'the retained temporary draft was never sent or persisted');
  });
}
}
