import type { NimiClient } from '@nimiplatform/sdk';
import type { NimiRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  getRuntimeAccountCaller,
  runtimeAccountLoginEnabled,
} from './runtime-platform.js';

export { getRuntimeAccountCaller };

type RuntimeAccountClient = Pick<NimiClient, 'runtime'> & {
  runtime: NimiClient['runtime'] & {
    account: NimiClient['runtime']['account'] & {
      getAccountSessionStatus(input: { caller: NimiRuntimeAccountCaller }): Promise<{
        state: AccountSessionState;
        accountProjection?: {
          accountId?: string | null;
          displayName?: string | null;
        } | null;
      }>;
    };
  };
};

export async function loadRuntimeAccountUser(client: RuntimeAccountClient | NimiClient) {
  if (!runtimeAccountLoginEnabled) {
    return null;
  }
  const response = await client.runtime.account.getAccountSessionStatus({
    caller: getRuntimeAccountCaller(),
  });
  if (response.state !== AccountSessionState.AUTHENTICATED || !response.accountProjection?.accountId) {
    return null;
  }
  return {
    id: response.accountProjection.accountId,
    displayName: response.accountProjection.displayName || 'Runtime account',
  };
}
