import { describe, expect, it } from 'vitest';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import type { JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { onboardingSteps, type CircleDraft } from '../src/nimiday/ui/onboarding-steps.js';

function memoryDocuments(): JsonDocumentStore {
  const data = new Map<string, unknown>();
  return {
    read: async (path) => (data.has(path) ? structuredClone(data.get(path)) : undefined),
    write: async (path, value) => { data.set(path, structuredClone(value)); },
    remove: async (path) => { data.delete(path); },
  };
}

describe('first-run wizard', () => {
  it('creates the people the user named once, however often they go back and forward', async () => {
    const store = createDayStore(memoryDocuments(), { language: () => 'zh' });
    await store.load();
    const steps = onboardingSteps(dayActions(store));
    const drafts: CircleDraft[] = [
      { key: 'child', kind: 'child', name: '小米' },
      { key: 'self', kind: 'self', name: '我自己' },
      { key: 'blank', kind: 'elder', name: '  ' },
    ];

    // Step 3 "continue", back from step 4, "continue" again: nothing is created yet.
    expect(steps.continueFromCircles(drafts)).toBe(3);
    expect(steps.continueFromCircles(drafts)).toBe(3);
    expect(store.getSnapshot().state.circles).toEqual([]);

    steps.finish(drafts);
    expect(store.getSnapshot().state.circles.map((circle) => circle.name)).toEqual(['小米', '我自己']);
    expect(store.getSnapshot().state.profile.onboarded).toBe(true);
  });

  it('keeps two people of the same name when the user adds both', async () => {
    const store = createDayStore(memoryDocuments(), { language: () => 'zh' });
    await store.load();
    onboardingSteps(dayActions(store)).finish([
      { key: 'first', kind: 'child', name: '宝宝' },
      { key: 'second', kind: 'child', name: '宝宝' },
    ]);
    expect(store.getSnapshot().state.circles.map((circle) => circle.name)).toEqual(['宝宝', '宝宝']);
  });
});
