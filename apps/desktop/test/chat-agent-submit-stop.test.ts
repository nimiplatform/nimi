import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { submitAgentConversationTurn } from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.js';
import {
  createAgentComposerPersistence,
  type AgentPendingSubmission,
} from '@nimiplatform/kit/features/chat/headless';

const TARGET = {
  agentHandle: `agent_ref_${'a'.repeat(43)}`,
  conversationAnchorId: 'anchor-1',
  displayName: 'Partner',
  handle: '',
  avatarUrl: null,
  worldId: null,
  worldName: null,
  bio: null,
  ownershipType: null,
  greeting: null,
  builtinDocsContext: null,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}
async function harness(
  options: {
    holdCopy?: ReturnType<typeof deferred>;
    loseAck?: boolean;
    busy?: boolean;
    failSave?: boolean;
  } = {},
) {
  let text = 'original question',
    revision = 0;
  const listeners = new Set<() => void>();
  const draft = {
    get current() {
      return text;
    },
    set current(value: string) {
      if (value !== text) {
        text = value;
        revision++;
        for (const listener of listeners) listener();
      }
    },
    get revision() {
      return revision;
    },
  };
  let document: unknown = { version: 1, draft: text };
  let pending: AgentPendingSubmission | null = null;
  const copying = deferred();
  const controller = createAgentComposerPersistence({
    agentBinding: `agent_binding_${'a'.repeat(43)}`,
    draft,
    isCurrent: () => true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onState: () => {},
    onRestored: () => {},
    onSubmission: (value) => {
      pending = value;
    },
    storage: {
      readJson: async () => ({ value: document as never, sizeBytes: 20 }),
      writeJson: async (_path, value) => {
        copying.resolve();
        if (options.holdCopy) await options.holdCopy.promise;
        if (options.failSave) throw new Error('storage unavailable');
        document = value;
        return { value, sizeBytes: 20 };
      },
    },
  });
  await controller.ready;
  const sent: unknown[] = [];
  let subscriptions = 0,
    interrupts = 0;
  const conversation = {
    open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null }),
    send: async (value: unknown) => {
      sent.push(value);
      if (options.busy)
        throw Object.assign(new Error('Partner busy'), { reasonCode: 'AGENT_BUSY' });
      if (options.loseAck) throw new Error('reply lost');
      return { turnId: 'accepted-turn' };
    },
    subscribe: () => {
      subscriptions++;
      throw new Error('Send must use the existing canonical subscription');
    },
    interruptTurn: () => {
      interrupts++;
      throw new Error('A new question must not cancel old media');
    },
  };
  const queryClient = new QueryClient();
  const reports: unknown[] = [];
  const reportOptions: unknown[] = [];
  const hostInput = {
    now: Date.now,
    sdk: { conversation: () => conversation },
    activeTarget: TARGET,
    activeThreadId: null,
    selectedThreadRecord: null,
    currentComposerTextRef: draft,
    queryClient,
    reportHostError: (error: unknown, options?: unknown) => { reports.push(error); reportOptions.push(options); },
    setSubmittingThreadId: () => {},
    setFooterHostState: () => {},
    setBundleCache: () => {},
    syncSelectionToThread: () => {},
    setSelectionForAgentHandle: () => {},
    t: (key: string) => key,
    submissionPersistence: controller,
  };
  return {
    draft,
    sent,
    reports,
    reportOptions,
    copying,
    pending: () => pending,
    document: () => document,
    subscriptions: () => subscriptions,
    interrupts: () => interrupts,
    submit: async (retryOfTurnId?: string) => {
      const submittedRevision = revision;
      await submitAgentConversationTurn({
        hostInput: hostInput as never,
        payload: {
          text: draft.current,
          attachments: [],
          retryOfTurnId,
          canUpdateDraft: () => revision === submittedRevision,
        },
        submittingLockTokenRef: { current: 0 },
      });
    },
    close: () => {
      controller.close();
      queryClient.clear();
    },
  };
}

test('Send waits for its saved copy and never creates another response stream or cancels old media', async (t) => {
  const hold = deferred();
  const h = await harness({ holdCopy: hold });
  t.after(h.close);
  const sending = h.submit();
  await h.copying.promise;
  assert.equal(h.draft.current, 'original question');
  assert.equal(h.sent.length, 0);
  hold.resolve();
  await sending;
  assert.equal(h.sent.length, 1);
  assert.equal(h.subscriptions(), 0);
  assert.equal(h.interrupts(), 0);
  assert.equal(h.draft.current, '');
  assert.equal(h.pending(), null);
});

