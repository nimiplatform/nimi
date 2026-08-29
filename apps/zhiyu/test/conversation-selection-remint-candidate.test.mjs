import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadCandidate() {
  const output = buildSync({
    entryPoints: [path.join(root, 'src/shell/agent/conversation-selection-remint-candidate.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function reference(agentHandle, displayName = 'Partner') {
  return { agentHandle, displayName, avatarUrl: null };
}

function snapshot(conversationAnchorId) {
  return {
    conversationAnchorId,
    throughSequence: '1',
    turns: [],
    messages: [],
    actions: [],
    voices: [],
    truncatedBefore: false,
  };
}

function selectorMismatch() {
  return Object.assign(new Error('selector mismatch'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
}

test('remints a rotated handle only by exact durable Conversation anchor proof', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  const calls = [];
  const result = await remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [
      reference('agent_ref_current_a', 'Same display name'),
      reference('agent_ref_current_b', 'Same display name'),
    ],
    conversation: {
      async snapshot(input) {
        calls.push(input);
        if (input.agentHandle === 'agent_ref_current_b') return snapshot(input.conversationAnchorId);
        throw selectorMismatch();
      },
    },
  });
  assert.deepEqual(result, {
    outcome: 'reminted',
    agentHandle: 'agent_ref_current_b',
    conversationAnchorId: 'anchor-durable-1',
  });
  assert.deepEqual(calls, [
    { agentHandle: 'agent_ref_current_a', conversationAnchorId: 'anchor-durable-1' },
    { agentHandle: 'agent_ref_current_b', conversationAnchorId: 'anchor-durable-1' },
  ]);
  assert.deepEqual(Object.keys(result).sort(), ['agentHandle', 'conversationAnchorId', 'outcome']);
});

test('requires explicit reselection when no current handle owns the durable anchor', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  const result = await remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a'), reference('agent_ref_current_b')],
    conversation: { async snapshot() { throw selectorMismatch(); } },
  });
  assert.deepEqual(result, {
    outcome: 'selection-required',
    reasonCode: 'zhiyu-conversation-selection-remint-not-found',
    actionHint: 'select_runtime_local_agent',
  });
});

test('does not hide an owner or transport failure behind selector mismatch', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  const calls = [];
  const failure = Object.assign(new Error('Runtime unavailable'), { reasonCode: 'RUNTIME_UNAVAILABLE' });
  await assert.rejects(() => remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a'), reference('agent_ref_current_b')],
    conversation: {
      async snapshot(input) {
        calls.push(input.agentHandle);
        if (input.agentHandle === 'agent_ref_current_a') throw failure;
        return snapshot(input.conversationAnchorId);
      },
    },
  }), (error) => error === failure);
  assert.deepEqual(calls, ['agent_ref_current_a', 'agent_ref_current_b']);
});

test('fails closed on duplicate handles, mismatched projection, or ambiguous anchor ownership', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  let calls = 0;
  await assert.rejects(() => remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a'), reference('agent_ref_current_a')],
    conversation: { async snapshot() { calls++; return snapshot('anchor-durable-1'); } },
  }), (error) => error.code === 'ZHIYU_CONVERSATION_REMINT_INPUT_INVALID');
  assert.equal(calls, 0);

  await assert.rejects(() => remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a')],
    conversation: { async snapshot() { return snapshot('anchor-other'); } },
  }), (error) => error.code === 'ZHIYU_CONVERSATION_REMINT_PROJECTION_INVALID');

  await assert.rejects(() => remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a'), reference('agent_ref_current_b')],
    conversation: { async snapshot(input) { return snapshot(input.conversationAnchorId); } },
  }), (error) => error.code === 'ZHIYU_CONVERSATION_REMINT_AMBIGUOUS');
});

test('fences a late remint result after the protected session changes', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  let current = true;
  await assert.rejects(() => remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [reference('agent_ref_current_a')],
    isCurrent: () => current,
    conversation: {
      async snapshot(input) {
        current = false;
        return snapshot(input.conversationAnchorId);
      },
    },
  }), (error) => error.code === 'ZHIYU_CONVERSATION_REMINT_STALE');
});

test('keeps current-session handles and ignores raw or display sidebands', async () => {
  const { remintZhiyuConversationSelectionCandidate } = await loadCandidate();
  const result = await remintZhiyuConversationSelectionCandidate({
    previousConversationAnchorId: 'anchor-durable-1',
    currentReferences: [{
      ...reference('agent_ref_current_a', 'Untrusted ordering label'),
      ownerUserId: 'must-not-project',
      runtimeSourceRef: 'must-not-project',
      localAgentRef: 'must-not-project',
    }],
    conversation: { async snapshot(input) { return snapshot(input.conversationAnchorId); } },
  });
  assert.deepEqual(result, {
    outcome: 'reminted',
    agentHandle: 'agent_ref_current_a',
    conversationAnchorId: 'anchor-durable-1',
  });
  assert.doesNotMatch(JSON.stringify(result), /ownerUserId|runtimeSourceRef|localAgentRef|displayName/u);
});
