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
import { createPlainTextMessageContent } from '../src/shell/renderer/features/chat/chat-nimi-thread-model.js';

for (const route of ['side flip', 'direct switch', 'direct switch with empty draft'] as const) {
for (const outcome of ['success', 'failure'] as const) {
  test(`after a ${route}, a historical thread owns the send and its ${outcome} cleanup`, async (t) => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nimi-chat-routing-'));
    const host = createDesktopElectronChatAiStoreHost({
      resolveSelectedDataRoot: () => dataRoot,
      workerUrl: new URL('../src-electron/chat-ai-store-worker.ts', import.meta.url),
    });
    const globals = globalThis as Record<string, unknown>;
    const previousBridge = globals.__NIMI_ELECTRON_RUNTIME__;
    const calls: string[] = [];
    // Exercise the renderer parsers and actual SQLite host; only model execution
    // is controlled here. The real model journey is checked in Home separately.
    globals.__NIMI_ELECTRON_RUNTIME__ = {
      invoke: (command: keyof typeof host.commandHandlers, payload: Record<string, unknown>) => {
        calls.push(command);
        return host.commandHandlers[command]({ command, payload });
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
    let complete!: (result: { text: string; traceId: null }) => void;
    let fail!: (error: Error) => void;
    const execution = new Promise<{ text: string; traceId: null }>((resolve, reject) => { complete = resolve; fail = reject; });
    let submittingThreadId: string | null = null;
    const reported: unknown[] = [];
    function actions() {
      let result!: ReturnType<typeof useAiConversationHostActions>;
      function Hook() {
        const activeThreadId = navigation.getSnapshot().current.destination.chat?.threadId ?? null;
        const memory = nimiComposerMemory(navigation);
        const bundle = activeThreadId ? client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(activeThreadId)) : null;
        result = useAiConversationHostActions({
          activeThreadId, ephemeralThread: memory.ephemeralThread,
          selectedThreadRecord: activeThreadId === history.id ? history : memory.ephemeralThread?.id === activeThreadId ? memory.ephemeralThread : null,
          currentDraftTextRef: nimiComposerDraftRef(navigation, activeThreadId, bundle?.draft?.text ?? ''),
          submittingThreadId, setSubmittingThreadId: value => { submittingThreadId = value; },
          setEphemeralThread: value => { memory.ephemeralThread = value; },
          threads: [history, ...(memory.ephemeralThread ? [memory.ephemeralThread] : [])],
          syncSelectionToThread: threadId => { void navigation.replace({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant', threadId: threadId ?? undefined } }); },
          setBundleCache: (threadId, update) => { client.setQueryData<ChatAiThreadBundle | null>(bundleQueryKey(threadId), update); },
          executeTextCapability: () => execution,
          clearHostError() {}, reportHostError: error => { reported.push(error); }, now: () => 100, queryClient: client,
        });
        return null;
      }
      renderToString(<Hook />);
      return result;
    }
    await navigation.push({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant', threadId: history.id } });
    await actions().handleCreateThread();
    const temporary = nimiComposerMemory(navigation).ephemeralThread!;
    const retainedDraft = nimiComposerDraftRef(navigation, temporary.id, '');
    const temporaryText = route === 'direct switch with empty draft' ? '' : 'Keep this unsent temporary draft';
    retainedDraft.current = temporaryText;
    const temporaryBundle = client.getQueryData(bundleQueryKey(temporary.id));
    if (route === 'side flip') {
      await navigation.switchChatSide('human');
      await navigation.switchChatSide('companion');
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
    assert.equal(submittingThreadId, history.id);
    assert.equal(client.getQueryData(bundleQueryKey(temporary.id)), temporaryBundle);
    assert.equal(client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(history.id))?.messages.at(-1)?.contentText, 'Send only in history');
    if (outcome === 'success') complete({ text: 'Unit test model reply', traceId: null });
    else fail(new Error('Model execution failed'));
    const error = await settled;
    assert.equal(submittingThreadId, null);
    assert.equal(navigation.getSnapshot().current.destination.chat?.threadId, history.id);
    assert.equal(nimiComposerMemory(navigation).ephemeralThread?.id, temporary.id);
    assert.equal(retainedDraft.current, temporaryText);
    assert.equal(client.getQueryData(bundleQueryKey(temporary.id)), temporaryBundle);
    if (outcome === 'success') {
      assert.equal(error, null);
      assert.deepEqual(reported, []);
      assert.ok(calls.includes('chat_ai_get_thread_bundle'), 'verify the existing selected thread before persisting');
      assert.ok(!calls.includes('chat_ai_create_thread'), 'never recreate an existing history thread');
      const persisted = await chatAiStoreClient.getThreadBundle(history.id);
      assert.deepEqual(persisted?.messages.map(message => message.contentText), ['Earlier message', 'Send only in history', 'Unit test model reply']);
      assert.equal(historicalDraft.current, '');
    } else {
      assert.match(String(error), /Model execution failed/);
      assert.deepEqual(reported, [error]);
      assert.equal(historicalDraft.current, 'Send only in history');
      assert.equal(client.getQueryData<ChatAiThreadBundle>(bundleQueryKey(history.id))?.draft?.text, 'Send only in history');
      assert.deepEqual((await chatAiStoreClient.getThreadBundle(history.id))?.messages.map(message => message.id), ['original-message']);
    }
    assert.equal(await chatAiStoreClient.getThreadBundle(temporary.id), null, 'the retained temporary draft was never sent or persisted');
  });
}
}
