import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLocale, initI18n } from '@renderer/i18n/index.js';
import BatchDetailPage from './batch-detail-page.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevAuditEvent, type LookdevBatch, type LookdevItem } from './types.js';

const worldStylePack = createConfirmedWorldStylePack('w1', 'Aurora Harbor', 'en');
const generationTarget = {
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'image-connector',
  connectorLabel: 'Image Connector',
  endpoint: 'https://image.example.com/v1',
  provider: 'openai',
  modelId: 'image-model',
  modelLabel: 'Image Model',
  capability: 'image.generate' as const,
};
const evaluationTarget = {
  source: 'cloud' as const,
  route: 'cloud' as const,
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

function makeItem(overrides: Partial<LookdevItem> = {}): LookdevItem {
  return {
    itemId: 'i1',
    batchId: 'b1',
    agentId: 'a1',
    agentHandle: 'iris',
    agentDisplayName: 'Iris',
    agentConcept: 'Anchor scout',
    agentDescription: 'steady silhouette',
    importance: 'PRIMARY',
    captureMode: 'capture',
    portraitBrief: {
      agentId: 'a1',
      worldId: 'w1',
      displayName: 'Iris',
      visualRole: 'anchor scout',
      silhouette: 'clean full-body scout silhouette',
      outfit: 'weathered scout coat with practical layers',
      hairstyle: 'wind-swept shoulder-length hair',
      palettePrimary: 'deep teal',
      artStyle: worldStylePack.artStyle,
      mustKeepTraits: ['steady silhouette'],
      forbiddenTraits: ['extreme close-up'],
      sourceConfidence: 'derived_from_agent_truth',
      updatedAt: '2026-03-28T00:00:00.000Z',
    },
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
    ...overrides,
  };
}

function makeBatch(overrides: Partial<LookdevBatch>): LookdevBatch {
  const items = overrides.items ?? [makeItem({ batchId: 'b1', itemId: 'i1' })];
  return {
    batchId: 'b1',
    name: 'Spring cast',
    status: 'processing_complete',
    selectionSnapshot: {
      selectionSource: 'explicit_selection',
      agentIds: items.map((item) => item.agentId),
      captureSelectionAgentIds: items.filter((item) => item.captureMode === 'capture').map((item) => item.agentId),
      worldId: 'w1',
    },
    worldStylePackSnapshot: worldStylePack,
    policySnapshot: createDefaultPolicySnapshot({
      generationTarget,
      evaluationTarget,
    }),
    totalItems: items.length,
    captureSelectedItems: items.filter((item) => item.captureMode === 'capture').length,
    passedItems: items.filter((item) => item.status === 'auto_passed' || item.status === 'committed').length,
    failedItems: items.filter((item) => item.status === 'auto_failed_retryable' || item.status === 'auto_failed_exhausted' || item.status === 'commit_failed').length,
    committedItems: items.filter((item) => item.status === 'committed').length,
    commitFailedItems: items.filter((item) => item.status === 'commit_failed').length,
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    processingCompletedAt: null,
    commitCompletedAt: null,
    selectedItemId: items[0]?.itemId || null,
    auditTrail: [],
    items,
    ...overrides,
  };
}

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={['/batches/b1']}>
      <Routes>
        <Route path="/batches/:batchId" element={<BatchDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BatchDetailPage', () => {
  beforeEach(async () => {
    await initI18n();
    await changeLocale('en');
    useLookdevStore.setState({
      pauseBatch: vi.fn(),
      resumeBatch: vi.fn(async () => {}),
      rerunFailed: vi.fn(async () => {}),
      commitBatch: vi.fn(async () => {}),
      selectItem: vi.fn(),
      batches: [],
    });
  });

  it('renders not-found empty state', () => {
    renderDetailPage();
    expect(screen.getByText('Batch not found.')).toBeInTheDocument();
  });

  it('renders preview info and wires commit action after processing completes', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({ items: [makeItem()] })],
    });
    const user = userEvent.setup();
    renderDetailPage();

    expect(screen.getByRole('heading', { name: 'Iris', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Good anchor portrait')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Commit Batch' }));

    expect(useLookdevStore.getState().commitBatch).toHaveBeenCalledWith('b1');
  });

  it('shows resume only while paused and rerun-failed only when failed items exist', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'paused',
        failedItems: 0,
      })],
    });
    const user = userEvent.setup();
    renderDetailPage();

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rerun Failed' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(useLookdevStore.getState().resumeBatch).toHaveBeenCalledWith('b1');
  });

  it('renders frozen selection and policy snapshots for operator review', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        selectionSnapshot: {
          selectionSource: 'by_world',
          agentIds: ['a1', 'a2', 'a3'],
          captureSelectionAgentIds: ['a1', 'a3'],
          worldId: 'w1',
        },
        policySnapshot: {
          ...createDefaultPolicySnapshot(),
          autoEvalPolicy: {
            scoreThreshold: 84,
            conservative: true,
          },
          retryPolicy: {
            maxAttemptsPerPass: 4,
            autoCorrectionHintsAllowed: true,
            userEditableCorrectionHints: false,
          },
          generationTarget,
          evaluationTarget,
          maxConcurrency: 2,
        },
      })],
    });

    renderDetailPage();

    const snapshotsSection = screen.getByText('Batch snapshots').parentElement;
    expect(snapshotsSection).not.toBeNull();
    const snapshots = within(snapshotsSection!);

    expect(snapshots.getByText('Selection snapshot')).toBeInTheDocument();
    expect(snapshots.getByText('Policy snapshot')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Selection mode · by world')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'World id · w1')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Selected agents · 3')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Capture agents · 2')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Generation target · Image Connector / Image Model')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Evaluation target · Vision Connector / Vision Model')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Score threshold · 84')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Max concurrency · 2')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Retry budget · 4')).toBeInTheDocument();
    expect(snapshots.getByText((_, element) => element?.textContent === 'Writeback binding · AGENT_PORTRAIT')).toBeInTheDocument();
  });

  it('fails closed when rendering an invalid batch snapshot without execution targets', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        policySnapshot: {
          generationPolicy: createDefaultPolicySnapshot().generationPolicy,
          autoEvalPolicy: createDefaultPolicySnapshot().autoEvalPolicy,
          retryPolicy: createDefaultPolicySnapshot().retryPolicy,
          writebackPolicy: createDefaultPolicySnapshot().writebackPolicy,
          maxConcurrency: 1,
        } as unknown as LookdevBatch['policySnapshot'],
      })],
    });

    renderDetailPage();

    expect(screen.getByText('Invalid batch snapshot')).toBeInTheDocument();
    expect(screen.getByText('This batch was created against an outdated local schema. Recreate the batch from the current Lookdev flow.')).toBeInTheDocument();
  });

  it('allows selecting an item and rerunning only failed selections', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        selectedItemId: 'i2',
        items: [
          makeItem({ itemId: 'i1', agentId: 'a1', agentDisplayName: 'Iris', captureMode: 'capture' }),
          makeItem({
            itemId: 'i2',
            agentId: 'a2',
            agentHandle: 'nora',
            agentDisplayName: 'Nora',
            captureMode: 'batch_only',
            importance: 'SECONDARY',
            status: 'auto_failed_exhausted',
            currentEvaluation: {
              passed: false,
              score: 62,
              checks: [{ key: 'fullBody', passed: false, kind: 'hard_gate' }],
              summary: 'Too cropped',
              failureReasons: ['Keep the feet visible.'],
            },
            lastErrorMessage: 'Keep the feet visible.',
          }),
        ],
      })],
    });

    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole('button', { name: /Iris/i }));
    expect(useLookdevStore.getState().selectItem).toHaveBeenCalledWith('b1', 'i1');

    const rerunSelected = screen.getByRole('button', { name: 'Rerun Selected' });
    expect(rerunSelected).not.toBeDisabled();

    await user.click(rerunSelected);
    expect(useLookdevStore.getState().rerunFailed).toHaveBeenCalledWith('b1', ['i2']);
    expect(screen.getAllByText('Keep the feet visible.').length).toBeGreaterThan(0);
  });

  it('shows pause action while running and hides commit until processing completes', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'running',
        passedItems: 0,
        items: [
          makeItem({
            status: 'generating',
            currentImage: null,
            currentEvaluation: null,
          }),
        ],
      })],
    });

    renderDetailPage();

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit Batch' })).toBeDisabled();
    expect(screen.getByText('No existing portrait binding')).toBeInTheDocument();
    expect(screen.getByText('No generated result yet')).toBeInTheDocument();
  });

  it('shows failure placeholders and enables rerun for retryable items', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_failed_retryable',
            currentImage: null,
            currentEvaluation: null,
            lastErrorMessage: 'Vision gate returned no payload.',
          }),
        ],
      })],
    });

    const user = userEvent.setup();
    renderDetailPage();

    expect(screen.getByText('No evaluation payload yet.')).toBeInTheDocument();
    expect(screen.getByText('Vision gate returned no payload.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rerun Selected' }));
    expect(useLookdevStore.getState().rerunFailed).toHaveBeenCalledWith('b1', ['i1']);
  });

  it('hides resume and rerun controls once commit is complete', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'commit_complete',
        committedItems: 1,
        passedItems: 1,
        items: [
          makeItem({
            status: 'committed',
            committedAt: '2026-03-28T00:05:00.000Z',
          }),
        ],
      })],
    });

    renderDetailPage();

    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rerun Selected' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rerun Failed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit Batch' })).toBeDisabled();
  });

  it('renders audit trail timestamps and entries for operator inspection', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:10:00.000Z',
        processingCompletedAt: '2026-03-28T00:08:00.000Z',
        commitCompletedAt: null,
        auditTrail: [
          makeAuditEvent({
            eventId: 'audit-2',
            occurredAt: '2026-03-28T00:08:00.000Z',
            kind: 'processing_complete',
            scope: 'batch',
            severity: 'success',
          }),
          makeAuditEvent({
            eventId: 'audit-3',
            kind: 'item_gated_retryable',
            scope: 'item',
            severity: 'warning',
            agentId: 'a1',
            agentDisplayName: 'Iris',
            detail: 'Keep the full body visible.',
          }),
        ],
      })],
    });

    renderDetailPage();

    const auditSection = screen.getByText('Audit trail').parentElement;
    expect(auditSection).not.toBeNull();
    const audit = within(auditSection!);

    expect(audit.getByText((_, element) => element?.textContent === 'Created at · 2026-03-28T00:00:00.000Z')).toBeInTheDocument();
    expect(audit.getByText((_, element) => element?.textContent === 'Updated at · 2026-03-28T00:10:00.000Z')).toBeInTheDocument();
    expect(audit.getByText((_, element) => element?.textContent === 'Processing completed at · 2026-03-28T00:08:00.000Z')).toBeInTheDocument();
    expect(audit.getByText((_, element) => element?.textContent === 'Commit completed at · None')).toBeInTheDocument();
    expect(audit.getByText('2 visible audit events')).toBeInTheDocument();
    expect(audit.getByText('Processing complete')).toBeInTheDocument();
    expect(audit.getByText('Iris gated for retry')).toBeInTheDocument();
    expect(audit.getByText('Keep the full body visible.')).toBeInTheDocument();
    expect(audit.getByText('2026-03-28T00:08:00.000Z')).toBeInTheDocument();
    expect(audit.getByText('warning')).toBeInTheDocument();
    expect(audit.getByText('item')).toBeInTheDocument();
  });

  it('shows empty audit trail placeholder when no events exist', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        auditTrail: [],
      })],
    });

    renderDetailPage();

    expect(screen.getByText('No audit events recorded yet.')).toBeInTheDocument();
  });
});
