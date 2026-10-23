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
