import {
  createHostRuntimeAgentLifecycleSurface,
  createNimiError,
} from '@nimiplatform/sdk/runtime';

export async function inspectTesterRuntimeAgentLifecycleSurface(): Promise<{
  ensuredGetCalls: number;
  ensuredInitializeCalls: number;
  initialized: string;
  terminated: string;
}> {
  const calls = {
    getAgent: 0,
    ensureInitializes: 0,
    initialized: '',
    terminated: '',
  };
  let agentExists = false;
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
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
        getAgent: async () => {
          calls.getAgent += 1;
          if (!agentExists) {
            throw createNimiError({
              message: 'tester agent missing',
              reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
              source: 'runtime',
            });
          }
          return {
            agent: {
              lifecycleStatus: 2,
            },
          };
        },
        initializeAgent: async (request: { localAgentRef?: string }) => {
          calls.ensureInitializes += agentExists ? 0 : 1;
          agentExists = true;
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
  await surface.ensureLocalAgentInitialized({
    localAgentRef: 'local-agent:tester-user:tester-agent',
    ownerUserId: 'tester-user',
    realmAgentId: 'tester-agent',
    displayName: 'Tester Agent',
    worldId: 'tester-world',
  });
  await surface.ensureLocalAgentInitialized({
    localAgentRef: 'local-agent:tester-user:tester-agent',
    ownerUserId: 'tester-user',
    realmAgentId: 'tester-agent',
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
  return {
    ensuredGetCalls: calls.getAgent,
    ensuredInitializeCalls: calls.ensureInitializes,
    initialized: calls.initialized,
    terminated: calls.terminated,
  };
}
