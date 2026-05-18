import type { NimiAppTransport } from './transport.js';
import type { AppLaunchReadiness, NimiAppRow, NimiAppStatus, TrustTierId } from './types.js';

export type NimiAppAdmissionStatus =
  | 'admitted'
  | 'gated_by_avatar_master_gate'
  | 'pending_wave_4'
  | 'deferred'
  | 'retired';

export interface NimiAppRegistrySourceRow {
  readonly appId: string;
  readonly displayName: string;
  readonly publisher: string;
  readonly trustTier: TrustTierId;
  readonly sourceRule: string;
  readonly admissionStatus: NimiAppAdmissionStatus;
  readonly installedVersion?: string;
  readonly availableVersion?: string;
  readonly detail?: string;
}

export interface NimiAppRegistryTransportOptions {
  readonly loadRows: () => Promise<readonly NimiAppRegistrySourceRow[]> | readonly NimiAppRegistrySourceRow[];
  readonly resolveStatus?: (row: NimiAppRegistrySourceRow) => Promise<NimiAppStatus> | NimiAppStatus;
}

export class NimiAppRegistryTransportError extends Error {
  readonly code: 'invalid-dependency' | 'missing-registry-row' | 'source-error';

  constructor(
    code: NimiAppRegistryTransportError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'NimiAppRegistryTransportError';
  }
}

export function createNimiAppRegistryTransport(options: NimiAppRegistryTransportOptions): NimiAppTransport {
  assertRegistryTransportOptions(options);
  return {
    async listRegistry(): Promise<readonly NimiAppRow[]> {
      const rows = await loadRows(options.loadRows);
      return rows.map(toClientRow);
    },
    async getAppStatus(appId: string): Promise<NimiAppStatus> {
      const rows = await loadRows(options.loadRows);
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) {
        throw new NimiAppRegistryTransportError(
          'missing-registry-row',
          `Nimi App registry row missing for app "${appId}"`,
        );
      }
      if (options.resolveStatus) {
        return options.resolveStatus(row);
      }
      return defaultStatus(row);
    },
  };
}

async function loadRows(
  load: NimiAppRegistryTransportOptions['loadRows'],
): Promise<readonly NimiAppRegistrySourceRow[]> {
  try {
    const rows = await load();
    if (!Array.isArray(rows)) {
      throw new NimiAppRegistryTransportError('source-error', 'Nimi App registry source did not return an array');
    }
    return rows;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App registry source failed', error);
  }
}

function toClientRow(row: NimiAppRegistrySourceRow): NimiAppRow {
  return {
    appId: row.appId,
    appKind: 'nimi-app',
    displayName: row.displayName,
    trustTier: row.trustTier,
    publisher: row.publisher,
    sourceRule: row.sourceRule,
  };
}

function defaultStatus(row: NimiAppRegistrySourceRow): NimiAppStatus {
  return {
    appId: row.appId,
    launchReadiness: admissionToReadiness(row.admissionStatus),
    installedVersion: row.installedVersion,
    availableVersion: row.availableVersion,
    detail: row.detail,
  };
}

function admissionToReadiness(status: NimiAppAdmissionStatus): AppLaunchReadiness {
  switch (status) {
    case 'admitted':
      return 'install-required';
    case 'gated_by_avatar_master_gate':
      return 'blocked-by-master-gate';
    case 'pending_wave_4':
    case 'deferred':
    case 'retired':
      return 'unsupported';
  }
}

function assertRegistryTransportOptions(options: NimiAppRegistryTransportOptions): void {
  if (typeof options?.loadRows !== 'function') {
    throw new NimiAppRegistryTransportError('invalid-dependency', 'loadRows callback is required');
  }
}
