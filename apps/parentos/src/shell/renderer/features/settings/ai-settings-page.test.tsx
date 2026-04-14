// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import AiSettingsPage from './ai-settings-page.js';

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      appId: 'app.nimi.parentos',
    },
  }),
}));

describe('AiSettingsPage', () => {
  beforeEach(() => {
    useAppStore.setState({
      aiConfig: null,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      aiConfig: null,
    });
  });

  it('renders the AI settings shell without crashing', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter>
            <AiSettingsPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('AI 模型设置')).toBeTruthy();
      expect(screen.getByText('AI 对话')).toBeTruthy();
      expect(screen.getByText('语音')).toBeTruthy();
    });

    expect(screen.queryByText('AI Profile')).toBeNull();
  });
});
