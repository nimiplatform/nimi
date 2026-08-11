// Desktop public-for-web boundary: bridge types and functions.
// Web adapters import from here instead of reaching into desktop bridge internals.

export { logRendererEvent, toRendererLogMessage } from '@nimiplatform/kit/telemetry';
export { proxyHttp } from '../shell/renderer/bridge/runtime-bridge/http';
export { getSystemResourceSnapshot } from '../shell/renderer/bridge/runtime-bridge/system-resources';
export { startWindowDrag } from '@nimiplatform/kit/shell/renderer/bridge';
export type {
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
  DesktopAccountSessionSubscriptionHandlers,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type {
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
} from '../shell/renderer/bridge/runtime-bridge/nimi-data-directory';

export type { LogsExportResult } from '../shell/renderer/bridge/runtime-bridge/support-logs-export';

export type {
  NimiProductControlState,
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
} from '@nimiplatform/sdk';

export type { DesktopStorageDirs } from '../shell/renderer/bridge/runtime-bridge/desktop-storage';

export type {
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  SystemResourceSnapshot,
} from '../shell/renderer/bridge/runtime-bridge/types';

export type {
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';
