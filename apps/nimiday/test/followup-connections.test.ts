import { describe, expect, it } from 'vitest';
import { affectedFollowUps } from '../src/nimiday/followup/connection-state.js';
import type { FollowUp, FollowUpSnapshot } from '../src/nimiday/followup/engine.js';

const arrangement = (id: string, state: FollowUp['state'] = 'waiting') => ({
  id, state, targetRef: 'original', agentBinding: 'assigned',
}) as FollowUp;
const target = (targetRef = 'original', available = true, permittedOperations = ['telegram.sendMessage', 'telegram.updates.read']): FollowUpSnapshot['targets'][number] => ({
  targetRef, available, permittedOperations, kind: 'telegram',
  integrationId: 'telegram', displayName: 'Telegram', accountLabel: targetRef, skill: '', operations: [],
});
const snapshot = (patch: Partial<FollowUpSnapshot> = {}): FollowUpSnapshot => ({
  ready: true, error: '', arrangements: [arrangement('ongoing')], targets: [target()],
  agents: [{ agentBinding: 'assigned' } as FollowUpSnapshot['agents'][number]], ...patch,
});

describe('follow-up connection impact', () => {
  it('does not turn first-time setup, loading, or finished work into a runtime warning', () => {
    expect(affectedFollowUps(null)).toEqual([]);
    expect(affectedFollowUps(snapshot({ ready: false, targets: [] }))).toEqual([]);
    expect(affectedFollowUps(snapshot({ arrangements: [], targets: [], agents: [] }))).toEqual([]);
    expect(affectedFollowUps(snapshot({ arrangements: [arrangement('done', 'completed'), arrangement('ended', 'stopped')], targets: [], agents: [] }))).toEqual([]);
    expect(affectedFollowUps(snapshot())).toEqual([]);
  });

  it('checks the bound account rather than accepting an unrelated available account', () => {
    expect(affectedFollowUps(snapshot({ targets: [target('other')] })).map(item => item.id)).toEqual(['ongoing']);
    expect(affectedFollowUps(snapshot({ targets: [target('original', false), target('other')] })).map(item => item.id)).toEqual(['ongoing']);
    expect(affectedFollowUps(snapshot({ targets: [target('original', true, ['telegram.sendMessage'])] })).map(item => item.id)).toEqual(['ongoing']);
  });

  it('checks the assigned assistant and retains interrupted work in the impact list', () => {
    const before = snapshot({ arrangements: [arrangement('paused', 'interrupted')], agents: [{ agentBinding: 'other' } as FollowUpSnapshot['agents'][number]] });
    expect(affectedFollowUps(before).map(item => item.id)).toEqual(['paused']);
    expect(affectedFollowUps({ ...before, agents: snapshot().agents })).toEqual([]);
    expect(before.arrangements[0]?.state).toBe('interrupted');
  });
});
