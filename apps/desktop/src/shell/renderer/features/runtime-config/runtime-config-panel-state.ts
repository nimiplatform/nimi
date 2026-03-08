import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type RuntimeConfigPanelStateModel = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  hydrated: boolean;
  setHydrated: Dispatch<SetStateAction<boolean>>;
  showCloudApiKey: boolean;
  setShowCloudApiKey: Dispatch<SetStateAction<boolean>>;
  localModelQuery: string;
  setLocalModelQuery: Dispatch<SetStateAction<string>>;
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
  const [showCloudApiKey, setShowCloudApiKey] = useState(false);
  const [localModelQuery, setLocalModelQuery] = useState('');
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
    showCloudApiKey,
    setShowCloudApiKey,
    localModelQuery,
    setLocalModelQuery,
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
