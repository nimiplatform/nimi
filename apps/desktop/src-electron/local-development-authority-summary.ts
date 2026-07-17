import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  NimiElectronLocalDevelopmentAuthoritySummary,
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentSummaryAvailability,
  NimiElectronLocalDevelopmentSummaryUnavailableReason,
} from '@nimiplatform/kit/shell/electron/main';

const LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS = 3_000;
const AUTHORITY_SUMMARY_UNTRUSTED = 'local-development-authority-summary-untrusted';

type PresenceDescriptor = {
  readonly schemaVersion: 1;
  readonly desktopAppId: 'nimi.desktop';
  readonly desktopPid: number;
  readonly endpoint: string;
  readonly startedAt: string;
  readonly lastHeartbeatAt: string;
};

type AuthoritySummaryDescriptor = {
  readonly schemaVersion: 1;
  readonly desktopAppId: 'nimi.desktop';
  readonly desktopPid: number;
  readonly capturedAt: string;
  readonly developerMode: {
    readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
    readonly state: 'disabled' | 'enabled' | 'unavailable';
    readonly reasonCode: 'action-executed' | NimiElectronLocalDevelopmentSummaryUnavailableReason;
  };
  readonly projectAuthorization: {
    readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
    readonly activeCount: number;
    readonly dormantCount: number;
    readonly deniedCount: number;
    readonly revokedCount: number;
    readonly reasonCode: 'action-executed' | NimiElectronLocalDevelopmentSummaryUnavailableReason;
  };
  readonly grantSummary: {
    readonly availability: NimiElectronLocalDevelopmentSummaryAvailability;
    readonly pendingCount: number;
    readonly grantedCount: number;
    readonly deniedCount: number;
    readonly expiredCount: number;
    readonly revokedCount: number;
    readonly supersededCount: number;
    readonly reasonCode: 'action-executed' | NimiElectronLocalDevelopmentSummaryUnavailableReason;
  };
};

export type DesktopElectronLocalDevelopmentProjectionPublisher = {
  readonly start: (endpoint: string) => Promise<void>;
  /** @internal Focused parity-test seam for one heartbeat. */
  readonly heartbeat: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

export function createDesktopElectronLocalDevelopmentProjectionPublisher(input: {
  readonly homeDirectory: string;
  readonly control: NimiElectronLocalDevelopmentControl;
  readonly processId?: number;
  readonly now?: () => Date;
  readonly report?: (message: string) => void;
}): DesktopElectronLocalDevelopmentProjectionPublisher {
  return new ElectronLocalDevelopmentProjectionPublisher(
    path.resolve(input.homeDirectory),
    input.control,
    input.processId ?? process.pid,
    input.now ?? (() => new Date()),
    input.report ?? ((message) => console.error(`[local-development] ${message}`)),
  );
}

class ElectronLocalDevelopmentProjectionPublisher
implements DesktopElectronLocalDevelopmentProjectionPublisher {
  private readonly presencePath: string;
  private readonly authoritySummaryPath: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private endpoint = '';
  private startedAt = '';

  constructor(
    homeDirectory: string,
    private readonly control: NimiElectronLocalDevelopmentControl,
    private readonly processId: number,
    private readonly now: () => Date,
    private readonly report: (message: string) => void,
  ) {
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
    }
    const directory = path.join(homeDirectory, '.nimi', 'run', 'desktop', 'local-development');
    this.presencePath = path.join(directory, 'presence.v1.json');
    this.authoritySummaryPath = path.join(directory, 'authority-summary.v1.json');
  }

  async start(endpoint: string): Promise<void> {
    if (this.heartbeatTimer || this.endpoint) throw new Error('local-development-supervisor-required');
    this.endpoint = endpoint;
    this.startedAt = this.now().toISOString();
    await this.writePresence();
    await this.refreshAuthoritySummary();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS);
  }

  async heartbeat(): Promise<void> {
    try {
      await this.writePresence();
    } catch {
      this.report('presence heartbeat failed');
    }
    await this.refreshAuthoritySummary();
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    await this.removeProjection(this.presencePath, 'presence cleanup failed');
    await this.removeAuthoritySummary();
  }

  private async writePresence(): Promise<void> {
    const descriptor: PresenceDescriptor = {
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      desktopPid: this.processId,
      endpoint: this.endpoint,
      startedAt: this.startedAt,
      lastHeartbeatAt: this.now().toISOString(),
    };
    await writeOwnerPrivateAtomicJson(this.presencePath, descriptor);
  }

  private async refreshAuthoritySummary(): Promise<void> {
    try {
      const summary = await this.control.getAuthoritySummary();
      const descriptor = authoritySummaryDescriptor(
        summary,
        this.processId,
        this.now().toISOString(),
      );
      await writeOwnerPrivateAtomicJson(this.authoritySummaryPath, descriptor);
    } catch (error) {
      await this.removeAuthoritySummary();
      this.report(`authority summary unavailable: ${authoritySummaryFailureReason(error)}`);
    }
  }

  private async removeAuthoritySummary(): Promise<void> {
    await this.removeProjection(this.authoritySummaryPath, 'authority summary cleanup failed');
  }

  private async removeProjection(projectionPath: string, failureMessage: string): Promise<void> {
    try {
      await rm(projectionPath, { force: true });
    } catch {
      this.report(failureMessage);
    }
  }
}

