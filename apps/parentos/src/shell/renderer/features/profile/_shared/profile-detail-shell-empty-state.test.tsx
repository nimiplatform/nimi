// @vitest-environment jsdom
//
// Integration evidence for the wave-2 / wave-3 / wave-4 / wave-5 unification
// of the "no active child" empty state across profile detail pages.
//
// Every migrated page that has a hard `if (!child)` branch must:
//   1. wrap the placeholder in `<ProfileDetailShell title="...">` so the
//      back-link affordance stays visible (no stranded empty screens), and
//   2. render the placeholder through `NoActiveChildPlaceholder` so the
//      "请先添加孩子" copy + helper-text styling is centralized.
//
// These assertions are the jsdom-equivalent of the browser visual-evidence
// requirement in preflight.md#Visual Verification: the parentos renderer
// runs inside a Tauri host (vite-only preview crashes on `invoke`), so the
// shell-composition contract is verified through real DOM rendering here.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '../../../app-shell/app-store.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));

vi.mock('../../../i18n/index.js', () => ({
  i18n: { t: (key: string) => key },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'Profile.rich.common.addChildFirst') return '请先添加孩子';
      if (key === 'Profile.rich.common.backToProfile') return '返回档案';
      if (key === 'Profile.rich.growth.title') return '生长曲线';
      return options?.defaultValue ?? key;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Cases are filled in per wave so a partially-migrated tree is honestly
// represented: each wave that adopts the dental empty-state shape extends
// this list (or its own block) when the wave closes. As of wave-2 close, the
// 8 standard detail pages share one envelope.
const cases: Array<{ slug: string; title: string; loader: () => Promise<{ default: React.ComponentType }> }> = [
  { slug: 'sleep', title: '睡眠记录', loader: () => import('../sleep-page.js') },
  { slug: 'fitness', title: '体能评估', loader: () => import('../fitness-page.js') },
  { slug: 'allergy', title: '过敏记录', loader: () => import('../allergy-page.js') },
  { slug: 'milestone', title: '发育里程碑', loader: () => import('../milestone-page.js') },
  { slug: 'tanner', title: '青春期发育评估', loader: () => import('../tanner-page.js') },
  { slug: 'medical-events', title: '就医记录', loader: () => import('../medical-events-page.js') },
  { slug: 'vaccine', title: '疫苗接种', loader: () => import('../vaccine-page.js') },
  { slug: 'posture', title: '体态档案', loader: () => import('../posture-page.js') },
  // wave-3
  { slug: 'report-history', title: '单据记录', loader: () => import('../report-history-page.js') },
  { slug: 'report-upload', title: '智能识别 & 影像档案', loader: () => import('../report-upload-page.js') },
  // wave-4
  { slug: 'growth-curve', title: '生长曲线', loader: () => import('../growth-curve-page.js') },
  { slug: 'vision', title: '视力档案', loader: () => import('../vision-page.js') },
  // wave-5
  { slug: 'dental', title: '口腔档案', loader: () => import('../dental-page.js') },
];

describe('profile detail pages: no-active-child empty state', () => {
  beforeEach(() => {
    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'family-1',
      activeChildId: null,
      children: [],
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      bootstrapReady: false,
      familyId: null,
      activeChildId: null,
      children: [],
    });
  });

  it.each(cases)('$slug renders ProfileDetailShell + NoActiveChildPlaceholder', async ({ title, loader }) => {
    const mod = await loader();
    const Page = mod.default;
    render(
      <TooltipProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </TooltipProvider>,
    );

    // ProfileDetailShell envelope: kit page-detail-layout with back row + title
    const layout = document.querySelector('.nimi-page-detail-layout');
    expect(layout).not.toBeNull();
    expect(layout?.querySelector('.nimi-page-detail-layout__back-row')).not.toBeNull();
    expect(layout?.querySelector('.nimi-back-link')).not.toBeNull();

    // The back link must point to /profile (router-aware via BackLink asChild)
    const backHref = layout?.querySelector('.nimi-back-link')?.getAttribute('href');
    expect(backHref).toBe('/profile');

    // Page title visible
    expect(screen.getAllByText(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))[0]).toBeTruthy();

    // Default back label
    expect(screen.getAllByText('返回档案')[0]).toBeTruthy();

    // NoActiveChildPlaceholder body
    expect(screen.getByText('请先添加孩子')).toBeTruthy();

    // The shell must wrap the placeholder — placeholder is a descendant of
    // the page-detail-layout body, not a sibling of the layout.
    const placeholder = screen.getByText('请先添加孩子').closest('.nimi-page-detail-layout');
    expect(placeholder).not.toBeNull();
  }, 10000);
});
