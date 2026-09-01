import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  createNimiLocalAppEmbodimentClient,
  type NimiLocalAppEmbodimentShell,
} from './local-app-runtime-platform-embodiment.js';

const HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;

function base(sequence: string) {
  return { sequence, observedAt: { seconds: '1', nanos: 2 }, provenance: 'runtime_agent_owner' };
}

test('canonical embodiment client projects bounded snapshot and ordered events', async () => {
  const calls: unknown[] = [];
  let canceled = false;
  const shell: NimiLocalAppEmbodimentShell = {
    async snapshot(input) {
      calls.push(input);
      return {
        ...base('4'),
        activity: { name: 'thinking', category: 'interaction', intensity: '', source: 'runtime', turnRef: 'turn-1' },
        emotion: { name: 'happy', source: 'runtime' },
        posture: { actionFamily: 'support', interruptMode: 'cautious' },
        voiceTiming: { phase: 'active', durationMillis: 640, deadlineOffsetMillis: 80, turnRef: 'turn-1', correlationRef: 'voice-1' },
      };
    },
    async subscribe(input) {
      calls.push(input);
      return {
        events: (async function* () {
          yield { ...base('5'), kind: 'activity', payload: { name: 'speaking', category: 'interaction', intensity: '', source: 'runtime', turnRef: 'turn-1' } };
          yield { ...base('6'), kind: 'voice-timing', payload: { phase: 'completed', durationMillis: 700, deadlineOffsetMillis: 90, turnRef: 'turn-1', correlationRef: 'voice-1' } };
        }()),
        async cancel() { canceled = true; },
      };
    },
  };
  const client = createNimiLocalAppEmbodimentClient(shell);
  const scope = { agentHandle: HANDLE, conversationAnchorId: 'anchor-1' };
  const snapshot = await client.snapshot(scope);
  assert.equal(snapshot.activity?.name, 'thinking');
  assert.equal(snapshot.voiceTiming?.phase, 'active');
  assert.deepEqual(calls[0], scope);

  const subscription = await client.subscribe({ ...scope, afterSequence: '4' });
  const events = [];
  for await (const event of subscription) events.push(event);
  assert.deepEqual(events.map((event) => [event.sequence, event.kind]), [['5', 'activity'], ['6', 'voice-timing']]);
  assert.deepEqual(calls[1], { ...scope, afterSequence: '4' });
  await subscription.cancel();
  assert.equal(canceled, true);
});

test('canonical embodiment client rejects authority, renderer, raw identity, and unbounded timing', async () => {
  let calls = 0;
  const shell: NimiLocalAppEmbodimentShell = {
    async snapshot() {
      calls++;
      return {
        ...base('1'), activity: null, emotion: null, posture: null,
        voiceTiming: { phase: 'active', durationMillis: 86_400_001, deadlineOffsetMillis: 0, turnRef: 'turn-1', correlationRef: 'voice-1' },
      };
    },
    async subscribe() { throw new Error('not reached'); },
  };
  const client = createNimiLocalAppEmbodimentClient(shell);
  await assert.rejects(() => client.snapshot({
    agentHandle: HANDLE,
    conversationAnchorId: 'anchor-1',
    ownerUserId: 'raw-owner',
  } as never));
  assert.equal(calls, 0);
  await assert.rejects(() => client.snapshot({ agentHandle: HANDLE, conversationAnchorId: 'anchor-1' }));
  assert.equal(calls, 1);

  const rawShell: NimiLocalAppEmbodimentShell = {
    async snapshot() {
      return {
        ...base('2'), activity: null, emotion: null, posture: null, voiceTiming: null,
        rendererCommand: { expression: 'smile' },
      };
    },
    async subscribe() { throw new Error('not reached'); },
  };
  await assert.rejects(() => createNimiLocalAppEmbodimentClient(rawShell).snapshot({
    agentHandle: HANDLE,
    conversationAnchorId: 'anchor-1',
  }));
});

test('canonical embodiment client enforces proto uint64 cursors before transport and projection', async () => {
  const subscribeInputs: unknown[] = [];
  let snapshotSequence = '18446744073709551615';
  const shell: NimiLocalAppEmbodimentShell = {
    async snapshot() {
      return {
        ...base(snapshotSequence),
        activity: null,
        emotion: null,
        posture: null,
        voiceTiming: null,
      };
    },
    async subscribe(input) {
      subscribeInputs.push(input);
      return { events: (async function* () {})(), async cancel() {} };
    },
  };
  const client = createNimiLocalAppEmbodimentClient(shell);
  const scope = { agentHandle: HANDLE, conversationAnchorId: 'anchor-1' };

  await client.subscribe({ ...scope, afterSequence: '18446744073709551615' });
  assert.equal(subscribeInputs.length, 1);
  await assert.rejects(() => client.subscribe({
    ...scope,
    afterSequence: '18446744073709551616',
  }));
  assert.equal(subscribeInputs.length, 1);

  assert.equal((await client.snapshot(scope)).sequence, '18446744073709551615');
  snapshotSequence = '18446744073709551616';
  await assert.rejects(() => client.snapshot(scope));
});
