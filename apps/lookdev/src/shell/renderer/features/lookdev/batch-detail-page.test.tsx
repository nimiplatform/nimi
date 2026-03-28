import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BatchDetailPage from './batch-detail-page.js';
import { useLookdevStore } from './lookdev-store.js';

describe('BatchDetailPage', () => {
  beforeEach(() => {
    useLookdevStore.setState({
      pauseBatch: vi.fn(),
      resumeBatch: vi.fn(async () => {}),
      rerunFailed: vi.fn(async () => {}),
      commitBatch: vi.fn(async () => {}),
      selectItem: vi.fn(),
      batches: [{
        batchId: 'b1',
        name: 'Spring cast',
        status: 'processing_complete',
        selectionSnapshot: { selectionSource: 'explicit_selection', agentIds: ['a1'] },
        policySnapshot: {
          generationPolicy: { aspectRatio: '2:3', style: 'anchor', negativePrompt: '', promptFrame: 'anchor' },
          autoEvalPolicy: { scoreThreshold: 78, conservative: true },
          retryPolicy: { maxAttemptsPerPass: 3, autoCorrectionHintsAllowed: true, userEditableCorrectionHints: false },
          writebackPolicy: { bindingPoint: 'AGENT_PORTRAIT', replaceExistingPortraitByDefault: true, writeAgentAvatarByDefault: false },
          maxConcurrency: 1,
        },
        totalItems: 1,
        passedItems: 1,
        failedItems: 0,
        committedItems: 0,
        commitFailedItems: 0,
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        processingCompletedAt: null,
        commitCompletedAt: null,
        selectedItemId: 'i1',
        auditTrail: [],
        items: [{
          itemId: 'i1',
          batchId: 'b1',
          agentId: 'a1',
          agentHandle: 'iris',
          agentDisplayName: 'Iris',
          agentConcept: 'Anchor scout',
          agentDescription: 'steady silhouette',
          worldId: 'w1',
          status: 'auto_passed',
          attemptCount: 1,
          currentImage: { url: 'https://example.com/iris.png', mimeType: 'image/png', promptSnapshot: 'anchor', createdAt: '2026-03-28T00:00:00.000Z' },
          currentEvaluation: {
            passed: true,
            score: 88,
            checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
            summary: 'Good anchor portrait',
            failureReasons: [],
          },
          lastErrorCode: null,
          lastErrorMessage: null,
          correctionHints: [],
          existingPortraitUrl: null,
          referenceImageUrl: null,
          committedAt: null,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
        }],
      }],
    });
  });

  it('renders preview info and wires action buttons', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/batches/b1']}>
        <Routes>
          <Route path="/batches/:batchId" element={<BatchDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Iris', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Good anchor portrait')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await user.click(screen.getByRole('button', { name: 'Commit Batch' }));

    expect(useLookdevStore.getState().resumeBatch).toHaveBeenCalledWith('b1');
    expect(useLookdevStore.getState().commitBatch).toHaveBeenCalledWith('b1');
  });
});
