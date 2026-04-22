import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDefaultSectorChatState,
  loadSavedChats,
  loadSavedSnapshots,
} from './taxonomy.js';

describe('taxonomy storage migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T08:00:00.000Z'));
  });

  it('migrates legacy sector chats into thread-based chat state', () => {
    window.localStorage.setItem('nimi:polyinfo:chat:v1', JSON.stringify({
      iran: {
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: '先看一下这个板块',
            createdAt: 1000,
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '这是旧结论',
            createdAt: 2000,
            status: 'streaming',
          },
        ],
        draftText: '继续追问',
        isStreaming: true,
        error: 'old error',
      },
    }));

    const chats = loadSavedChats();

    expect(chats.iran).toEqual({
      threadId: 'sector-thread:iran',
      title: 'iran',
      draftText: '继续追问',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: '先看一下这个板块',
          createdAt: 1000,
          status: 'complete',
          error: undefined,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '这是旧结论',
          createdAt: 2000,
          status: 'streaming',
          error: undefined,
        },
      ],
      draftProposal: null,
      isStreaming: true,
      error: 'old error',
    });
  });

  it('returns a stable empty chat state shape', () => {
    expect(buildDefaultSectorChatState('election', 'Election Analyst')).toEqual({
      threadId: 'sector-thread:election',
      title: 'Election Analyst',
      draftText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      draftProposal: null,
      isStreaming: false,
      error: null,
    });
  });

  it('filters malformed saved snapshots', () => {
    window.localStorage.setItem('nimi:polyinfo:snapshots:v1', JSON.stringify({
      iran: [
        {
          id: 'snap-1',
          sectorSlug: 'iran',
          sectorLabel: 'Iran',
          window: '24h',
          createdAt: 1234,
          headline: '板块转强',
          summary: '旧快照仍然应该保留',
          messageId: 'm1',
        },
        {
          sectorSlug: 'iran',
        },
      ],
    }));

    expect(loadSavedSnapshots()).toEqual({
      iran: [
        {
          id: 'snap-1',
          sectorSlug: 'iran',
          sectorLabel: 'Iran',
          window: '24h',
          createdAt: 1234,
          headline: '板块转强',
          summary: '旧快照仍然应该保留',
          messageId: 'm1',
        },
      ],
    });
  });
});
