import type { ApiConnector, LocalRuntimeStateV11 } from './connector';
import type { CapabilityV11, RuntimeSectionIdV11, RuntimeSetupPageIdV11, SourceIdV11, UiModeV11 } from './modality';

export type RuntimeConfigStateV11 = {
  version: 11;
  initializedByV11: boolean;
  activeSection: RuntimeSectionIdV11;
  activeSetupPage: RuntimeSetupPageIdV11;
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  uiMode: UiModeV11;
  localRuntime: LocalRuntimeStateV11;
  connectors: ApiConnector[];
  selectedConnectorId: string;
};

export function shouldAutoDiscoverOnSetupEnterV11(
  previous: RuntimeSectionIdV11 | null,
  next: RuntimeSectionIdV11,
  alreadyTriggered: boolean,
): boolean {
  if (alreadyTriggered) return false;
  return previous !== 'setup' && next === 'setup';
}
