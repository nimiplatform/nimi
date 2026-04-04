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

vi.mock('../features/journal/journal-page.js', () => ({
  default: () => <div>JOURNAL_PAGE</div>,
}));

vi.mock('../features/advisor/advisor-page.js', () => ({
  default: () => <div>ADVISOR_PAGE</div>,
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

import { AppRoutes } from './routes.js';

describe('AppRoutes routing', () => {
  it('registers /reports as the structured reports surface', async () => {
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('REPORTS_PAGE')).toBeTruthy();
    });
  });

  it('keeps the phase 1 settings subroutes registered', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/children']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('CHILDREN_SETTINGS_PAGE')).toBeTruthy();
    });
  });

  it('keeps nurture-mode settings reachable in phase 1', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/nurture-mode']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('NURTURE_MODE_SETTINGS_PAGE')).toBeTruthy();
    });
  });
});
