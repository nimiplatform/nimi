import { describe, expect, it } from 'vitest';

import { resolveLaunchAgentIdentity } from './app-bootstrap-runtime-binding.js';

describe('resolveLaunchAgentIdentity', () => {
  it('resolves explicit Runtime-owned local-agent launch identity', () => {
    expect(resolveLaunchAgentIdentity({
      agentId: 'local-agent:opaque-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toEqual({
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    });
  });

  it('fails closed when launch identity omits explicit Runtime provenance', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'agent-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
    })).toThrow(/requires explicit localAgentRef and runtimeSourceRef/u);
  });

  it('fails closed when launch owner does not match Runtime account projection', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'local-agent:opaque-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-2',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toThrow(/ownerUserId does not match Runtime account projection/u);
  });

  it('fails closed when agentId is not the Runtime-owned localAgentRef', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'agent-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toThrow(/agentId to equal localAgentRef/u);
  });
});
