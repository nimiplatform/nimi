import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateBatchPage from './create-batch-page.js';
import { useLookdevStore } from './lookdev-store.js';

const { listLookdevWorlds, listLookdevAgents } = vi.hoisted(() => ({
  listLookdevWorlds: vi.fn(),
  listLookdevAgents: vi.fn(),
}));

vi.mock('@renderer/data/lookdev-data-client.js', async () => {
  const actual = await vi.importActual<object>('@renderer/data/lookdev-data-client.js');
  return {
    ...actual,
    listLookdevWorlds,
    listLookdevAgents,
  };
});

describe('CreateBatchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLookdevWorlds.mockResolvedValue([{ id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 2 }]);
    listLookdevAgents.mockResolvedValue([
      { id: 'a1', handle: 'iris', displayName: 'Iris', concept: 'Anchor scout', worldId: 'w1', avatarUrl: null, status: 'READY' },
    ]);
    useLookdevStore.setState({
      createBatch: vi.fn(async () => 'batch-1'),
      batches: [],
    });
  });

  it('creates a world-scoped batch and navigates to detail', async () => {
    const client = new QueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/batches/new']}>
          <Routes>
            <Route path="/batches/new" element={<CreateBatchPage />} />
            <Route path="/batches/:batchId" element={<div>detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Batch name'), 'Night market refresh');
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(screen.getByText('detail page')).toBeInTheDocument();
    });
  });
});
