/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./shell-layout.js', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ShellLayout: () => <Outlet />,
  };
});

vi.mock('@renderer/features/explore/explore-home-page.js', () => ({
  default: () => <div>Explore Home Mock</div>,
}));

vi.mock('@renderer/features/explore/world-detail-page.js', () => ({
  default: () => <div>World Detail Mock</div>,
}));

vi.mock('@renderer/features/explore/agent-detail-page.js', () => ({
  default: () => <div>Agent Detail Mock</div>,
}));

vi.mock('@renderer/features/session/dialogue-session-page.js', () => ({
  default: () => <div>Dialogue Session Mock</div>,
}));

vi.mock('@renderer/features/knowledge/knowledge-graph-page.js', () => ({
  default: () => <div>Knowledge Graph Mock</div>,
}));

vi.mock('@renderer/features/knowledge/knowledge-world-page.js', () => ({
  default: () => <div>Knowledge World Mock</div>,
}));

vi.mock('@renderer/features/progress/progress-overview-page.js', () => ({
  default: () => <div>Progress Overview Mock</div>,
}));

vi.mock('@renderer/features/progress/achievements-page.js', () => ({
  default: () => <div>Achievements Mock</div>,
}));

vi.mock('@renderer/features/settings/settings-page.js', () => ({
  default: () => <div>Settings Mock</div>,
}));

import { AppRoutes } from './routes.js';

describe('AppRoutes', () => {
  it('redirects unknown hashes back to /explore', async () => {
    window.location.hash = '#/not-a-real-route';

    render(<AppRoutes />);

    await waitFor(() => {
      expect(screen.getByText('Explore Home Mock')).toBeTruthy();
    });
    expect(window.location.hash).toBe('#/explore');
  });
});
