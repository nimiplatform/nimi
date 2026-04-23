import { describe, expect, it } from 'vitest';
import type { ReminderKind } from '../knowledge-base/index.js';
import {
  ProgressionViolationError,
  applyTransition,
  currentProgressionState,
  isActionAdmissibleForKind,
  type ProgressionContext,
  type ReminderActionCommand,
} from './reminder-progression.js';

function makeContext(overrides: Partial<ProgressionContext> & { kind: ReminderKind }): ProgressionContext {
  return {
    kind: overrides.kind,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    reflectedAt: overrides.reflectedAt ?? null,
    practiceStartedAt: overrides.practiceStartedAt ?? null,
    practiceLastAt: overrides.practiceLastAt ?? null,
    practiceCount: overrides.practiceCount ?? 0,
    practiceHabituatedAt: overrides.practiceHabituatedAt ?? null,
    consultedAt: overrides.consultedAt ?? null,
    consultationConversationId: overrides.consultationConversationId ?? null,
    completedAt: overrides.completedAt ?? null,
    notApplicable: overrides.notApplicable ?? 0,
  };
}

const NOW = '2026-04-23T10:00:00.000Z';
const LATER = '2026-04-25T10:00:00.000Z';

describe('isActionAdmissibleForKind (PO-REMI-005)', () => {
  const cases: Array<{ kind: ReminderKind; admits: ReminderActionCommand['type'][]; rejects: ReminderActionCommand['type'][] }> = [
    {
      kind: 'task',
      admits: ['complete', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule'],
      rejects: ['acknowledge', 'reflect', 'start_practicing', 'log_practice', 'mark_habituated', 'open_advisor'],
    },
    {
      kind: 'guide',
      admits: ['acknowledge', 'reflect', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule'],
      rejects: ['complete', 'start_practicing', 'log_practice', 'mark_habituated', 'open_advisor'],
    },
    {
      kind: 'practice',
      admits: ['start_practicing', 'log_practice', 'mark_habituated', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule'],
      rejects: ['complete', 'acknowledge', 'reflect', 'open_advisor'],
    },
    {
      kind: 'consult',
      admits: ['open_advisor', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule'],
      rejects: ['complete', 'acknowledge', 'reflect', 'start_practicing', 'log_practice', 'mark_habituated'],
    },
  ];

  for (const { kind, admits, rejects } of cases) {
    it(`${kind}: admits ${admits.length} actions and rejects ${rejects.length}`, () => {
      for (const action of admits) expect(isActionAdmissibleForKind(kind, action)).toBe(true);
      for (const action of rejects) expect(isActionAdmissibleForKind(kind, action)).toBe(false);
    });
  }
});

describe('applyTransition — task (PO-REMI-003.task)', () => {
  it('complete writes completedAt and flips status to completed', () => {
    const diff = applyTransition(makeContext({ kind: 'task' }), { type: 'complete' }, NOW);
    expect(diff.status).toBe('completed');
    expect(diff.completedAt).toBe(NOW);
    expect(diff.acknowledgedAt).toBeNull();
  });
});

describe('applyTransition — guide (PO-REMI-003.guide)', () => {
  it('acknowledge writes acknowledgedAt without touching completedAt', () => {
    const diff = applyTransition(makeContext({ kind: 'guide' }), { type: 'acknowledge' }, NOW);
    expect(diff.status).toBe('completed');
    expect(diff.acknowledgedAt).toBe(NOW);
    expect(diff.completedAt).toBeNull();
  });

  it('reflect after acknowledge writes reflectedAt, keeps acknowledgedAt', () => {
    const diff = applyTransition(
      makeContext({ kind: 'guide', acknowledgedAt: NOW }),
      { type: 'reflect' },
      LATER,
    );
    expect(diff.reflectedAt).toBe(LATER);
    expect(diff.acknowledgedAt).toBe(NOW);
  });

  it('reflect without prior acknowledge is fail-close (PO-REMI-004)', () => {
    expect(() =>
      applyTransition(makeContext({ kind: 'guide' }), { type: 'reflect' }, NOW),
    ).toThrow(ProgressionViolationError);
  });
});

describe('applyTransition — practice (PO-REMI-003.practice, PO-REMI-008)', () => {
  it('start_practicing writes practiceStartedAt + practiceLastAt + increments count', () => {
    const diff = applyTransition(makeContext({ kind: 'practice' }), { type: 'start_practicing' }, NOW);
    expect(diff.practiceStartedAt).toBe(NOW);
    expect(diff.practiceLastAt).toBe(NOW);
    expect(diff.practiceCount).toBe(1);
    expect(diff.status).toBe('active');
    expect(diff.completedAt).toBeNull();
  });

  it('log_practice is cyclic: increments count and updates practiceLastAt', () => {
    const diff = applyTransition(
      makeContext({ kind: 'practice', practiceStartedAt: NOW, practiceLastAt: NOW, practiceCount: 3 }),
      { type: 'log_practice' },
      LATER,
    );
    expect(diff.practiceStartedAt).toBe(NOW);
    expect(diff.practiceLastAt).toBe(LATER);
    expect(diff.practiceCount).toBe(4);
    expect(diff.status).toBe('active');
  });

  it('log_practice without practiceStartedAt is fail-close (PO-REMI-008)', () => {
    expect(() =>
      applyTransition(makeContext({ kind: 'practice' }), { type: 'log_practice' }, NOW),
    ).toThrow(ProgressionViolationError);
  });

  it('mark_habituated writes practiceHabituatedAt and flips to completed', () => {
    const diff = applyTransition(
      makeContext({ kind: 'practice', practiceStartedAt: NOW, practiceCount: 5 }),
      { type: 'mark_habituated' },
      LATER,
    );
    expect(diff.practiceHabituatedAt).toBe(LATER);
    expect(diff.status).toBe('completed');
  });

  it('mark_habituated without practiceStartedAt is fail-close (PO-REMI-004)', () => {
    expect(() =>
      applyTransition(makeContext({ kind: 'practice' }), { type: 'mark_habituated' }, NOW),
    ).toThrow(ProgressionViolationError);
  });

  it('start_practicing on a habituated rule is fail-close (must restore first)', () => {
    expect(() =>
      applyTransition(
        makeContext({ kind: 'practice', practiceStartedAt: NOW, practiceHabituatedAt: LATER }),
        { type: 'start_practicing' },
        LATER,
      ),
    ).toThrow(ProgressionViolationError);
  });
});

describe('applyTransition — consult (PO-REMI-003.consult, PO-REMI-007)', () => {
  it('open_advisor writes no progression state (routing-only)', () => {
    const context = makeContext({ kind: 'consult' });
    const diff = applyTransition(context, { type: 'open_advisor' }, NOW);
    expect(diff.consultedAt).toBeNull();
    expect(diff.consultationConversationId).toBeNull();
    expect(diff.status).toBe('active');
  });

  it('open_advisor preserves prior consultation state if already consulted', () => {
    const context = makeContext({
      kind: 'consult',
      consultedAt: NOW,
      consultationConversationId: 'conv-1',
    });
    const diff = applyTransition(context, { type: 'open_advisor' }, LATER);
    expect(diff.consultedAt).toBe(NOW);
    expect(diff.consultationConversationId).toBe('conv-1');
  });
});

describe('applyTransition — shared actions', () => {
  it('restore wipes all progression columns (hard reset)', () => {
    const context = makeContext({
      kind: 'practice',
      practiceStartedAt: NOW,
      practiceLastAt: LATER,
      practiceCount: 10,
      practiceHabituatedAt: LATER,
    });
    const diff = applyTransition(context, { type: 'restore' }, LATER);
    expect(diff.practiceStartedAt).toBeNull();
    expect(diff.practiceLastAt).toBeNull();
    expect(diff.practiceCount).toBe(0);
    expect(diff.practiceHabituatedAt).toBeNull();
    expect(diff.consultedAt).toBeNull();
    expect(diff.consultationConversationId).toBeNull();
    expect(diff.completedAt).toBeNull();
    expect(diff.acknowledgedAt).toBeNull();
    expect(diff.reflectedAt).toBeNull();
    expect(diff.notApplicable).toBe(0);
    expect(diff.status).toBe('pending');
  });

  it('mark_not_applicable flips the flag without clearing progression', () => {
    const context = makeContext({ kind: 'guide', acknowledgedAt: NOW });
    const diff = applyTransition(context, { type: 'mark_not_applicable' }, LATER);
    expect(diff.notApplicable).toBe(1);
    // acknowledgedAt retained — mark_not_applicable hides the row, does not retract evidence.
    expect(diff.acknowledgedAt).toBe(NOW);
  });

  it('complete on non-task kind rejected at admissibility layer', () => {
    expect(() =>
      applyTransition(makeContext({ kind: 'guide' }), { type: 'complete' }, NOW),
    ).toThrow(ProgressionViolationError);
  });
});

describe('currentProgressionState', () => {
  it('task: pristine → due', () => {
    expect(currentProgressionState(makeContext({ kind: 'task' }))).toBe('due');
  });

  it('task: completedAt set → completed', () => {
    expect(currentProgressionState(makeContext({ kind: 'task', completedAt: NOW }))).toBe('completed');
  });

  it('guide: acknowledgedAt only → acknowledged', () => {
    expect(currentProgressionState(makeContext({ kind: 'guide', acknowledgedAt: NOW }))).toBe('acknowledged');
  });

  it('guide: reflectedAt present → reflected', () => {
    expect(
      currentProgressionState(makeContext({ kind: 'guide', acknowledgedAt: NOW, reflectedAt: LATER })),
    ).toBe('reflected');
  });

  it('practice: started only → practicing', () => {
    expect(
      currentProgressionState(makeContext({ kind: 'practice', practiceStartedAt: NOW, practiceCount: 2 })),
    ).toBe('practicing');
  });

  it('practice: habituated → habituated', () => {
    expect(
      currentProgressionState(
        makeContext({ kind: 'practice', practiceStartedAt: NOW, practiceHabituatedAt: LATER }),
      ),
    ).toBe('habituated');
  });

  it('consult: consultedAt + conversationId → consulted', () => {
    expect(
      currentProgressionState(
        makeContext({ kind: 'consult', consultedAt: NOW, consultationConversationId: 'conv-1' }),
      ),
    ).toBe('consulted');
  });

  it('consult: consultedAt without conversationId falls back to due (PO-REMI-004 atomicity)', () => {
    expect(
      currentProgressionState(makeContext({ kind: 'consult', consultedAt: NOW })),
    ).toBe('due');
  });

  it('notApplicable overrides everything', () => {
    expect(
      currentProgressionState(
        makeContext({ kind: 'guide', acknowledgedAt: NOW, notApplicable: 1 }),
      ),
    ).toBe('not_applicable');
  });
});
