import type {
  InlineFeedbackState,
} from '../../ui/feedback/inline-feedback';
import type {
  RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service.js';

export type RuntimeConfigPanelAsyncGuardContext = {
  testingConnector: boolean;
  checkingHealth: boolean;
  setTestingConnector: (next: boolean) => void;
  setCheckingHealth: (next: boolean) => void;
};

type RuntimeConfigStateMaybe = RuntimeConfigStateV11 | null;

export type HealthProviderCommandContext = {
  state: RuntimeConfigStateMaybe;
  sdk: DesktopRendererSdkPort;
  checkingHealth: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: InlineFeedbackState | null) => void;
};

export type TestConnectorCommandContext = {
  state: RuntimeConfigStateMaybe;
  connectorSdk: RuntimeConfigConnectorSdkService;
  now: () => number;
  selectedConnector: RuntimeConfigStateV11['connectors'][number] | null;
  testingConnector: boolean;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (next: InlineFeedbackState | null) => void;
  setControlFeedback: (next: InlineFeedbackState | null) => void;
};

export type RuntimeConfigPanelProviderCommandFactories = {
  health: HealthProviderCommandContext;
  testSelectedConnector: TestConnectorCommandContext;
};

export type RuntimeConfigPanelCommandsInput = {
  guard: RuntimeConfigPanelAsyncGuardContext;
  provider: RuntimeConfigPanelProviderCommandFactories;
};
