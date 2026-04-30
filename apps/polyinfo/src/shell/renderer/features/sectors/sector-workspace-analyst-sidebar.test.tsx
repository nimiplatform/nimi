import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { buildDefaultSectorChatState } from '@renderer/data/taxonomy.js';
import { AnalystSidebar } from './sector-workspace-analyst-sidebar.js';

function renderAnalystSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AnalystSidebar
          sectorId="trump-daily"
          sectorLabel="Trump Daily"
          activeWindow="24h"
          marketDataRequested={true}
          analysisReady={true}
          overlay={{ narratives: [], coreVariables: [] }}
          analysisPackageRef={{ current: null }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('sector analyst sidebar layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const chatState = buildDefaultSectorChatState('trump-daily', 'Trump Daily Analyst');
    useAppStore.setState({
      auth: {
        status: 'anonymous',
        user: null,
        token: '',
        refreshToken: '',
      },
      chatsBySector: {
        'trump-daily': {
          ...chatState,
          messages: Array.from({ length: 16 }, (_, index) => ({
            id: `message-${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `Long analyst exchange ${index}\n${'market context '.repeat(16)}`,
            createdAt: index,
            status: 'complete',
          })),
        },
      },
      taxonomyBySector: {},
      snapshotsBySector: {},
      customSectors: {},
      importedEventsBySector: {},
      lastActiveSectorId: null,
    });
  });

  it('keeps long conversations inside the message scroll region', () => {
    renderAnalystSidebar();

    const messageScrollRegion = screen.getByTestId('sector-analyst-message-scroll');
    expect(messageScrollRegion.className).toContain('flex-1');
    expect(messageScrollRegion.className).toContain('overflow-y-auto');

    const promptInput = screen.getByPlaceholderText('Query logic / propose changes...');
    expect(promptInput.className).toContain('resize-none');
    expect(promptInput.className).toContain('overflow-y-auto');
  });
});
