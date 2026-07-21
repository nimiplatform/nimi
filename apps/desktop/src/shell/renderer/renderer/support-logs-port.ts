import type { DesktopRendererStorageDirs } from './settings-port.js';

export interface DesktopLogsExportResult {
  readonly artifactPath: string;
  readonly fileCount: number;
  readonly byteSize: number;
  readonly exportedAt: string;
}

export interface DesktopRendererSupportLogsPort {
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
  exportLogs(): Promise<DesktopLogsExportResult>;
}

export function createUnavailableDesktopRendererSupportLogsPort(
  reason = 'DESKTOP_RENDERER_SUPPORT_LOGS_UNAVAILABLE',
): DesktopRendererSupportLogsPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    loadStorageDirs: unavailable,
    exportLogs: unavailable,
  });
}
