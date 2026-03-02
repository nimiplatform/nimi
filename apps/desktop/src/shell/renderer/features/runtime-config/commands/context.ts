import type {
  StatusBanner,
} from '@renderer/app-shell/providers/app-store';
import type {
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/types';
import type { RuntimeConfigStateUpdater } from '../runtime-config-types';

export type RuntimeConfigPanelAsyncGuardContext = {
  discovering: boolean;
  testingConnector: boolean;
  checkingHealth: boolean;
  applying: boolean;
  setDiscovering: (next: boolean) => void;
  setTestingConnector: (next: boolean) => void;
  setCheckingHealth: (next: boolean) => void;
  setApplying: (next: boolean) => void;
};

type RuntimeConfigStateMaybe = RuntimeConfigStateV11 | null;

export type DiscoverProviderCommandContext = {
  state: RuntimeConfigStateMaybe;
  discovering: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
};

export type HealthProviderCommandContext = {
  state: RuntimeConfigStateMaybe;
  checkingHealth: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
};

export type TestConnectorCommandContext = {
  state: RuntimeConfigStateMaybe;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  testingConnector: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
};

export type RuntimeConfigPanelProviderCommandFactories = {
  discover: DiscoverProviderCommandContext;
  health: HealthProviderCommandContext;
  testSelectedConnector: TestConnectorCommandContext;
};

export type RuntimeConfigPanelCommandsInput = {
  guard: RuntimeConfigPanelAsyncGuardContext;
  provider: RuntimeConfigPanelProviderCommandFactories;
};
