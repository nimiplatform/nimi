import { getRuntimeAccountSessionStatusResponse } from '@nimiplatform/kit/shell/renderer/bridge';
import { createNimiSharedLocalAgentAISurface } from '@nimiplatform/sdk/runtime';
import type {
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
} from '@nimiplatform/sdk/ai';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { createRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import type {
  RuntimeSetupRunnerAIConfigPort,
  RuntimeSetupRunnerPorts,
} from './runtime-setup-task-runner.js';

async function currentDesktopAccountId(): Promise<string> {
  const status = await getRuntimeAccountSessionStatusResponse();
  return status.snapshot?.accountProjection?.accountId ?? '';
}

/** Account snapshot id used when creating a setup task source. */
export async function currentDesktopAccountIdForSetup(): Promise<string> {
  return currentDesktopAccountId();
}

/**
 * Wires the setup task runner to the real Desktop SDK session. The source
 * owner's AIConfig surface is resolved per source kind; a machine-local task
 * (source kind 'runtime') has no consumer route and returns null.
 */
export function createRuntimeSetupTaskRunnerPorts(
  sdk: DesktopRendererSdkPort,
): RuntimeSetupRunnerPorts {
  const localEnvironment = createRuntimeConfigLocalEnvironmentClient(() => sdk.localEnvironmentRpc());
  return {
    loadouts: sdk.machineProduct().local.loadouts,
    environment: localEnvironment,
    install: localEnvironment,
    aiConfigForSource(source): RuntimeSetupRunnerAIConfigPort | null {
      if (source.kind === 'app') {
        const ownerAppId = source.ownerAppId?.trim() ?? '';
        if (!ownerAppId) return null;
        // The Desktop's own first-party app reads/writes through the local
        // app surface; third-party apps go through the account product.
        const surface = ownerAppId === sdk.appId()
          ? sdk.appProduct().aiConfig
          : sdk.accountProduct().appAIConfig(ownerAppId);
        return {
          get: () => surface.get(),
          overwrite: (input) => surface.overwrite(input),
          listOptions: (query) => surface.listOptions(query),
        };
      }
      if (source.kind === 'local-agent') {
        const shared = createNimiSharedLocalAgentAISurface({
          runtime: {
            appId: sdk.appId(),
            auth: sdk.accountRuntime().auth,
            agent: sdk.accountProduct().agents,
          },
          getSubjectUserId: async () => currentDesktopAccountId(),
          withScopes: sdk.withRuntimeProtectedScopes,
        }).sharedAIConfig;
        return {
          get: () => shared.get(),
          overwrite: (input) => shared.overwrite(input),
          listOptions: async (query: NimiAIConfigOptionsQuery): Promise<NimiAIConfigOptionsResult> => {
            const result = await shared.listOptions(query);
            if (result.kind === 'voice-assets') {
              throw new Error('Shared LocalAgent voice-assets options are not an AIConfig options result.');
            }
            return result;
          },
        };
      }
      return null;
    },
    account: { currentAccountId: currentDesktopAccountId },
    now: () => new Date().toISOString(),
  };
}
