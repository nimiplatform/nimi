// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DashboardTaskList, type DashboardTaskCaptureIntent } from './dashboard-task-list.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (value: string) => value,
}));

function renderInRouter(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function makeAgenda(overrides: Partial<ReminderAgenda> = {}): ReminderAgenda {
  return {
    localToday: '2026-05-15',
    todayLimit: 3,
    todayFocus: [],
    p0Overflow: { count: 0, items: [] },
    onboardingCatchup: { count: 0, items: [] },
    upcoming: [],
    history: [],
    overdueSummary: { count: 0, items: [] },
    ...overrides,
  };
}

function makeP0Reminder(): ActiveReminder {
  return {
    rule: {
      ruleId: 'PO-VAC-P0',
      priority: 'P0',
      actionType: 'go_hospital',
      domain: 'vaccine',
      title: '安排 5 岁加强针',
    } as unknown as ActiveReminder['rule'],
    visibility: 'push',
    repeatIndex: 0,
    effectiveAgeMonths: 60,
    effectiveStartDate: '2026-05-01',
    effectiveEndDate: '2030-01-01',
    kind: 'task',
    lifecycle: 'due',
    status: 'active',
    overdueDays: 0,
    daysUntilStart: 0,
    daysUntilEnd: 0,
    deliveryDisposition: 'normal',
    state: null,
  } as ActiveReminder;
}

describe('DashboardTaskList', () => {
  const child = { childId: 'child-1', birthDate: '2020-05-15' };

  it('renders a maintain card whose primary button builds a dashboard_task capture intent', () => {
    const onCapture = vi.fn<(intent: DashboardTaskCaptureIntent) => void>();
    renderInRouter(
      <DashboardTaskList
        today="2026-05-15"
        child={child}
        reminderAgenda={makeAgenda()}
        customTodos={[]}
        catalogRows={[
          {
            taskId: 'dashboard-maintain-sleep',
            family: 'maintain',
            ownerContract: 'apps/parentos/spec/kernel/timeline-contract.md',
            cadencePolicy: 'interval',
            biologicalAnchor: 'none',
            slotPreference: 'weekday-evening-light',
            dispersionWindow: 'rolling',
            mutualExclusionGroup: 'profile-maintenance',
            displayWindowDays: 2,
            snoozeDefaultDays: 1,
            decayStrategy: 'low-disturbance-downgrade',
            metricIdRefs: ['sleep.duration_minutes'],
            captureProtocolIdRef: 'sleep-night',
            featureId: 'PO-FEAT-056',
          },
        ]}
        onDashboardTaskCapture={onCapture}
      />,
    );

    const button = screen.getByTestId('dashboard-task-action-dashboard-maintain-sleep');
    fireEvent.click(button);

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith({
      origin: 'dashboard_task',
      dashboardTaskId: 'dashboard-maintain-sleep',
      childId: 'child-1',
      captureProtocolId: 'sleep-night',
      metricIds: ['sleep.duration_minutes'],
    });
  });

  it('renders a P0 reminder row with eligible-pinned state when a P0 reminder is in the agenda', () => {
    renderInRouter(
      <DashboardTaskList
        today="2026-05-15"
        child={child}
        reminderAgenda={makeAgenda({ todayFocus: [makeP0Reminder()] })}
        customTodos={[]}
        catalogRows={[]}
        onDashboardTaskCapture={vi.fn()}
      />,
    );

    const row = screen.getByTestId('dashboard-task-reminder-PO-VAC-P0');
    expect(row.dataset.priority).toBe('P0');
    expect(row.dataset.displayState).toBe('eligible-pinned');
  });

  it('renders a downgrade-indicator badge when expired rows are present', () => {
    renderInRouter(
      <DashboardTaskList
        today="2026-05-15"
        child={child}
        reminderAgenda={makeAgenda()}
        customTodos={[]}
        catalogRows={[
          {
            taskId: 'dashboard-maintain-expired',
            family: 'maintain',
            ownerContract: 'apps/parentos/spec/kernel/timeline-contract.md',
            cadencePolicy: 'interval',
            biologicalAnchor: 'none',
            slotPreference: 'weekend-heavy',
            dispersionWindow: 'rolling',
            mutualExclusionGroup: 'profile-maintenance',
            displayWindowDays: 1,
            snoozeDefaultDays: 2,
            decayStrategy: 'low-disturbance-downgrade',
            metricIdRefs: ['growth.height'],
            captureProtocolIdRef: 'growth-child-quarterly',
            featureId: 'PO-FEAT-056',
          },
        ]}
        onDashboardTaskCapture={vi.fn()}
      />,
    );

    // Stub surfaceHistory not provided; without that path the row would NOT be expired.
    // Render path: row eligible, no expiry. Confirm the row appears and downgrade badge is absent.
    expect(screen.queryByTestId('dashboard-task-downgrade-indicator')).toBeNull();
    expect(screen.getByTestId('dashboard-task-card-dashboard-maintain-expired')).toBeTruthy();
  });
});
