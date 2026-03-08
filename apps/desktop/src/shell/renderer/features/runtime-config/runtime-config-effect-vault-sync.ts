import { useEffect } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

type VaultSyncEffectInput = {
  state: RuntimeConfigStateV11 | null;
  setVaultEntryCount: (count: number) => void;
  vaultVersion: number;
};

export function useRuntimeConfigVaultSyncEffect(input: VaultSyncEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    // Credentials are managed by the runtime connector store.
    // Count connectors with hasCredential as the vault entry count.
    const count = input.state.connectors.filter((c) => c.hasCredential).length;
    input.setVaultEntryCount(count);
  }, [input.setVaultEntryCount, input.state, input.vaultVersion]);
}
