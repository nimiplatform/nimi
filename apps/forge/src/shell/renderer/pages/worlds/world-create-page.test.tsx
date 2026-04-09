import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const navigateMock = vi.fn();
const useWorldCreatePageModelMock = vi.fn();
const retryPublishOperationMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('@nimiplatform/nimi-kit/ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Surface: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@world-engine/ui/create/create-workbench.js', () => ({
  CreateWorkbench: () => <div>CreateWorkbench</div>,
}));

vi.mock('@renderer/hooks/use-world-commit-actions.js', () => ({
  useWorldCommitActions: () => ({
    retryBatchRunMutation: { isPending: false },
    publishPackageMutation: { isPending: false },
    reportBatchItemFailureMutation: { isPending: false },
  }),
}));

vi.mock('@renderer/app-shell/providers/app-store.js', () => ({
  useAppStore: (selector: (state: { auth?: { user?: { id?: string } } }) => unknown) =>
    selector({ auth: { user: { id: 'user-1' } } }),
}));

vi.mock('@renderer/components/status-indicators.js', () => ({
  ForgeStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('./world-create-page-controller.js', () => ({
  useWorldCreatePageModel: (...args: unknown[]) => useWorldCreatePageModelMock(...args),
}));

vi.mock('./world-create-rule-truth-preview.js', () => ({
  WorldCreateRuleTruthPreview: () => <div>RuleTruthPreview</div>,
}));

import { WorldCreatePageView } from './world-create-page.js';

describe('WorldCreatePageView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorldCreatePageModelMock.mockReturnValue({
      actions: {} as any,
      clearNotice: vi.fn(),
      main: { snapshot: {} } as any,
      publishOperation: {
        batchRun: {
          id: 'run-1',
          name: 'Forge official publish · Realm',
          requestedBy: 'admin-1',
          status: 'FAILED',
          pipelineStages: ['ingest', 'validate'],
          retryLimit: 1,
          retryCount: 1,
          batchItemCount: 1,
          successCount: 0,
          failureCount: 1,
          qualityGateStatus: 'FAIL',
          qualityGateSummary: {
            findings: ['contract-mismatch'],
          },
          items: [
            {
              id: 'item-1',
              runId: 'run-1',
              slug: 'realm',
              sourceTitle: 'Realm Source',
              canonicalTitle: 'Realm',
              titleLineageKey: 'realm:realm',
              sourceMode: 'forge-official',
              status: 'FAILED',
              retryCount: 1,
              packageVersion: 'forge-ws-1',
              releaseId: 'release-3',
              releaseVersion: null,
              qualityGateStatus: 'FAIL',
              lastError: 'publish failed',
              startedAt: '2026-04-09T00:00:00.000Z',
              finishedAt: '2026-04-09T00:01:00.000Z',
              createdAt: '2026-04-09T00:00:00.000Z',
              updatedAt: '2026-04-09T00:00:00.000Z',
            },
          ],
        },
        publishedWorldId: 'world-1',
        publishedReleaseVersion: 3,
      },
      retryPublishOperation: retryPublishOperationMock,
      routing: {} as any,
      status: { notice: null } as any,
      workflow: { createDisplayStage: 'IMPORT' } as any,
    });
  });

  it('renders publish operations strip with batch item details', () => {
    render(<WorldCreatePageView />);

    expect(screen.getByText('Forge official publish · Realm')).toBeTruthy();
    expect(screen.getAllByText('FAILED').length).toBeGreaterThan(0);
    expect(screen.getByText(/retry 1/i)).toBeTruthy();
    expect(screen.getByText(/lineage realm:realm/i)).toBeTruthy();
    expect(screen.getByText('publish failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show Details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Release v3' })).toBeTruthy();
  });

  it('opens maintain page with deep-link compare params from the published item', () => {
    render(<WorldCreatePageView />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Release v3' }));

    expect(navigateMock).toHaveBeenCalledWith(
      '/worlds/world-1/maintain?lineageKey=realm%3Arealm&releaseId=release-3&runId=run-1',
    );
  });

  it('expands diagnostics for stages findings and lineage details', () => {
    render(<WorldCreatePageView />);

    fireEvent.click(screen.getByRole('button', { name: 'Show Details' }));

    expect(screen.getByText('Pipeline Stages')).toBeTruthy();
    expect(screen.getByText(/ingest -> validate/i)).toBeTruthy();
    expect(screen.getByText('Quality Findings')).toBeTruthy();
    expect(screen.getByText('contract-mismatch')).toBeTruthy();
    expect(screen.getByText('Item Lineage')).toBeTruthy();
    expect(screen.getByText(/package forge-ws-1/i)).toBeTruthy();
    expect(screen.getByText(/release release-3/i)).toBeTruthy();
  });

  it('renders retry action when publish failed without a published world', () => {
    useWorldCreatePageModelMock.mockReturnValueOnce({
      actions: {} as any,
      clearNotice: vi.fn(),
      main: { snapshot: {} } as any,
      publishOperation: {
        batchRun: {
          id: 'run-1',
          name: 'Forge official publish · Realm',
          requestedBy: 'admin-1',
          status: 'FAILED',
          pipelineStages: ['ingest', 'validate'],
          retryLimit: 1,
          retryCount: 1,
          batchItemCount: 1,
          successCount: 0,
          failureCount: 1,
          qualityGateStatus: 'FAIL',
          items: [
            {
              id: 'item-1',
              runId: 'run-1',
              slug: 'realm',
              sourceTitle: 'Realm Source',
              canonicalTitle: 'Realm',
              titleLineageKey: 'realm:realm',
              sourceMode: 'forge-official',
              status: 'FAILED',
              retryCount: 1,
              releaseVersion: null,
              qualityGateStatus: 'FAIL',
              lastError: 'publish failed',
              createdAt: '2026-04-09T00:00:00.000Z',
              updatedAt: '2026-04-09T00:00:00.000Z',
            },
          ],
        },
        publishedWorldId: null,
        publishedReleaseVersion: null,
      },
      retryPublishOperation: retryPublishOperationMock,
      routing: {} as any,
      status: { notice: null } as any,
      workflow: { createDisplayStage: 'IMPORT' } as any,
    });

    render(<WorldCreatePageView />);

    expect(screen.getByRole('button', { name: 'Retry Failed' })).toBeTruthy();
  });
});