export function authoritySummaryDescriptor(
  summary: NimiElectronLocalDevelopmentAuthoritySummary,
  processId: number,
  capturedAt: string,
): AuthoritySummaryDescriptor {
  const projectCounts = [
    summary.projectAuthorization.activeCount,
    summary.projectAuthorization.dormantCount,
    summary.projectAuthorization.deniedCount,
    summary.projectAuthorization.revokedCount,
  ];
  const grantCounts = [
    summary.grantSummary.pendingCount,
    summary.grantSummary.grantedCount,
    summary.grantSummary.deniedCount,
    summary.grantSummary.expiredCount,
    summary.grantSummary.revokedCount,
    summary.grantSummary.supersededCount,
  ];
  for (const count of [...projectCounts, ...grantCounts]) requireSummaryCount(count);
  if (!Number.isSafeInteger(processId) || processId <= 0
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capturedAt)) {
    throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
  }

  const developerReason = summaryReason(
    summary.developerMode.availability,
    summary.developerMode.unavailableReason,
  );
  if ((summary.developerMode.availability === 'available'
      && summary.developerMode.state !== 'enabled'
      && summary.developerMode.state !== 'disabled')
    || (summary.developerMode.availability === 'unavailable'
      && summary.developerMode.state !== 'unavailable')) {
    throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
  }
  requireCountSummaryConsistency(
    summary.projectAuthorization.availability,
    summary.projectAuthorization.unavailableReason,
    projectCounts,
  );
  requireCountSummaryConsistency(
    summary.grantSummary.availability,
    summary.grantSummary.unavailableReason,
    grantCounts,
  );

  return {
    schemaVersion: 1,
    desktopAppId: 'nimi.desktop',
    desktopPid: processId,
    capturedAt,
    developerMode: {
      availability: summary.developerMode.availability,
      state: summary.developerMode.state,
      reasonCode: developerReason,
    },
    projectAuthorization: {
      availability: summary.projectAuthorization.availability,
      activeCount: summary.projectAuthorization.activeCount,
      dormantCount: summary.projectAuthorization.dormantCount,
      deniedCount: summary.projectAuthorization.deniedCount,
      revokedCount: summary.projectAuthorization.revokedCount,
      reasonCode: summaryReason(
        summary.projectAuthorization.availability,
        summary.projectAuthorization.unavailableReason,
      ),
    },
    grantSummary: {
      availability: summary.grantSummary.availability,
      pendingCount: summary.grantSummary.pendingCount,
      grantedCount: summary.grantSummary.grantedCount,
      deniedCount: summary.grantSummary.deniedCount,
      expiredCount: summary.grantSummary.expiredCount,
      revokedCount: summary.grantSummary.revokedCount,
      supersededCount: summary.grantSummary.supersededCount,
      reasonCode: summaryReason(
        summary.grantSummary.availability,
        summary.grantSummary.unavailableReason,
      ),
    },
  };
}

function requireCountSummaryConsistency(
  availability: NimiElectronLocalDevelopmentSummaryAvailability,
  unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null,
  counts: readonly number[],
): void {
  summaryReason(availability, unavailableReason);
  if (availability === 'unavailable' && counts.some((count) => count !== 0)) {
    throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
  }
}

function summaryReason(
  availability: NimiElectronLocalDevelopmentSummaryAvailability,
  unavailableReason: NimiElectronLocalDevelopmentSummaryUnavailableReason | null,
): 'action-executed' | NimiElectronLocalDevelopmentSummaryUnavailableReason {
  if (availability === 'available' && unavailableReason === null) return 'action-executed';
  if (availability === 'unavailable'
    && (unavailableReason === 'principal-unauthorized'
      || unavailableReason === 'local-app-operation-unavailable')) {
    return unavailableReason;
  }
  throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
}

function requireSummaryCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(AUTHORITY_SUMMARY_UNTRUSTED);
}

async function writeOwnerPrivateAtomicJson(targetPath: string, value: unknown): Promise<void> {
  const parent = path.dirname(targetPath);
  await rejectSymlinkAncestry(parent);
  await rejectSymlinkIfExists(targetPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await rejectSymlinkAncestry(parent);
  await rejectDescriptorTempSymlinks(parent, targetPath);
  await setOwnerOnlyDirectory(parent);

  const tempPath = path.join(
    parent,
    `${path.basename(targetPath)}.${randomBytes(12).toString('base64url')}.tmp`,
  );
  await rejectSymlinkIfExists(tempPath);
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await open(
    tempPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await setOwnerOnlyFile(tempPath);
    await rename(tempPath, targetPath);
    await setOwnerOnlyFile(targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function rejectDescriptorTempSymlinks(parent: string, targetPath: string): Promise<void> {
  const prefix = `${path.basename(targetPath)}.`;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tmp') && entry.isSymbolicLink()) {
      throw new Error('local-development-projection-temp-must-not-be-symlink');
    }
  }
}

async function rejectSymlinkIfExists(candidate: string): Promise<void> {
  try {
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error('local-development-projection-must-not-be-symlink');
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

async function rejectSymlinkAncestry(candidate: string): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('local-development-projection-parent-must-not-be-symlink');
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

async function setOwnerOnlyDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') await chmod(directory, 0o700);
}

async function setOwnerOnlyFile(filePath: string): Promise<void> {
  if (process.platform !== 'win32') await chmod(filePath, 0o600);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function authoritySummaryFailureReason(error: unknown): string {
  if (error && typeof error === 'object' && 'reasonCode' in error
    && typeof error.reasonCode === 'string'
    && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(error.reasonCode)) {
    return error.reasonCode;
  }
  return AUTHORITY_SUMMARY_UNTRUSTED;
}
