import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { createScopedAgentConversationHostError } from '../src/shell/renderer/features/chat/chat-agent-shell-adapter-host-feedback.js';
import { submitAgentConversationTurn } from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.js';

test('a retired Home submission cannot stop or revoke the current conversation on a late access denial', async () => {
  for (const phase of ['send', 'upload']) {
    let reject!: (error: unknown) => void;
    let started!: () => void;
    const reached = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
    const currentScope = { current: 'account:A:anchor-A:handle-A' };
    const consequences: string[] = [];
    const currentTargets = { current: 'A' };
    const report = createScopedAgentConversationHostError(currentScope.current, currentScope, () => {
      consequences.push(`stop:${currentTargets.current}`, `invalidate:${currentTargets.current}`, `feedback:${currentTargets.current}`, `rebind:${currentTargets.current}`);
    });
    const target = { agentHandle: 'agent-A', conversationAnchorId: 'anchor-A', displayName: 'A', handle: '', avatarUrl: null,
      worldId: null, worldName: null, bio: null, ownershipType: null, greeting: null, builtinDocsContext: null };
    const queryClient = new QueryClient();
    const conversation = {
      open: async () => ({ conversationAnchorId: 'anchor-A' }),
      uploadAttachment: async () => { started(); return pending; },
      send: async () => { started(); return pending; },
    };
    const hostInput = { activeTarget: target, activeThreadId: 'agent-thread:anchor-A',
      selectedThreadRecord: { id: 'agent-thread:anchor-A', targetSnapshot: target },
      sdk: { conversation: () => conversation }, now: Date.now, queryClient, syncSelectionToThread() {},
      setSubmittingThreadId() {}, currentComposerTextRef: { current: 'A draft', revision: 0 },
      submissionPersistence: { prepare: async () => {}, acknowledge: async () => {} },
      reportHostError: report, t: (key: string) => key, setFooterHostState() {},
    } as never;
    const file = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png', { type: 'image/png' });
    const running = submitAgentConversationTurn({ hostInput, submittingLockTokenRef: { current: 0 },
      payload: { text: 'A input', attachments: phase === 'upload' ? [{ kind: 'image', file, name: file.name }] as never : [], canUpdateDraft: () => false } });
    await reached;
    currentScope.current = 'account:B:anchor-B:handle-B';
    currentTargets.current = 'B';
    reject(Object.assign(new Error('Access denied for A'), { reasonCode: 'LOCAL_APP_PERMISSION_DENIED' }));
    await assert.rejects(running);
    assert.equal(consequences.length, 0, phase);
    const currentReport = createScopedAgentConversationHostError(currentScope.current, currentScope, () => consequences.push('current-error'));
    currentReport(new Error('Current B failure'));
    assert.deepEqual(consequences, ['current-error'], 'only the retired operation is fenced');
    queryClient.clear();
  }
});
