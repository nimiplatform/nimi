import { describe, expect, it } from 'vitest';

import { resolveLaunchAgentIdentity } from './app-bootstrap-runtime-binding.js';

describe('resolveLaunchAgentIdentity', () => {
  it('resolves SDK-owned local-agent selectors without widening launch context fields', () => {
    expect(resolveLaunchAgentIdentity({
      agentId: 'local-agent:owner-1:agent-1',
      accountId: 'owner-1',
    })).toEqual({
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
    });
  });

  it('projects bare realm agent ids through the SDK local-agent helper', () => {
    expect(resolveLaunchAgentIdentity({
      agentId: 'agent-1',
      accountId: 'owner-1',
    })).toEqual({
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
    });
  });

  it('fails closed when local-agent selector account does not match Runtime projection', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'local-agent:owner-2:agent-1',
      accountId: 'owner-1',
    })).toThrow(/does not match Runtime account projection/u);
  });
});
