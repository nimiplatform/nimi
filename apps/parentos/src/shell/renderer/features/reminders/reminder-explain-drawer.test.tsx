// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import { ReminderExplainDrawer } from './reminder-explain-drawer.js';

function makeReminder(): ActiveReminder {
  return {
    rule: {
      ruleId: 'PO-REM-TEST-GUIDE',
      domain: 'relationship',
      category: 'stage',
      kind: 'guide',
      title: '青春期前关键储备：练习最后说话',
      description: '9-12 岁开始练习：孩子说完一件事后，忍住不马上评价。',
      triggerAge: { startMonths: 108, endMonths: 144 },
      priority: 'P1',
      nurtureMode: { relaxed: 'push', balanced: 'push', advanced: 'push' },
      actionType: 'read_guide',
      explain: {
        whyNow: '青春期前是练习最后回应的窗口。',
        howTo: ['先放下手机。', '默数三到五秒。', '复述他的重点。'],
        doneWhen: '一周至少两次做到先听完再回应。',
        pitfalls: ['急着纠正。'],
        sources: [{ citation: 'Gordon-PET' }],
      },
    },
    visibility: 'push',
    repeatIndex: 0,
    effectiveAgeMonths: 120,
    effectiveStartDate: '2026-05-01',
    effectiveEndDate: '2026-05-31',
    kind: 'guide',
    lifecycle: 'due',
    status: 'active',
    overdueDays: 0,
    daysUntilStart: 0,
    daysUntilEnd: 7,
    deliveryDisposition: 'normal',
    state: null,
  };
}

describe('ReminderExplainDrawer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders through a viewport-level portal above the shell chrome', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { container } = render(
      <MemoryRouter>
        <ReminderExplainDrawer
          reminder={makeReminder()}
          onClose={vi.fn()}
          onAction={vi.fn()}
          onOpenCapture={vi.fn()}
        />
      </MemoryRouter>,
      { container: host },
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const dialog = screen.getByRole('dialog', { name: '提醒详情：青春期前关键储备：练习最后说话' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('right-0');
    expect(dialog.className).toContain('top-0');
    expect(dialog.className).toContain('z-[100]');

    const overlay = document.body.querySelector('.parentos-reminder-explain-drawer-overlay');
    expect(overlay?.className).toContain('fixed');
    expect(overlay?.className).toContain('inset-0');
    expect(overlay?.className).toContain('z-[90]');
    expect(screen.getByText('指南型')).toBeTruthy();
    expect(screen.getByText('待处理')).toBeTruthy();
  });
});
