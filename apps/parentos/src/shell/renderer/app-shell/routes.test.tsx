// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

vi.mock('../features/timeline/timeline-page.js', () => ({
  default: () => <div>TIMELINE_PAGE</div>,
}));

vi.mock('../features/profile/profile-page.js', () => ({
  default: () => <div>PROFILE_PAGE</div>,
}));

vi.mock('../features/profile/health-metric-detail-page.js', () => ({
  default: () => <div>HEALTH_METRIC_DETAIL_PAGE</div>,
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

vi.mock('../features/profile/vision-page.js', () => ({
  default: () => <div>VISION_PAGE</div>,
}));

vi.mock('../features/profile/dental-page.js', () => ({
  default: () => <div>DENTAL_PAGE</div>,
}));

vi.mock('../features/profile/allergy-page.js', () => ({
  default: () => <div>ALLERGY_PAGE</div>,
}));

vi.mock('../features/profile/sleep-page.js', () => ({
  default: () => <div>SLEEP_PAGE</div>,
}));

vi.mock('../features/profile/medical-events-page.js', () => ({
  default: () => <div>MEDICAL_EVENTS_PAGE</div>,
}));

vi.mock('../features/profile/posture-page.js', () => ({
  default: () => <div>POSTURE_PAGE</div>,
}));

vi.mock('../features/profile/tanner-page.js', () => ({
  default: () => <div>TANNER_PAGE</div>,
}));

vi.mock('../features/profile/fitness-page.js', () => ({
  default: () => <div>FITNESS_PAGE</div>,
}));

vi.mock('../features/outdoor/outdoor-page.js', () => ({
  OutdoorPage: () => <div>OUTDOOR_PAGE</div>,
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

interface RouteAuthorityRow {
  path: string;
  parent?: string;
  redirectTarget?: string;
  surfaceKind?: string;
}

const routeAuthority = parseYaml(
  readFileSync('spec/kernel/tables/routes.yaml', 'utf-8'),
) as { routes: RouteAuthorityRow[] };

const routeMarkers: Record<string, string> = {
  '/profile/health/growth.height': 'HEALTH_METRIC_DETAIL_PAGE',
  '/profile/growth': 'GROWTH_CURVE_PAGE',
  '/profile/milestones': 'MILESTONE_PAGE',
  '/profile/vaccines': 'VACCINE_PAGE',
  '/profile/vision': 'VISION_PAGE',
  '/profile/dental': 'DENTAL_PAGE',
  '/profile/allergies': 'ALLERGY_PAGE',
  '/profile/sleep': 'SLEEP_PAGE',
  '/profile/medical-events': 'MEDICAL_EVENTS_PAGE',
  '/profile/posture': 'POSTURE_PAGE',
  '/profile/tanner': 'TANNER_PAGE',
  '/profile/fitness': 'FITNESS_PAGE',
  '/profile/outdoor': 'OUTDOOR_PAGE',
};

const admittedProfileDetailRoutes = routeAuthority.routes
  .filter((route) => route.parent === '/profile' && !route.redirectTarget)
  .flatMap((route) => {
    const path = route.path === '/profile/health/:metricId' ? '/profile/health/growth.height' : route.path;
    const marker = routeMarkers[path];
    return marker ? [[path, marker] as const] : [];
  });

const redirectedProfileChildRoutes = routeAuthority.routes
  .filter((route) => route.parent === '/profile' && route.redirectTarget === '/profile')
  .map((route) => route.path);

describe('AppRoutes routing', () => {
  it.each([
    ['/reports', 'REPORTS_PAGE'],
    ['/reminders', 'REMINDERS_PAGE'],
    ['/settings/children', 'CHILDREN_SETTINGS_PAGE'],
    ['/settings/nurture-mode', 'NURTURE_MODE_SETTINGS_PAGE'],
    ['/settings/reminders', 'REMINDER_SETTINGS_PAGE'],
    ['/settings/ai', 'AI_SETTINGS_PAGE'],
  ])('keeps non-profile shell route %s registered', async (entry, marker) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(marker)).toBeTruthy();
    });
  });

  it.each(admittedProfileDetailRoutes)('renders route-table-admitted profile detail route %s', async (entry, marker) => {
    expect(marker).toBeTruthy();

    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(marker)).toBeTruthy();
    });
  });

  it.each(redirectedProfileChildRoutes)('keeps retired profile child shell %s redirected to the health console', async (entry) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('PROFILE_PAGE')).toBeTruthy();
    });
  });
});
