import assert from 'node:assert/strict';
import test from 'node:test';

import { chatAgentStoreClient } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-store.js';
import {
  parseAgentLocalCancelTurnInput,
  parseAgentLocalThreadBundle,
  parseAgentLocalThreadSummary,
  parseAgentLocalTurnContext,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-parsers.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-types.js';
import {
  createAgentCreateMessageInput,
  createAgentTextMessage,
  createAgentTurnBeatInput,
} from './helpers/agent-chat-record-fixtures.js';

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

function sampleTarget(): AgentLocalTargetSnapshot {
  return {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    presentationProfile: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'friend agent',
    ownershipType: 'WORLD_OWNED',
    greeting: null,
    builtinDocsContext: null,
  };
}

test('chat agent bridge parser rejects invalid target shape and timestamps', () => {
  assert.throws(() => {
    parseAgentLocalThreadSummary({
      id: 'thread-1',
      ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      title: 'Companion',
      updatedAtMs: 100,
      lastMessageAtMs: null,
      archivedAtMs: null,
      targetSnapshot: {
        ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
        displayName: '',
        handle: 'companion',
      },
    });
  }, /displayName is required/);

  assert.throws(() => {
    parseAgentLocalThreadBundle({
      thread: {
        id: 'thread-1',
        ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
        title: 'Companion',
        createdAtMs: 10,
        updatedAtMs: 100,
        lastMessageAtMs: null,
        archivedAtMs: null,
        targetSnapshot: sampleTarget(),
      },
      messages: [{
        id: 'message-1',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'streaming',
        contentText: 'hello',
        error: null,
        traceId: null,
        parentMessageId: null,
        createdAtMs: 80,
        updatedAtMs: 90,
      }],
      draft: null,
    });
  }, /status is invalid/);

  assert.throws(() => {
    parseAgentLocalTurnContext({
      thread: {
        id: 'thread-1',
        ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
        title: 'Companion',
        createdAtMs: 10,
        updatedAtMs: 100,
        lastMessageAtMs: 90,
        archivedAtMs: null,
        targetSnapshot: sampleTarget(),
      },
      recentTurns: [],
      recentBeats: [],
      draft: null,
      projectionVersion: '',
    });
  }, /projectionVersion is required/);

  assert.throws(() => {
    parseAgentLocalCancelTurnInput({
      threadId: 'thread-1',
      turnId: 'turn-1',
      scope: 'bad',
      abortedAtMs: 100,
    });
  }, /scope is invalid/);
});

test('chat agent bridge parser accepts live2d presentation profiles in target snapshots', () => {
  const summary = parseAgentLocalThreadSummary({
    id: 'thread-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Companion',
    updatedAtMs: 100,
    lastMessageAtMs: 90,
    archivedAtMs: null,
    targetSnapshot: {
      ...sampleTarget(),
      presentationProfile: {
        backendKind: 'live2d',
        avatarAssetRef: 'asset://live2d/airi',
      },
    },
  });

  assert.equal(summary.targetSnapshot.presentationProfile?.backendKind, 'live2d');
  assert.equal(summary.targetSnapshot.presentationProfile?.avatarAssetRef, 'asset://live2d/airi');
});

test('chat agent store bridge invokes fixed tauri commands and payload shapes', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriInvokeMock(async (command, payload) => {
    calls.push({ command, payload });
    switch (command) {
      case 'chat_agent_list_threads':
        return [{
          id: 'thread-1',
          ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
          title: 'Companion',
          updatedAtMs: 100,
          lastMessageAtMs: 90,
          archivedAtMs: null,
          targetSnapshot: sampleTarget(),
        }];
      case 'chat_agent_get_thread_bundle':
        return {
          thread: {
            id: 'thread-1',
            ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
            title: 'Companion',
            createdAtMs: 50,
            updatedAtMs: 100,
            lastMessageAtMs: 90,
            archivedAtMs: null,
            targetSnapshot: sampleTarget(),
          },
          messages: [{
            id: 'message-1',
            threadId: 'thread-1',
            role: 'assistant',
            status: 'complete',
            kind: 'text',
            contentText: 'hello',
            reasoningText: null,
            error: null,
            traceId: 'trace-1',
            parentMessageId: null,
            mediaUrl: null,
            mediaMimeType: null,
            artifactId: null,
            createdAtMs: 80,
            updatedAtMs: 90,
          }],
          draft: {
            threadId: 'thread-1',
            text: 'draft',
            updatedAtMs: 110,
          },
        };
      case 'chat_agent_create_thread':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
        };
      case 'chat_agent_update_thread_metadata':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
          ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
          createdAtMs: 50,
        };
      case 'chat_agent_create_message':
        return {
          ...(payload as { payload: Record<string, unknown> }).payload,
        };
      case 'chat_agent_get_draft':
      case 'chat_agent_put_draft':
        return {
          threadId: 'thread-1',
          text: 'draft',
          updatedAtMs: 110,
        };
      case 'chat_agent_delete_draft':
        return null;
      case 'chat_agent_load_turn_context':
        return {
          thread: {
            id: 'thread-1',
            ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
            title: 'Companion',
            createdAtMs: 50,
            updatedAtMs: 120,
            lastMessageAtMs: 115,
            archivedAtMs: null,
            targetSnapshot: sampleTarget(),
          },
          recentTurns: [{
            id: 'turn-1',
            threadId: 'thread-1',
            role: 'assistant',
            status: 'completed',
            providerMode: 'runtime-agent-chat-v1',
            traceId: 'trace-1',
            promptTraceId: 'prompt-1',
            startedAtMs: 100,
            completedAtMs: 120,
            abortedAtMs: null,
          }],
          recentBeats: [{
            ...createAgentTurnBeatInput({
            id: 'beat-1',
            turnId: 'turn-1',
            beatIndex: 0,
            modality: 'text',
            status: 'delivered',
            textShadow: 'hello',
            mimeType: 'text/plain',
            projectionMessageId: 'message-1',
            createdAtMs: 110,
            deliveredAtMs: 120,
            }),
          }],
          draft: null,
          projectionVersion: 'projection:123:t1:b1:s1',
        };
      case 'chat_agent_commit_turn_result':
        return {
          turn: {
            id: 'turn-1',
            threadId: 'thread-1',
            role: 'assistant',
            status: 'completed',
            providerMode: 'runtime-agent-chat-v1',
            traceId: 'trace-1',
            promptTraceId: 'prompt-1',
            startedAtMs: 100,
            completedAtMs: 120,
            abortedAtMs: null,
          },
          beats: [{
            ...createAgentTurnBeatInput({
            id: 'beat-1',
            turnId: 'turn-1',
            beatIndex: 0,
            modality: 'text',
            status: 'delivered',
            textShadow: 'hello',
            mimeType: 'text/plain',
            projectionMessageId: 'message-1',
            createdAtMs: 110,
            deliveredAtMs: 120,
            }),
          }],
          bundle: {
            thread: {
              id: 'thread-1',
              ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
              title: 'Companion',
              createdAtMs: 50,
              updatedAtMs: 120,
              lastMessageAtMs: 115,
              archivedAtMs: null,
              targetSnapshot: sampleTarget(),
            },
            messages: [createAgentTextMessage({
              id: 'message-1',
              threadId: 'thread-1',
              role: 'assistant',
              status: 'complete',
              contentText: 'hello',
              traceId: 'trace-1',
              createdAtMs: 110,
              updatedAtMs: 120,
            })],
            draft: null,
          },
          projectionVersion: 'projection:123:t1:b1:s0:m0:r0',
        };
      case 'chat_agent_cancel_turn':
        return {
          id: 'turn-1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'canceled',
          providerMode: 'runtime-agent-chat-v1',
          traceId: 'trace-1',
          promptTraceId: 'prompt-1',
          startedAtMs: 100,
          completedAtMs: 120,
          abortedAtMs: 125,
        };
      case 'chat_agent_rebuild_projection':
        return {
          bundle: {
            thread: {
              id: 'thread-1',
              ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
              title: 'Companion',
              createdAtMs: 50,
              updatedAtMs: 120,
              lastMessageAtMs: 115,
              archivedAtMs: null,
              targetSnapshot: sampleTarget(),
            },
            messages: [createAgentTextMessage({
              id: 'message-1',
              threadId: 'thread-1',
              role: 'assistant',
              status: 'complete',
              contentText: 'hello',
              traceId: 'trace-1',
              createdAtMs: 110,
              updatedAtMs: 120,
            })],
            draft: null,
          },
          projectionVersion: 'projection:123:t1:b1:s0:m0:r0',
        };
      default:
        return null;
    }
  });

  try {
    const threads = await chatAgentStoreClient.listThreads();
    assert.equal(threads[0]?.localAgentRef, 'local-agent:user-1:agent-1');

    const bundle = await chatAgentStoreClient.getThreadBundle('thread-1');
    assert.equal(bundle?.messages[0]?.status, 'complete');

    await chatAgentStoreClient.createThread({
      id: 'thread-1',
      ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      title: 'Companion',
      createdAtMs: 50,
      updatedAtMs: 100,
      lastMessageAtMs: 90,
      archivedAtMs: null,
      targetSnapshot: sampleTarget(),
    });
    await chatAgentStoreClient.updateThreadMetadata({
      id: 'thread-1',
      title: 'Companion',
      updatedAtMs: 120,
      lastMessageAtMs: 115,
      archivedAtMs: null,
      targetSnapshot: sampleTarget(),
    });
    await chatAgentStoreClient.createMessage(createAgentCreateMessageInput({
      id: 'message-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'hello',
      traceId: 'trace-1',
      createdAtMs: 80,
      updatedAtMs: 90,
    }));
    await chatAgentStoreClient.getDraft('thread-1');
    await chatAgentStoreClient.putDraft({
      threadId: 'thread-1',
      text: 'draft',
      updatedAtMs: 110,
    });
    await chatAgentStoreClient.deleteDraft('thread-1');
    const turnContext = await chatAgentStoreClient.loadTurnContext({
      threadId: 'thread-1',
      recentTurnLimit: 8,
    });
    assert.equal(turnContext.recentTurns[0]?.providerMode, 'runtime-agent-chat-v1');
    const committed = await chatAgentStoreClient.commitTurnResult({
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'completed',
        providerMode: 'runtime-agent-chat-v1',
        traceId: 'trace-1',
        promptTraceId: 'prompt-1',
        startedAtMs: 100,
        completedAtMs: 120,
        abortedAtMs: null,
      },
      beats: [createAgentTurnBeatInput({
        id: 'beat-1',
        turnId: 'turn-1',
        beatIndex: 0,
        modality: 'text',
        status: 'delivered',
        textShadow: 'hello',
        mimeType: 'text/plain',
        projectionMessageId: 'message-1',
        createdAtMs: 110,
        deliveredAtMs: 120,
      })],
      projection: {
        thread: {
          id: 'thread-1',
          title: 'Companion',
          updatedAtMs: 120,
          lastMessageAtMs: 115,
          archivedAtMs: null,
          targetSnapshot: sampleTarget(),
        },
        messages: [createAgentTextMessage({
          id: 'message-1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          contentText: 'hello',
          traceId: 'trace-1',
          createdAtMs: 110,
          updatedAtMs: 120,
        })],
        draft: null,
        clearDraft: true,
      },
    });
    assert.equal(committed.turn.id, 'turn-1');
    const canceled = await chatAgentStoreClient.cancelTurn({
      threadId: 'thread-1',
      turnId: 'turn-1',
      scope: 'turn',
      abortedAtMs: 125,
    });
    assert.equal(canceled.status, 'canceled');
    const rebuilt = await chatAgentStoreClient.rebuildProjection('thread-1');
    assert.equal(rebuilt.bundle.messages[0]?.status, 'complete');
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.map((call) => call.command),
    [
      'chat_agent_list_threads',
      'chat_agent_get_thread_bundle',
      'chat_agent_create_thread',
      'chat_agent_update_thread_metadata',
      'chat_agent_create_message',
      'chat_agent_get_draft',
      'chat_agent_put_draft',
      'chat_agent_delete_draft',
      'chat_agent_load_turn_context',
      'chat_agent_commit_turn_result',
      'chat_agent_cancel_turn',
      'chat_agent_rebuild_projection',
    ],
  );
  assert.deepEqual(
    (calls[2]?.payload as { payload?: Record<string, unknown> })?.payload,
    {
      id: 'thread-1',
      ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      title: 'Companion',
      createdAtMs: 50,
      updatedAtMs: 100,
      lastMessageAtMs: 90,
      archivedAtMs: null,
      targetSnapshot: sampleTarget(),
    },
  );
  assert.deepEqual(
    (calls[8]?.payload as { payload?: Record<string, unknown> })?.payload,
    {
      threadId: 'thread-1',
      recentTurnLimit: 8,
    },
  );
  assert.equal(
    ((calls[9]?.payload as { payload?: Record<string, unknown> })?.payload?.projection as {
      clearDraft?: boolean;
    })?.clearDraft,
    true,
  );
  assert.deepEqual(
    (calls[10]?.payload as { payload?: Record<string, unknown> })?.payload,
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      scope: 'turn',
      abortedAtMs: 125,
    },
  );
  assert.deepEqual(
    (calls[11]?.payload as { payload?: Record<string, unknown> })?.payload,
    {
      threadId: 'thread-1',
    },
  );
});
