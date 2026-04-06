import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatAiStoreClient,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-ai-store.js';
import {
  parseChatAiThreadBundle,
  parseChatAiThreadSummary,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-ai-parsers.js';
import type {
  ChatAiMessageContent,
  ChatAiRouteSnapshot,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-ai-types.js';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

function installTauriInvokeMock(
  handler: (command: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__NIMI_TAURI_TEST__;
  const previousWindow = globalRecord.window;
  const previousSessionStorage = globalRecord.sessionStorage;
  const sessionStore = new Map<string, string>();
  globalRecord.__NIMI_TAURI_TEST__ = {
    invoke: handler,
  };
  globalRecord.window = {
    __NIMI_HTML_BOOT_ID__: 'renderer-session-test',
  };
  globalRecord.sessionStorage = {
    getItem(key: string) {
      return sessionStore.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      sessionStore.set(key, value);
    },
    removeItem(key: string) {
      sessionStore.delete(key);
    },
    clear() {
      sessionStore.clear();
    },
  };
  return () => {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousTauri;
    }
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
    if (typeof previousSessionStorage === 'undefined') {
      delete globalRecord.sessionStorage;
    } else {
      globalRecord.sessionStorage = previousSessionStorage;
    }
  };
}

function sampleRouteSnapshot(): ChatAiRouteSnapshot {
  return {
    routeKind: 'cloud',
    connectorId: 'connector-openai',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    routeBinding: {
      temperature: 0.3,
    },
  };
}

function sampleMessageContent(text: string): ChatAiMessageContent {
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: {},
  };
}

test('chat ai bridge parser rejects invalid route kind and timestamps', () => {
  assert.throws(() => {
    parseChatAiThreadSummary({
      id: 'thread-1',
      title: 'alpha',
      updatedAtMs: 100,
      lastMessageAtMs: null,
      archivedAtMs: null,
      routeSnapshot: {
        routeKind: 'edge',
        connectorId: null,
        provider: null,
        modelId: null,
        routeBinding: null,
      },
    });
  }, /routeKind is invalid/);

  assert.throws(() => {
    parseChatAiThreadBundle({
      thread: {
        id: 'thread-1',
        title: 'alpha',
        createdAtMs: 100,
        updatedAtMs: 'not-a-number',
        lastMessageAtMs: null,
        archivedAtMs: null,
        routeSnapshot: sampleRouteSnapshot(),
      },
      messages: [],
      draft: null,
    });
  }, /updatedAtMs must be an integer/);
});

test('chat ai store bridge invokes fixed tauri commands and payload shapes', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    switch (command) {
      case 'chat_ai_list_threads':
        return [{
          id: 'thread-1',
          title: 'alpha',
          updatedAtMs: 100,
          lastMessageAtMs: 90,
          archivedAtMs: null,
          routeSnapshot: sampleRouteSnapshot(),
        }];
      case 'chat_ai_get_thread_bundle':
        return {
          thread: {
            id: 'thread-1',
            title: 'alpha',
            createdAtMs: 50,
            updatedAtMs: 100,
            lastMessageAtMs: 90,
            archivedAtMs: null,
            routeSnapshot: sampleRouteSnapshot(),
          },
          messages: [{
            id: 'message-1',
            threadId: 'thread-1',
            role: 'assistant',
            status: 'complete',
            contentText: 'hello',
            content: sampleMessageContent('hello'),
            error: null,
            traceId: 'trace-1',
            parentMessageId: null,
            createdAtMs: 80,
            updatedAtMs: 90,
          }],
          draft: {
            threadId: 'thread-1',
            text: 'draft',
            attachments: [],
            updatedAtMs: 110,
          },
        };
      case 'chat_ai_create_thread':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
        };
      case 'chat_ai_update_thread_metadata':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
          createdAtMs: 50,
        };
      case 'chat_ai_create_message':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
        };
      case 'chat_ai_update_message':
        return {
          id: 'message-1',
          threadId: 'thread-1',
          role: 'assistant',
          parentMessageId: null,
          createdAtMs: 80,
          ...(payload as { payload: Record<string, unknown> }).payload,
        };
      case 'chat_ai_get_draft':
      case 'chat_ai_put_draft':
        return {
          threadId: 'thread-1',
          text: 'draft',
          attachments: [],
          updatedAtMs: 110,
        };
      case 'chat_ai_delete_draft':
        return null;
      default:
        return null;
    }
  });

  try {
    const threads = await chatAiStoreClient.listThreads();
    assert.equal(threads[0]?.routeSnapshot.provider, 'openai');

    const bundle = await chatAiStoreClient.getThreadBundle('thread-1');
    assert.equal(bundle?.messages[0]?.status, 'complete');

    await chatAiStoreClient.createThread({
      id: 'thread-1',
      title: 'alpha',
      createdAtMs: 50,
      updatedAtMs: 100,
      lastMessageAtMs: 90,
      archivedAtMs: null,
      routeSnapshot: sampleRouteSnapshot(),
    });
    await chatAiStoreClient.updateThreadMetadata({
      id: 'thread-1',
      title: 'beta',
      updatedAtMs: 120,
      lastMessageAtMs: 115,
      archivedAtMs: null,
      routeSnapshot: sampleRouteSnapshot(),
    });
    await chatAiStoreClient.createMessage({
      id: 'message-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'hello',
      content: sampleMessageContent('hello'),
      error: null,
      traceId: 'trace-1',
      parentMessageId: null,
      createdAtMs: 80,
      updatedAtMs: 90,
    });
    await chatAiStoreClient.createMessage({
      id: 'message-2',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'pending',
      contentText: '',
      content: sampleMessageContent(''),
      error: null,
      traceId: null,
      parentMessageId: 'message-1',
      createdAtMs: 91,
      updatedAtMs: 91,
    });
    await chatAiStoreClient.updateMessage({
      id: 'message-1',
      status: 'streaming',
      contentText: 'hello world',
      content: sampleMessageContent('hello world'),
      error: null,
      traceId: 'trace-2',
      updatedAtMs: 95,
    });
    await chatAiStoreClient.getDraft('thread-1');
    await chatAiStoreClient.putDraft({
      threadId: 'thread-1',
      text: 'draft',
      attachments: [],
      updatedAtMs: 110,
    });
    await chatAiStoreClient.deleteDraft('thread-1');

    assert.deepEqual(calls.map((entry) => entry.command), [
      'chat_ai_list_threads',
      'chat_ai_get_thread_bundle',
      'chat_ai_create_thread',
      'chat_ai_update_thread_metadata',
      'chat_ai_create_message',
      'chat_ai_create_message',
      'chat_ai_update_message',
      'chat_ai_get_draft',
      'chat_ai_put_draft',
      'chat_ai_delete_draft',
    ]);
    assert.deepEqual(calls[1]?.payload, {
      payload: {
        threadId: 'thread-1',
      },
    });
    assert.deepEqual(calls[2]?.payload, {
      payload: {
        id: 'thread-1',
        title: 'alpha',
        createdAtMs: 50,
        updatedAtMs: 100,
        lastMessageAtMs: 90,
        archivedAtMs: null,
        routeSnapshot: sampleRouteSnapshot(),
      },
    });
    assert.deepEqual(calls[5]?.payload, {
      payload: {
        id: 'message-2',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'pending',
        contentText: '',
        content: sampleMessageContent(''),
        error: null,
        traceId: null,
        parentMessageId: 'message-1',
        createdAtMs: 91,
        updatedAtMs: 91,
      },
    });
    assert.deepEqual(calls[6]?.payload, {
      payload: {
        id: 'message-1',
        status: 'streaming',
        contentText: 'hello world',
        content: sampleMessageContent('hello world'),
        error: null,
        traceId: 'trace-2',
        updatedAtMs: 95,
      },
    });
    assert.deepEqual(calls[9]?.payload, {
      payload: {
        threadId: 'thread-1',
      },
    });
  } finally {
    restore();
  }
});
