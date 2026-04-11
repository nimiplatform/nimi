import type { RuntimeDefaults as SharedRuntimeDefaults } from '@nimiplatform/nimi-kit/shell/renderer/bridge';

export type ParentOSRuntimeDefaults = SharedRuntimeDefaults & {
  webBaseUrl: string;
};
