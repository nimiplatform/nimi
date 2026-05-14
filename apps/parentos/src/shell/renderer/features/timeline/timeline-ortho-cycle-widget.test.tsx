// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OrthoCycleProgressWidget } from './timeline-ortho-cycle-widget.js';
import type { OrthoCycleSummary } from './timeline-data-types.js';

const cycle: OrthoCycleSummary = {
  applianceId: 'appl-1',
  currentAlignerIndex: 3,
  totalAligners: 35,
  cycleAnchor: '2026-05-12',
  daysSinceAnchor: 2,
  daysPerAligner: 7,
  daysUntilSwitch: 5,
  predictedSwitchDate: '2026-05-19',
  isFinalAligner: false,
};

describe('OrthoCycleProgressWidget', () => {
  it('renders elapsed cycle segments with the ParentOS success token', () => {
    render(
      <MemoryRouter>
        <OrthoCycleProgressWidget cycle={cycle} />
      </MemoryRouter>,
    );

    expect(screen.getByText('2/7 天')).toBeTruthy();

    const segments = document.querySelectorAll('[aria-hidden="true"] > span');
    expect(segments).toHaveLength(7);
    expect((segments[0] as HTMLElement).style.background).toBe('var(--nimi-status-success)');
    expect((segments[1] as HTMLElement).style.background).toBe('var(--nimi-status-success)');
    expect((segments[2] as HTMLElement).style.background).toBe('rgba(148, 163, 184, 0.25)');
  });
});
