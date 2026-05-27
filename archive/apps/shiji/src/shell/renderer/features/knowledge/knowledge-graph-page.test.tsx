/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeGraphPage from './knowledge-graph-page.js';
import { sqliteGetKnowledgeEntries } from '@renderer/bridge/sqlite-bridge.js';
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
  sqliteGetKnowledgeEntries: vi.fn(),
}));

describe('KnowledgeGraphPage', () => {
  beforeEach(() => {
    vi.mocked(sqliteGetKnowledgeEntries).mockReset();
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

  it('fails closed with a retryable error instead of rendering empty knowledge when reads fail', async () => {
    vi.mocked(sqliteGetKnowledgeEntries).mockRejectedValue(new Error('sqlite unavailable'));

    render(<KnowledgeGraphPage />);

    expect(await screen.findByText('knowledge.loadError')).toBeTruthy();
    expect(screen.getByText('sqlite unavailable')).toBeTruthy();
    expect(screen.queryByText('knowledge.empty')).toBeNull();
  });
});