test('lost admission reply retains the original request copy without an automatic resend', async (t) => {
  const h = await harness({ loseAck: true });
  t.after(h.close);
  await assert.rejects(h.submit());
  assert.equal(h.sent.length, 1);
  assert.equal(h.pending()?.text, 'original question');
  assert.equal(h.pending()?.requestId, (h.sent[0] as { requestId: string }).requestId);
  assert.equal(h.reports.length, 1);
});

test('failed local copy leaves input intact and does not call Runtime', async (t) => {
  const h = await harness({ failSave: true });
  t.after(h.close);
  await assert.rejects(h.submit());
  assert.equal(h.sent.length, 0);
  assert.equal(h.pending(), null);
  assert.equal(h.draft.current, 'original question');
  assert.deepEqual(h.reportOptions, [{ inlineOnly: true }]);
});

test('new edits made while saving the submission are kept', async (t) => {
  const hold = deferred();
  const h = await harness({ holdCopy: hold });
  t.after(h.close);
  const sending = h.submit();
  await h.copying.promise;
  h.draft.current = 'next question';
  hold.resolve();
  await sending;
  assert.equal(h.draft.current, 'next question');
  assert.equal((h.sent[0] as { parts: { text: string }[] }).parts[0]?.text, 'original question');
});

test('regeneration sends only the original-attempt reference and a new correlation', async (t) => {
  const h = await harness();
  t.after(h.close);
  await h.submit('failed-attempt');
  const sent = h.sent[0] as Record<string, unknown>;
  assert.equal(sent.retryOfTurnId, 'failed-attempt');
  assert.equal('parts' in sent, false);
});

test('an explicit pre-admission busy rejection does not leave an ambiguous receipt to recover', async (t) => {
  const h = await harness({ busy: true });
  t.after(h.close);
  await assert.rejects(h.submit());
  assert.equal(h.sent.length, 1);
  assert.equal(h.pending(), null);
});


test('regeneration reaches Runtime with the same recoverable ID despite Home write failure', async (t) => {
  const h=await harness({failSave:true,loseAck:true}); t.after(h.close);
  await assert.rejects(h.submit('failed-attempt'));
  assert.equal(h.sent.length,1);
  assert.equal(h.pending()?.requestId,(h.sent[0] as {requestId:string}).requestId);
  assert.equal(h.pending()?.retryOfTurnId,'failed-attempt');
});


test('image admission clears its original attachment after navigation, but rejection keeps it', async () => {
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { bindAgentComposerAttachments, acknowledgeAgentComposerAttachments } = await import('../src/shell/renderer/features/chat/chat-agent-composer-draft.js');
  const { readFileSync } = await import('node:fs');
  for (const rejected of [false, true]) {
    const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
    const file = new File([readFileSync(new URL('../src/shell/renderer/assets/logo.png', import.meta.url))], 'logo.png', { type: 'image/png' });
    const attachment = { kind: 'image' as const, file, name: file.name, previewUrl: URL.createObjectURL(file) };
    store.getState().setAgentComposerAttachments('account', 'thread-a', [attachment]);
    const entered = deferred(), receipt = deferred();
    const queryClient = new QueryClient();
    const conversation = {
      open: async () => ({ conversationAnchorId: 'anchor-1' }),
      uploadAttachment: async () => ({ artifactId: 'uploaded-image' }),
      send: async () => { entered.resolve(); await receipt.promise; if (rejected) throw new Error('rejected'); return { turnId: 'accepted' }; },
    };
    let mounted = true;
    const sending = submitAgentConversationTurn({
      hostInput: { now: Date.now, sdk: { conversation: () => conversation }, activeTarget: TARGET,
        activeThreadId: 'thread-a', selectedThreadRecord: null, currentComposerTextRef: { current: 'image' },
        queryClient, syncSelectionToThread() {}, setSubmittingThreadId() {}, setFooterHostState() {}, reportHostError() {},
        submissionPersistence: { prepare: async () => {}, acknowledge: async () => {} }, t: (key: string) => key,
        bindAttachments: (requestId: string, items: readonly typeof attachment[]) => bindAgentComposerAttachments(store, 'account', 'thread-a', requestId, items),
        acknowledgeAttachments: (requestId: string) => acknowledgeAgentComposerAttachments(store, 'account', 'thread-a', requestId),
      } as never,
      payload: { text: 'image', attachments: [attachment], canUpdateDraft: () => mounted },
      submittingLockTokenRef: { current: 0 },
    });
    const outcome = sending.then(() => null, error => error);
    await entered.promise;
    mounted = false; // The actual asynchronous receipt outlives its composer.
    receipt.resolve();
    assert.equal(Boolean(await outcome), rejected);
    assert.equal(store.getState().agentComposerAttachments['account\u0000thread-a']?.length ?? 0, rejected ? 1 : 0);
    store.getState().clearAuthSession(); queryClient.clear();
  }
});
