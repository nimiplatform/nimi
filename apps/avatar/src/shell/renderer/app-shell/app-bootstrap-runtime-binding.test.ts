import { describe, expect, it } from 'vitest';

import { resolveLaunchAgentIdentity } from './app-bootstrap-runtime-binding.js';

describe('resolveLaunchAgentIdentity', () => {
  it('resolves local-agent selectors without widening launch context fields', () => {
    expect(resolveLaunchAgentIdentity({
      agentId: 'local-agent:owner-1:agent:opaque',
      accountId: 'owner-1',
    })).toEqual({
      ownerUserId: 'owner-1',
      realmAgentId: 'agent:opaque',
      localAgentRef: 'local-agent:owner-1:agent:opaque',
    });
  });

  it('fails closed when local-agent selector account does not match Runtime projection', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'local-agent:owner-2:agent-1',
      accountId: 'owner-1',
    })).toThrow(/does not match Runtime account projection/u);
  });
});
