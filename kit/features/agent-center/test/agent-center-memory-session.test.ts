import { describe, expect, it } from 'vitest';
import { sessionFor } from './session-fixture.js';

describe('Agent Center Memory Manager Session', () => {
  it('projects owner results for enable, correction, forget, and delete-all', async () => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome: 'unconfigured', enabled: false, adoptionRequired: true,
        items: [{
          memoryId: 'memory-1', content: 'The user prefers tea', epistemicStatus: 'explicit', lifecycle: 'current',
          occurredAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-27T10:00:00Z', sourceExplanation: 'Committed user message',
        }, {
          memoryId: 'memory-2', content: 'The user likes quiet mornings', epistemicStatus: 'explicit', lifecycle: 'current',
          occurredAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-27T10:00:00Z', sourceExplanation: 'Committed user message',
        }],
        currentCount: 2, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
      },
    });
    expect(session.getSnapshot().availability.inspectMemory.state).toBe('available');
    expect(session.getSnapshot().availability.correctMemory).toMatchObject({
      state: 'unavailable', reason: 'selection-required',
    });

    const enabled = await session.setMemoryEnabled(true);
    expect(enabled).toMatchObject({ outcome: 'committed', affectedMemoryIds: [] });
    expect(session.getSnapshot().state.cognition.memory).toMatchObject({ enabled: true, adoptionRequired: false });
    expect(session.getSnapshot().availability.correctMemory.state).toBe('available');

    const corrected = await session.correctMemory({ memoryId: 'memory-1', correctedContent: 'The user prefers coffee' });
    expect(corrected).toMatchObject({ outcome: 'committed', affectedMemoryIds: ['memory-1'] });
    expect(session.getSnapshot().state.cognition.memory?.items[0]?.content).toBe('The user prefers coffee');

    const forgotten = await session.forgetMemory({ memoryIds: ['memory-1'], confirmed: true });
    expect(forgotten).toMatchObject({ outcome: 'forgotten', affectedMemoryIds: ['memory-1'] });
    expect(session.getSnapshot().state.cognition.memory).toMatchObject({
      outcome: 'forgotten', forgottenCount: 1, currentCount: 1,
    });
    expect(JSON.stringify(session.getSnapshot().state.cognition.memory)).not.toContain('The user prefers coffee');

    const deleted = await session.deleteAllMemory({ confirmed: true });
    expect(deleted).toMatchObject({ outcome: 'deleted', affectedMemoryIds: [] });
    expect(session.getSnapshot().state.cognition.memory).toMatchObject({ outcome: 'deleted', currentCount: 0, items: [] });
  });
});
