import {
  createHostRuntimeAgentLifecycleSurface,
} from '@nimiplatform/sdk/runtime';

export async function inspectTesterRuntimeAgentLifecycleSurface(): Promise<{
  initialized: string;
  terminated: string;
}> {
  const calls = {
    initialized: '',
    terminated: '',
  };
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'dev.nimi.tester',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'tester-token',
          secret: 'tester-secret',
        }),
      },
      agent: {
        initializeAgent: async (request: { localAgentRef?: string }) => {
          calls.initialized = request.localAgentRef ?? '';
          return {};
        },
        terminateAgent: async (request: { agentId?: string }) => {
          calls.terminated = request.agentId ?? '';
          return {};
        },
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
  });
  await surface.initializeLocalAgent({
    localAgentRef: 'local-agent:tester-user:tester-agent',
    ownerUserId: 'tester-user',
    realmAgentId: 'tester-agent',
  });
  await surface.terminateLocalAgent({
    localAgentRef: 'local-agent:tester-user:tester-agent',
    ownerUserId: 'tester-user',
    realmAgentId: 'tester-agent',
  });
  return calls;
}
