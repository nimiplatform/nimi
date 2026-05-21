import { describe, expect, it } from 'vitest';
import { classifyPortfolioFailure, normalizeOwnerPortfolioAgent, type MyRealmAgentDto } from './portfolio-data.js';

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
