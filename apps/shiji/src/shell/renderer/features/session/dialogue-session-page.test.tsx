/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DialogueSessionPage from './dialogue-session-page.js';
import {
  sqliteGetDialogueTurns,
  sqliteGetSession,
  type Session,
} from '@renderer/bridge/sqlite-bridge.js';
import { runDialoguePipelineStreaming } from '@renderer/engine/dialogue-pipeline.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ sessionId: 'session-1' }),
}));

vi.mock('@renderer/bridge/sqlite-bridge.js', () => ({
  sqliteGetSession: vi.fn(),
  sqliteGetDialogueTurns: vi.fn(),
}));

vi.mock('@renderer/engine/dialogue-pipeline.js', () => ({
  runDialoguePipelineStreaming: vi.fn(),
}));

const session: Session = {
  id: 'session-1',
  learnerId: 'learner-other',
  learnerProfileVersion: 1,
  worldId: 'world-1',
  agentId: 'agent-1',
  contentType: 'history',
  truthMode: 'factual',
  sessionStatus: 'active',
  chapterIndex: 0,
  sceneType: 'crisis',
  rhythmCounter: 0,
  trunkEventIndex: 0,
  startedAt: '2026-05-08T00:00:00Z',
  updatedAt: '2026-05-08T00:00:00Z',
  completedAt: null,
};

describe('DialogueSessionPage', () => {
  beforeEach(() => {
    vi.mocked(sqliteGetSession).mockReset();
    vi.mocked(sqliteGetDialogueTurns).mockReset();
    vi.mocked(runDialoguePipelineStreaming).mockReset();
    useAppStore.setState({
      activeProfile: null,
      sessionTimerMinutes: 45,
    });
  });

  it('fails closed before loading a direct session route without an active learner', async () => {
    render(<DialogueSessionPage />);

    expect(await screen.findByText('session.activeLearnerRequired')).toBeTruthy();
    expect(sqliteGetSession).not.toHaveBeenCalled();
    expect(sqliteGetDialogueTurns).not.toHaveBeenCalled();
    expect(runDialoguePipelineStreaming).not.toHaveBeenCalled();
  });

  it('fails closed before loading turns or generation when the session belongs to another learner', async () => {
    useAppStore.setState({
      activeProfile: {
        id: 'learner-active',
        authUserId: 'auth-1',
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
        createdAt: '2026-05-08T00:00:00Z',
        updatedAt: '2026-05-08T00:00:00Z',
      },
    });
    vi.mocked(sqliteGetSession).mockResolvedValue(session);

    render(<DialogueSessionPage />);

    expect(await screen.findByText('session.learnerMismatch')).toBeTruthy();
    expect(sqliteGetSession).toHaveBeenCalledWith('session-1');
    expect(sqliteGetDialogueTurns).not.toHaveBeenCalled();
    expect(runDialoguePipelineStreaming).not.toHaveBeenCalled();
  });
});
