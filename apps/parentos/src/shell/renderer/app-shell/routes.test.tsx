// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/timeline/timeline-page.js', () => ({
  default: () => <div>TIMELINE_PAGE</div>,
}));

vi.mock('../features/profile/profile-page.js', () => ({
  default: () => <div>PROFILE_PAGE</div>,
}));

vi.mock('../features/profile/growth-curve-page.js', () => ({
  default: () => <div>GROWTH_CURVE_PAGE</div>,
}));

vi.mock('../features/profile/milestone-page.js', () => ({
  default: () => <div>MILESTONE_PAGE</div>,
}));

vi.mock('../features/profile/vaccine-page.js', () => ({
  default: () => <div>VACCINE_PAGE</div>,
}));

vi.mock('../features/profile/posture-page.js', () => ({
  default: () => <div>POSTURE_PAGE</div>,
}));

vi.mock('../features/journal/journal-page.js', () => ({
  default: () => <div>JOURNAL_PAGE</div>,
}));

vi.mock('../features/advisor/advisor-page.js', () => ({
  default: () => <div>ADVISOR_PAGE</div>,
}));

vi.mock('../features/reminders/reminders-page.js', () => ({
  default: () => <div>REMINDERS_PAGE</div>,
}));

vi.mock('../features/reports/reports-page.js', () => ({
  default: () => <div>REPORTS_PAGE</div>,
}));

vi.mock('../features/settings/settings-page.js', () => ({
  default: () => <div>SETTINGS_PAGE</div>,
}));

vi.mock('../features/settings/children-settings-page.js', () => ({
  default: () => <div>CHILDREN_SETTINGS_PAGE</div>,
}));

vi.mock('../features/settings/nurture-mode-settings-page.js', () => ({
  default: () => <div>NURTURE_MODE_SETTINGS_PAGE</div>,
}));

vi.mock('../features/settings/reminder-settings-page.js', () => ({
  default: () => <div>REMINDER_SETTINGS_PAGE</div>,
}));

vi.mock('../features/settings/ai-settings-page.js', () => ({
  default: () => <div>AI_SETTINGS_PAGE</div>,
}));

import { AppRoutes } from './routes.js';

describe('AppRoutes routing', () => {
  it.each([
    ['/reports', 'REPORTS_PAGE'],
    ['/profile/posture', 'POSTURE_PAGE'],
    ['/reminders', 'REMINDERS_PAGE'],
    ['/settings/children', 'CHILDREN_SETTINGS_PAGE'],
    ['/settings/nurture-mode', 'NURTURE_MODE_SETTINGS_PAGE'],
    ['/settings/reminders', 'REMINDER_SETTINGS_PAGE'],
    ['/settings/ai', 'AI_SETTINGS_PAGE'],
  ])('keeps %s registered in the current router baseline', async (entry, marker) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(marker)).toBeTruthy();
    });
  });
});
