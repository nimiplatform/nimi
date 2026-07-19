import type { NimiClient } from '@nimiplatform/sdk';
import type { NimiRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  getRuntimeAccountCaller,
  runtimeAccountLoginEnabled,
} from './runtime-platform';

export { getRuntimeAccountCaller };

type RuntimeAccountClient = Pick<NimiClient, 'runtime'> & {
  runtime: NimiClient['runtime'] & {
    account: NimiClient['runtime']['account'] & {
      getAccountSessionStatus(input: { caller: NimiRuntimeAccountCaller }): Promise<{
        accepted: boolean;
        reasonCode?: unknown;
        accountReasonCode?: unknown;
        snapshot?: {
          state: AccountSessionState;
          accountProjection?: {
            accountId?: string | null;
            displayName?: string | null;
          } | null;
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
  if (!response.accepted || !response.snapshot) {
    throw new Error(
      `Runtime account status rejected: ${String(response.accountReasonCode || response.reasonCode || 'missing_snapshot')}`,
    );
  }
  if (
    response.snapshot.state !== AccountSessionState.AUTHENTICATED
    || !response.snapshot.accountProjection?.accountId
  ) {
    return null;
  }
  return {
    id: response.snapshot.accountProjection.accountId,
    displayName: response.snapshot.accountProjection.displayName || 'Runtime account',
  };
}
