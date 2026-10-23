import test from 'node:test';
import assert from 'node:assert/strict';
import { retireLocalAgentTurnSidecars, retireDisabledFollowUpPreferences } from './lib/retire-local-agent-turn-sidecars.mjs';

test('retire only known old display sidecars, retaining every canonical field and a no-op on repetition', () => {
  const sidecar = { CanceledHookIDs: ['old-hook'], Message: '', ReasonCode: 0, ScheduledHookID: 'retained-hook', Status: 'applied', StatusText: 'historical projection' };
  const canonical = { conversationAnchorId: 'anchor', version: 19, committedTranscript: [{ text: 'verbatim user and Agent content', memoryRefs: ['memory'] }], lastTurnSnapshot: { text: 'reply', audioUri: 'retained-audio' }, completedTurnSnapshots: { turn: { text: 'reply', sourceHash: 'retained-hash' } } };
  const old = structuredClone(canonical);
  old.lastTurnSnapshot.sidecar = sidecar;
  old.completedTurnSnapshots.turn.sidecar = sidecar;
  const result = retireLocalAgentTurnSidecars(JSON.stringify(old));
  assert.equal(result.removed, 2);
  assert.deepEqual(JSON.parse(result.after), canonical);
  assert.deepEqual(retireLocalAgentTurnSidecars(result.after), { removed: 0, after: result.after });
  assert.equal(old.lastTurnSnapshot.sidecar.StatusText, 'historical projection');
});

test('unknown sidecar content is not silently removed', () => {
  assert.throws(() => retireLocalAgentTurnSidecars(JSON.stringify({ lastTurnSnapshot: { sidecar: { futureContract: 'do not discard' } } })), /Unknown turn sidecar/);
});

test('only retired OFF preferences are removed; conversation and Agent permission are retained', () => {
  const raw = JSON.stringify({ followUpEnabled: false, followUpPolicyRevision: 9, pendingFollowUpId: 'keep-existing-hook', committedTranscript: ['keep history'] });
  const result = retireDisabledFollowUpPreferences(raw);
  assert.equal(result.removed, true);
  assert.deepEqual(JSON.parse(result.after), { pendingFollowUpId: 'keep-existing-hook', committedTranscript: ['keep history'] });
  assert.equal(retireDisabledFollowUpPreferences(result.after).removed, false);
  assert.throws(() => retireDisabledFollowUpPreferences(raw.replace('false', 'true')), /Active or unknown/);
});
