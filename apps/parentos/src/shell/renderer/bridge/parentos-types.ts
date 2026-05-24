import type { RuntimeDefaults as SharedRuntimeDefaults } from '@nimiplatform/kit/shell/renderer/bridge';

export type ParentOSRuntimeDefaults = SharedRuntimeDefaults & {
  webBaseUrl: string;
};
