import type { ApiConnector, LocalRuntimeStateV11 } from './connector';
import type { CapabilityV11, RuntimePageIdV11, SourceIdV11, UiModeV11 } from './modality';

export type RuntimeConfigStateV11 = {
  version: 11;
  initializedByV11: boolean;
  activePage: RuntimePageIdV11;
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  uiMode: UiModeV11;
  localRuntime: LocalRuntimeStateV11;
  connectors: ApiConnector[];
  selectedConnectorId: string;
};
