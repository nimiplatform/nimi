import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';

export type RuntimeConfigPanelStateModel = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  hydrated: boolean;
  setHydrated: Dispatch<SetStateAction<boolean>>;
  showTokenApiKey: boolean;
  setShowTokenApiKey: Dispatch<SetStateAction<boolean>>;
  localRuntimeModelQuery: string;
  setLocalRuntimeModelQuery: Dispatch<SetStateAction<string>>;
  connectorModelQuery: string;
  setConnectorModelQuery: Dispatch<SetStateAction<string>>;
  vaultEntryCount: number;
  setVaultEntryCount: Dispatch<SetStateAction<number>>;
  vaultVersion: number;
  setVaultVersion: Dispatch<SetStateAction<number>>;
  discovering: boolean;
  setDiscovering: Dispatch<SetStateAction<boolean>>;
  testingConnector: boolean;
  setTestingConnector: Dispatch<SetStateAction<boolean>>;
  checkingHealth: boolean;
  setCheckingHealth: Dispatch<SetStateAction<boolean>>;
  applying: boolean;
  setApplying: Dispatch<SetStateAction<boolean>>;
  updateState: (updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
};

export function useRuntimeConfigPanelState(): RuntimeConfigPanelStateModel {
  const [state, setState] = useState<RuntimeConfigStateV11 | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showTokenApiKey, setShowTokenApiKey] = useState(false);
  const [localRuntimeModelQuery, setLocalRuntimeModelQuery] = useState('');
  const [connectorModelQuery, setConnectorModelQuery] = useState('');
  const [vaultEntryCount, setVaultEntryCount] = useState(0);
  const [vaultVersion, setVaultVersion] = useState(0);
  const [discovering, setDiscovering] = useState(false);
  const [testingConnector, setTestingConnector] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [applying, setApplying] = useState(false);

  const updateState = useCallback((updater: (prev: RuntimeConfigStateV11) => RuntimeConfigStateV11) => {
    setState((prev) => (prev ? updater(prev) : prev));
  }, []);

  return {
    state,
    setState,
    hydrated,
    setHydrated,
    showTokenApiKey,
    setShowTokenApiKey,
    localRuntimeModelQuery,
    setLocalRuntimeModelQuery,
    connectorModelQuery,
    setConnectorModelQuery,
    vaultEntryCount,
    setVaultEntryCount,
    vaultVersion,
    setVaultVersion,
    discovering,
    setDiscovering,
    testingConnector,
    setTestingConnector,
    checkingHealth,
    setCheckingHealth,
    applying,
    setApplying,
    updateState,
  };
}
