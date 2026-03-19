import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { AppRoutes } from './app-routes.js';

vi.mock('@renderer/app-shell/layouts/studio-layout.js', () => ({
  StudioLayout: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));

vi.mock('@renderer/pages/workbench/workbench-home-page.js', () => ({
  default: () => <div>workbench-home</div>,
}));

vi.mock('@renderer/pages/workbench/workbench-new-page.js', () => ({
  default: () => <div>workbench-new</div>,
}));

vi.mock('@renderer/pages/agents/agents-page.js', () => ({
  default: () => <div>agents-library</div>,
}));

vi.mock('@renderer/pages/content/image-studio-page.js', () => ({
  default: () => <div>image-studio</div>,
}));

describe('AppRoutes', () => {
  beforeEach(() => {
    cleanup();
    window.location.hash = '#/';
  });

  it('renders the workbench home for the primary root route', async () => {
    render(<AppRoutes />);
    expect(await screen.findByText('workbench-home')).toBeTruthy();
  });

  it('renders the agent library from the canonical route', async () => {
    window.location.hash = '#/agents/library';
    render(<AppRoutes />);
    expect(await screen.findByText('agents-library')).toBeTruthy();
  });

  it('renders secondary content routes without affecting the workbench shell', async () => {
    window.location.hash = '#/content/images';
    render(<AppRoutes />);
    expect(await screen.findByText('image-studio')).toBeTruthy();
  });

  it('drops removed legacy routes into the root catch-all', async () => {
    window.location.hash = '#/import/character-card';
    render(<AppRoutes />);
    await waitFor(async () => {
      expect(await screen.findByText('workbench-home')).toBeTruthy();
    });
  });
});
