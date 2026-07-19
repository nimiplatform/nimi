import { rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  NimiElectronLocalDevelopmentAuthoritySummary,
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentSummaryAvailability,
  NimiElectronLocalDevelopmentSummaryUnavailableReason,
} from '@nimiplatform/kit/shell/electron/main';
import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';

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
    await this.refreshAuthoritySummary(false);
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS);
  }

  async heartbeat(): Promise<void> {
    try {
      await this.writePresence();
    } catch {
      this.report('presence heartbeat failed');
    }
    await this.refreshAuthoritySummary(true);
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
    await writeOwnerPrivateAtomicJson(
      this.presencePath,
      descriptor,
      'local-development-projection',
    );
  }

  private async refreshAuthoritySummary(reportFailure: boolean): Promise<void> {
    try {
      const summary = await this.control.getAuthoritySummary();
      const descriptor = authoritySummaryDescriptor(
        summary,
        this.processId,
        this.now().toISOString(),
      );
      await writeOwnerPrivateAtomicJson(
        this.authoritySummaryPath,
        descriptor,
        'local-development-projection',
      );
    } catch (error) {
      await this.removeAuthoritySummary();
      if (reportFailure) {
        this.report(`authority summary unavailable: ${authoritySummaryFailureReason(error)}`);
      }
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
  for (const count of projectCounts) requireSummaryCount(count);
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

function authoritySummaryFailureReason(error: unknown): string {
  if (error && typeof error === 'object' && 'reasonCode' in error
    && typeof error.reasonCode === 'string'
    && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(error.reasonCode)) {
    return error.reasonCode;
  }
  return AUTHORITY_SUMMARY_UNTRUSTED;
}
