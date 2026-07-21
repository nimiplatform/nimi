import type {
  StatusBanner,
} from '../../app-shell/providers/app-store';
import type {
  RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service.js';

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
  sdk: DesktopRendererSdkPort;
  discovering: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
};

export type HealthProviderCommandContext = {
  state: RuntimeConfigStateMaybe;
  sdk: DesktopRendererSdkPort;
  checkingHealth: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
};

export type TestConnectorCommandContext = {
  state: RuntimeConfigStateMaybe;
  connectorSdk: RuntimeConfigConnectorSdkService;
  now: () => number;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  testingConnector: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: StatusBanner | null) => void;
  setControlFeedback: (next: StatusBanner | null) => void;
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

export type RuntimeConfigDiscoveryOptions = {
  visible?: boolean;
};
