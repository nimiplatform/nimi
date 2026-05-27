import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLocale, initI18n } from '@renderer/i18n/index.js';
import BatchListPage from './batch-list-page.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevAuditEvent, type LookdevBatch } from './types.js';

const generationTarget = {
  connectorId: 'image-connector',
  connectorLabel: 'Image Connector',
  endpoint: 'https://image.example.com/v1',
  provider: 'openai',
  modelId: 'image-model',
  modelLabel: 'Image Model',
  capability: 'image.generate' as const,
};

const evaluationTarget = {
  connectorId: 'vision-connector',
  connectorLabel: 'Vision Connector',
  endpoint: 'https://vision.example.com/v1',
  provider: 'openai',
  modelId: 'vision-model',
  modelLabel: 'Vision Model',
  capability: 'text.generate.vision' as const,
};

function makeAuditEvent(overrides: Partial<LookdevAuditEvent> = {}): LookdevAuditEvent {
  return {
    eventId: 'audit-1',
    batchId: 'b1',
    occurredAt: '2026-03-28T00:02:00.000Z',
    kind: 'batch_created',
    scope: 'batch',
    severity: 'info',
    ...overrides,
  };
}

function makeBatch(overrides: Partial<LookdevBatch>): LookdevBatch {
  return {
    batchId: 'b1',
    name: 'Spring cast',
    status: 'processing_complete',
    selectionSnapshot: {
      selectionSource: 'by_world',
      agentIds: ['a1'],
      captureSelectionAgentIds: ['a1'],
      worldId: 'w1',
    },
    worldStylePackSnapshot: createConfirmedWorldStylePack('w1', 'Aurora Harbor', 'en'),
    policySnapshot: createDefaultPolicySnapshot({
      generationTarget,
      evaluationTarget,
    }),
    totalItems: 1,
    captureSelectedItems: 1,
    passedItems: 1,
    failedItems: 0,
    committedItems: 0,
    commitFailedItems: 0,
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    processingCompletedAt: null,
    commitCompletedAt: null,
    selectedItemId: null,
    auditTrail: [],
    items: [],
    ...overrides,
  };
}

describe('BatchListPage', () => {
  beforeEach(async () => {
    await initI18n();
    await changeLocale('en');
    useLookdevStore.setState({ batches: [], deleteBatch: vi.fn() });
  });

  it('renders no-batch empty state', () => {
    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('No batch yet')).toBeInTheDocument();
    expect(screen.getByText('Open batch creator')).toBeInTheDocument();
  });

  it('filters batches by status and shows no-match empty state', async () => {
    useLookdevStore.setState({
      batches: [
        makeBatch({ batchId: 'b1', name: 'Processing batch', status: 'processing_complete' }),
        makeBatch({ batchId: 'b2', name: 'Paused batch', status: 'paused' }),
      ],
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Processing batch')).toBeInTheDocument();
    expect(screen.getByText('Paused batch')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /running/i }));

    expect(screen.getByText('No batch matches this filter')).toBeInTheDocument();
    expect(screen.queryByText('Processing batch')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /paused/i }));

    expect(screen.getByText('Paused batch')).toBeInTheDocument();
    expect(screen.queryByText('Processing batch')).not.toBeInTheDocument();
  });

  it('renders existing batches with summary counts and links to details', () => {
    useLookdevStore.setState({
      batches: [
        makeBatch({
          batchId: 'b1',
          name: 'Spring cast',
          status: 'commit_complete',
          captureSelectedItems: 2,
          committedItems: 2,
          auditTrail: [
            makeAuditEvent({
              kind: 'item_committed',
              scope: 'item',
              severity: 'success',
              agentDisplayName: 'Iris',
              detail: 'AGENT_PORTRAIT',
            }),
          ],
        }),
      ],
    });

    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Spring cast')).toBeInTheDocument();
    expect(screen.getAllByText('commit complete').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Spring cast/i })).toHaveAttribute('href', '/batches/b1');
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByText('Latest activity')).toBeInTheDocument();
    expect(screen.getByText('Iris committed to AGENT_PORTRAIT')).toBeInTheDocument();
    expect(screen.getByText('2026-03-28T00:02:00.000Z · 1 audit events')).toBeInTheDocument();
  });

  it('opens a delete confirmation dialog for removable batches', async () => {
    const deleteBatch = vi.fn();
    useLookdevStore.setState({
      deleteBatch,
      batches: [
        makeBatch({
          batchId: 'b1',
          name: 'Spring cast',
          status: 'processing_complete',
        }),
      ],
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Delete local batch record')).toBeInTheDocument();
    expect(screen.getByText('Remove "Spring cast" from Lookdev\'s local batch history.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete batch' }));

    expect(deleteBatch).toHaveBeenCalledWith('b1');
  });

  it('disables delete for running batches', () => {
    useLookdevStore.setState({
      deleteBatch: vi.fn(),
      batches: [
        makeBatch({
          batchId: 'b1',
          name: 'Running cast',
          status: 'running',
        }),
      ],
    });

    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
