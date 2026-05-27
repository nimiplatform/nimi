import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'browser.title': 'My Worlds',
        'browser.searchPlaceholder': 'Search worlds...',
        'browser.empty': 'No worlds found',
        'error.networkError': 'Connection lost.',
        'error.retry': 'Retry',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockUseMyWorldsQuery = vi.fn();
vi.mock('./world-browser-queries.js', () => ({
  useMyWorldsQuery: () => mockUseMyWorldsQuery(),
}));

vi.mock('./world-card.js', () => ({
  WorldCard: ({
    world,
    onClick,
  }: {
    world: { id: string; name: string };
    onClick: (id: string) => void;
  }) => (
    <button data-testid={`world-card-${world.id}`} onClick={() => onClick(world.id)}>
      {world.name}
    </button>
  ),
}));

import { WorldBrowserPage } from './world-browser-page.js';

describe('WorldBrowserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMyWorldsQuery.mockReturnValue({
      data: [
        { id: 'w1', name: 'Eldoria', genre: 'Fantasy', era: 'Medieval', agentCount: 3 },
        { id: 'w2', name: 'Nexus Prime', genre: 'Sci-fi', era: 'Future', agentCount: 5 },
        { id: 'w3', name: 'Shadow Realm', genre: 'Horror', era: 'Modern', agentCount: 2 },
      ],
      isLoading: false,
      error: null,
    });
  });

  it('renders page title', () => {
    render(<WorldBrowserPage />);
    expect(screen.getByText('My Worlds')).toBeDefined();
  });

  it('renders search input', () => {
    render(<WorldBrowserPage />);
    expect(screen.getByPlaceholderText('Search worlds...')).toBeDefined();
  });

  it('renders all world cards', () => {
    render(<WorldBrowserPage />);
    expect(screen.getByText('Eldoria')).toBeDefined();
    expect(screen.getByText('Nexus Prime')).toBeDefined();
    expect(screen.getByText('Shadow Realm')).toBeDefined();
  });

  it('filters worlds by name search', () => {
    render(<WorldBrowserPage />);

    const input = screen.getByPlaceholderText('Search worlds...');
    fireEvent.change(input, { target: { value: 'nexus' } });

    expect(screen.getByText('Nexus Prime')).toBeDefined();
    expect(screen.queryByText('Eldoria')).toBeNull();
    expect(screen.queryByText('Shadow Realm')).toBeNull();
  });

  it('filters worlds by genre', () => {
    render(<WorldBrowserPage />);

    const input = screen.getByPlaceholderText('Search worlds...');
    fireEvent.change(input, { target: { value: 'fantasy' } });

    expect(screen.getByText('Eldoria')).toBeDefined();
    expect(screen.queryByText('Nexus Prime')).toBeNull();
  });

  it('filters worlds by era', () => {
    render(<WorldBrowserPage />);

    const input = screen.getByPlaceholderText('Search worlds...');
    fireEvent.change(input, { target: { value: 'modern' } });

    expect(screen.getByText('Shadow Realm')).toBeDefined();
    expect(screen.queryByText('Eldoria')).toBeNull();
  });

  it('shows empty state when no worlds match', () => {
    render(<WorldBrowserPage />);

    const input = screen.getByPlaceholderText('Search worlds...');
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No worlds found')).toBeDefined();
  });

  it('navigates to world detail on card click', () => {
    render(<WorldBrowserPage />);

    fireEvent.click(screen.getByTestId('world-card-w1'));
    expect(mockNavigate).toHaveBeenCalledWith('/world/w1');
  });

  it('shows loading skeleton while fetching', () => {
    mockUseMyWorldsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const { container } = render(<WorldBrowserPage />);

    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state with retry button', () => {
    mockUseMyWorldsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network failure'),
    });

    render(<WorldBrowserPage />);

    expect(screen.getByText('Network failure')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('shows empty state when data is empty array', () => {
    mockUseMyWorldsQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<WorldBrowserPage />);
    expect(screen.getByText('No worlds found')).toBeDefined();
  });

  it('search is case-insensitive', () => {
    render(<WorldBrowserPage />);

    const input = screen.getByPlaceholderText('Search worlds...');
    fireEvent.change(input, { target: { value: 'ELDORIA' } });

    expect(screen.getByText('Eldoria')).toBeDefined();
    expect(screen.queryByText('Nexus Prime')).toBeNull();
  });
});
