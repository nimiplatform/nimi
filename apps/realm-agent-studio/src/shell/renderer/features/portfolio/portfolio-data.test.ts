import { describe, expect, it } from 'vitest';
import {
  applyOwnerPortfolioView,
  classifyAgentDetailFailure,
  classifyPortfolioFailure,
  normalizeOwnerPortfolioAgent,
  normalizeOwnerPortfolioAgentDetail,
  type MyRealmAgentDto,
} from './portfolio-data.js';

const baseAgent: MyRealmAgentDto = {
  id: 'agent-1',
  handle: 'mira',
  displayName: 'Mira',
  createdAt: '2026-05-21T00:00:00.000Z',
  isAgent: true,
};

describe('owner portfolio normalization', () => {
  it('keeps present friendCount as the only first-version metric', () => {
    const agent = normalizeOwnerPortfolioAgent({ ...baseAgent, friendCount: 12 });

    expect(agent.friendCount).toEqual({ status: 'available', value: 12 });
    expect(agent.source).toBe('Realm MeService.listMyRealmAgents');
  });

  it('does not coerce absent friendCount to zero', () => {
    const agent = normalizeOwnerPortfolioAgent(baseAgent);

    expect(agent.friendCount).toEqual({
      status: 'source-unavailable',
      label: 'friendCount source unavailable',
    });
  });

  it('names owner authority missing failures', () => {
    expect(classifyPortfolioFailure(new Error('MASTER_OWNED owner authority rejected')).title).toBe('owner authority missing');
  });

  it('classifies SDK httpStatus permission failures', () => {
    expect(classifyPortfolioFailure({ details: { httpStatus: 403 } }).title).toBe('Permission missing');
  });
});

describe('owner portfolio local view controls', () => {
  const agents = [
    normalizeOwnerPortfolioAgent({
      ...baseAgent,
      id: 'agent-1',
      displayName: 'Mira',
      handle: 'mira',
      friendCount: 12,
      agentProfile: { worldId: 'oasis', state: 'ACTIVE' },
    }),
    normalizeOwnerPortfolioAgent({
      ...baseAgent,
      id: 'agent-2',
      displayName: 'Zed',
      handle: 'zed',
      friendCount: 3,
      agentProfile: { worldId: 'workshop', state: 'READY' },
    }),
    normalizeOwnerPortfolioAgent({
      ...baseAgent,
      id: 'agent-3',
      displayName: 'Aster',
      handle: 'aster',
      agentProfile: { worldId: 'oasis', state: 'ACTIVE' },
    }),
  ];

  it('searches local display, handle, world, and state fields without mutating the source list', () => {
    const result = applyOwnerPortfolioView(agents, {
      query: 'oasis',
      filter: 'all',
      sort: 'display-name-asc',
    });

    expect(result.map((agent) => agent.id)).toEqual(['agent-3', 'agent-1']);
    expect(agents.map((agent) => agent.id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('searches canonical agent id for manual lookup', () => {
    const result = applyOwnerPortfolioView(agents, {
      query: 'agent-2',
      filter: 'all',
      sort: 'display-name-asc',
    });

    expect(result.map((agent) => agent.id)).toEqual(['agent-2']);
  });

  it('preserves Realm list order until an owner selects a local sort', () => {
    const result = applyOwnerPortfolioView(agents, {
      query: '',
      filter: 'all',
      sort: 'realm-order',
    });

    expect(result.map((agent) => agent.id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('filters source unavailable friendCount as unavailable rather than zero', () => {
    const result = applyOwnerPortfolioView(agents, {
      query: '',
      filter: 'friend-count-unavailable',
      sort: 'display-name-asc',
    });

    expect(result.map((agent) => agent.id)).toEqual(['agent-3']);
    expect(result[0]?.friendCount).toEqual({
      status: 'source-unavailable',
      label: 'friendCount source unavailable',
    });
  });

  it('sorts available friendCount values and keeps unavailable values after them', () => {
    const descending = applyOwnerPortfolioView(agents, {
      query: '',
      filter: 'all',
      sort: 'friend-count-desc',
    });
    const ascending = applyOwnerPortfolioView(agents, {
      query: '',
      filter: 'all',
      sort: 'friend-count-asc',
    });

    expect(descending.map((agent) => agent.id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(ascending.map((agent) => agent.id)).toEqual(['agent-2', 'agent-1', 'agent-3']);
  });
});

describe('owner portfolio detail normalization', () => {
  it('maps settings and evidence from getMyRealmAgent as read-only fields', () => {
    const detail = normalizeOwnerPortfolioAgentDetail({
      ...baseAgent,
      bio: 'Quiet strategist',
      profileCoverUrl: 'https://cdn.example.test/cover.png',
      friendCount: 7,
      agentProfile: {
        greeting: 'Welcome in.',
        ownershipType: 'MASTER_OWNED',
        state: 'ACTIVE',
        worldId: 'world-1',
      },
    });

    expect(detail.source).toBe('Realm MeService.getMyRealmAgent');
    expect(detail.displayName).toMatchObject({ value: 'Mira', readOnly: true, status: 'available' });
    expect(detail.handle.value).toBe('mira');
    expect(detail.bio.value).toBe('Quiet strategist');
    expect(detail.greeting.value).toBe('Welcome in.');
    expect(detail.profileCoverUrl.value).toBe('https://cdn.example.test/cover.png');
    expect(detail.ownership.value).toBe('MASTER_OWNED');
    expect(detail.world.value).toBe('world-1');
    expect(detail.state.value).toBe('ACTIVE');
    expect(detail.friendCount).toEqual({ status: 'available', value: 7 });
  });

  it('keeps missing settings and friendCount source-unavailable', () => {
    const detail = normalizeOwnerPortfolioAgentDetail(baseAgent);

    expect(detail.bio).toMatchObject({
      status: 'source-unavailable',
      value: '',
      unavailableLabel: 'setting read unavailable',
    });
    expect(detail.greeting.status).toBe('source-unavailable');
    expect(detail.profileCoverUrl.status).toBe('source-unavailable');
    expect(detail.ownership.status).toBe('source-unavailable');
    expect(detail.world.status).toBe('source-unavailable');
    expect(detail.state.status).toBe('source-unavailable');
    expect(detail.friendCount).toEqual({
      status: 'source-unavailable',
      label: 'friendCount source unavailable',
    });
  });

  it('does not treat world display names as write-safe world id evidence', () => {
    const detail = normalizeOwnerPortfolioAgentDetail({
      ...baseAgent,
      agentProfile: {
        worldName: 'OASIS',
      } as unknown as NonNullable<MyRealmAgentDto['agentProfile']>,
    });

    expect(detail.world.status).toBe('source-unavailable');
    expect(detail.world.value).toBe('');
  });

  it('classifies detail setting read failures separately', () => {
    const failure = classifyAgentDetailFailure(new Error('schema parse failed for setting fields'));

    expect(failure.kind).toBe('setting-read-unavailable');
    expect(failure.title).toBe('Setting read unavailable');
    expect(failure.detail).toContain('read-only setting fields');
  });
});
