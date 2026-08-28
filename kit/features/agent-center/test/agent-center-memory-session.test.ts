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
        }],
        currentCount: 1, supersededCount: 0, forgottenCount: 0,
      },
    });
    expect(session.getSnapshot().availability.inspectMemory.state).toBe('available');
    expect(session.getSnapshot().availability.correctMemory.state).toBe('available');

    await session.setMemoryEnabled(true);
    expect(session.getSnapshot().state.cognition.memory).toMatchObject({ enabled: true, adoptionRequired: false });

    await session.correctMemory({ memoryId: 'memory-1', correctedContent: 'The user prefers coffee' });
    expect(session.getSnapshot().state.cognition.memory?.items[0]?.content).toBe('The user prefers coffee');

    await session.forgetMemory({ memoryIds: ['memory-1'], confirmed: true });
    expect(session.getSnapshot().state.cognition.memory?.items[0]?.lifecycle).toBe('forgotten');

    await session.deleteAllMemory({ confirmed: true });
    expect(session.getSnapshot().state.cognition.memory).toMatchObject({ outcome: 'deleted', currentCount: 0, items: [] });
  });
});
