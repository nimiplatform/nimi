import { useEffect } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';

type VaultSyncEffectInput = {
  state: RuntimeConfigStateV11 | null;
  credentialVault: { listCredentialEntries: (providerType: string) => Promise<Array<Record<string, unknown>>> };
  setVaultEntryCount: (count: number) => void;
};

export function useRuntimeConfigVaultSyncEffect(input: VaultSyncEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    let cancelled = false;

    void input.credentialVault
      .listCredentialEntries('OPENAI_COMPATIBLE')
      .then((entries) => {
        if (!cancelled) input.setVaultEntryCount(entries.length);
      })
      .catch(() => {
        if (!cancelled) input.setVaultEntryCount(0);
      });

    return () => {
      cancelled = true;
    };
  }, [input.credentialVault, input.setVaultEntryCount, input.state]);
}
