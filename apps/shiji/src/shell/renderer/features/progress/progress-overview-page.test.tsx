/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressOverviewPage from './progress-overview-page.js';
import { sqliteGetSessionsForLearner } from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@renderer/bridge/sqlite-bridge.js', () => ({
  sqliteGetSessionsForLearner: vi.fn(),
  sqliteGetChapterProgress: vi.fn(),
  sqliteGetKnowledgeEntries: vi.fn(),
}));

describe('ProgressOverviewPage', () => {
  beforeEach(() => {
    vi.mocked(sqliteGetSessionsForLearner).mockReset();
    useAppStore.setState({
      activeProfile: {
        id: 'learner-1',
        authUserId: 'auth-learner-1',
        displayName: 'Learner',
        age: 10,
        profileVersion: 1,
        communicationStyle: '',
        guardianGoals: '',
        guardianGuidance: {},
        strengthTags: [],
        interestTags: [],
        supportNotes: [],
        isActive: true,
        encounterCompletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('fails closed with a retryable error instead of rendering zero progress when local reads fail', async () => {
    vi.mocked(sqliteGetSessionsForLearner).mockRejectedValue(new Error('local storage unavailable'));

    render(<ProgressOverviewPage />);

    expect(await screen.findByText('progress.loadError')).toBeTruthy();
    expect(screen.getByText('local storage unavailable')).toBeTruthy();
    expect(screen.queryByText('progress.noSessions')).toBeNull();
  });
});
