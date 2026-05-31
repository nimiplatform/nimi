import { checkRuntimeRouteProviderHealth } from '@nimiplatform/sdk/runtime';
import type { CheckLlmHealthInput, ProviderHealth } from './types';
import { getRuntimeClient } from './runtime-ai-bridge';

const DESKTOP_RUNTIME_APP_ID = 'nimi.desktop';

export async function checkLocalLlmHealth(input: CheckLlmHealthInput): Promise<ProviderHealth> {
  return checkRuntimeRouteProviderHealth({
    ...input,
    appId: DESKTOP_RUNTIME_APP_ID,
    checkModelHealth: input.runtimeModelHealth
      || ((request) => getRuntimeClient().model.checkHealth(request)),
    testConnector: (request) => getRuntimeClient().connector.testConnector(request),
  });
}
