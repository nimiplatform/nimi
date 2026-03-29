import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import BatchListPage from './batch-list-page.js';
import { useLookdevStore } from './lookdev-store.js';
import { createDefaultWorldStylePack } from './types.js';

const worldStylePack = createDefaultWorldStylePack('w1', 'Aurora Harbor');

describe('BatchListPage', () => {
  beforeEach(() => {
    useLookdevStore.setState({
      batches: [{
        batchId: 'b1',
        name: 'Spring cast',
        status: 'processing_complete',
        selectionSnapshot: {
          selectionSource: 'by_world',
          agentIds: ['a1'],
          captureSelectionAgentIds: ['a1'],
          worldId: 'w1',
        },
        worldStylePackSnapshot: worldStylePack,
        policySnapshot: {
          generationPolicy: { aspectRatio: '2:3', style: 'anchor', negativePrompt: '', promptFrame: 'anchor' },
          autoEvalPolicy: { scoreThreshold: 78, conservative: true },
          retryPolicy: { maxAttemptsPerPass: 3, autoCorrectionHintsAllowed: true, userEditableCorrectionHints: false },
          writebackPolicy: { bindingPoint: 'AGENT_PORTRAIT', replaceExistingPortraitByDefault: true, writeAgentAvatarByDefault: false },
          maxConcurrency: 1,
        },
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
      }],
    });
  });

  it('renders existing batches with summary counts', () => {
    render(
      <MemoryRouter>
        <BatchListPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Spring cast')).toBeInTheDocument();
    expect(screen.getAllByText('processing complete').length).toBeGreaterThan(0);
    expect(screen.getByText('Create Batch')).toBeInTheDocument();
  });
});
