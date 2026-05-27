import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'browser.agents' && opts?.count !== undefined) return `${opts.count} agents`;
      if (key === 'browser.marbleReady') return '3D Ready';
      if (key === 'browser.marbleGenerating') return 'Generating...';
      return key;
    },
  }),
}));

const mockStore: {
  marbleJobs: Record<string, { operationId: string | null; status: string; startedAt: number | null }>;
} = {
  marbleJobs: {},
};

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));

import { WorldCard } from './world-card.js';
import type { WorldSummary } from './world-browser-data.js';

function makeWorld(overrides: Partial<WorldSummary> = {}): WorldSummary {
  return {
    id: 'world-1',
    name: 'Test World',
    agentCount: 5,
    ...overrides,
  };
}

describe('WorldCard', () => {
  beforeEach(() => {
    mockStore.marbleJobs = {};
  });

  it('renders world name', () => {
    render(<WorldCard world={makeWorld({ name: 'Arcadia' })} onClick={vi.fn()} />);
    expect(screen.getByText('Arcadia')).toBeDefined();
  });

  it('renders genre and era when present', () => {
    render(
      <WorldCard
        world={makeWorld({ genre: 'Fantasy', era: 'Medieval' })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Fantasy')).toBeDefined();
    expect(screen.getByText('Medieval')).toBeDefined();
  });

  it('renders themes (up to 3)', () => {
    render(
      <WorldCard
        world={makeWorld({ themes: ['Magic', 'War', 'Love', 'Betrayal'] })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Magic')).toBeDefined();
    expect(screen.getByText('War')).toBeDefined();
    expect(screen.getByText('Love')).toBeDefined();
    expect(screen.queryByText('Betrayal')).toBeNull();
  });

  it('renders agent count', () => {
    render(<WorldCard world={makeWorld({ agentCount: 7 })} onClick={vi.fn()} />);
    expect(screen.getByText('7 agents')).toBeDefined();
  });

  it('shows banner image when bannerUrl present', () => {
    render(
      <WorldCard
        world={makeWorld({ bannerUrl: 'https://img.test/banner.jpg', name: 'BannerWorld' })}
        onClick={vi.fn()}
      />,
    );
    const img = screen.getByAltText('BannerWorld') as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toBe('https://img.test/banner.jpg');
  });

  it('shows placeholder when no banner', () => {
    render(
      <WorldCard world={makeWorld({ name: 'Zephyr' })} onClick={vi.fn()} />,
    );
    // Placeholder shows first character uppercased
    expect(screen.getByText('Z')).toBeDefined();
  });

  it('shows "3D Ready" badge when marble status is completed', () => {
    mockStore.marbleJobs = {
      'world-1': { operationId: 'op-1', status: 'completed', startedAt: Date.now() },
    };
    render(<WorldCard world={makeWorld()} onClick={vi.fn()} />);
    expect(screen.getByText('3D Ready')).toBeDefined();
  });

  it('shows "Generating..." badge when marble status is generating', () => {
    mockStore.marbleJobs = {
      'world-1': { operationId: 'op-1', status: 'generating', startedAt: Date.now() },
    };
    render(<WorldCard world={makeWorld()} onClick={vi.fn()} />);
    expect(screen.getByText('Generating...')).toBeDefined();
  });

  it('no marble badge when no job exists', () => {
    render(<WorldCard world={makeWorld()} onClick={vi.fn()} />);
    expect(screen.queryByText('3D Ready')).toBeNull();
    expect(screen.queryByText('Generating...')).toBeNull();
  });

  it('calls onClick with worldId when clicked', () => {
    const handleClick = vi.fn();
    render(
      <WorldCard world={makeWorld({ id: 'w-42' })} onClick={handleClick} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledOnce();
    expect(handleClick).toHaveBeenCalledWith('w-42');
  });
});
