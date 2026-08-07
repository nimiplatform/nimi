import { rm } from 'node:fs/promises';
import path from 'node:path';

import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';

const LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS = 3_000;

type PresenceDescriptor = {
  readonly schemaVersion: 1;
  readonly desktopAppId: 'nimi.desktop';
  readonly desktopPid: number;
  readonly endpoint: string;
  readonly startedAt: string;
  readonly lastHeartbeatAt: string;
};

export type DesktopElectronLocalDevelopmentPresencePublisher = {
  readonly start: (endpoint: string) => Promise<void>;
  readonly heartbeat: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

export function createDesktopElectronLocalDevelopmentPresencePublisher(input: {
  readonly homeDirectory: string;
  readonly processId?: number;
  readonly now?: () => Date;
  readonly report?: (message: string) => void;
}): DesktopElectronLocalDevelopmentPresencePublisher {
  return new ElectronLocalDevelopmentPresencePublisher(
    path.resolve(input.homeDirectory),
    input.processId ?? process.pid,
    input.now ?? (() => new Date()),
    input.report ?? ((message) => console.error(`[local-development] ${message}`)),
  );
}

class ElectronLocalDevelopmentPresencePublisher implements DesktopElectronLocalDevelopmentPresencePublisher {
  private readonly presencePath: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private endpoint = '';
  private startedAt = '';

  constructor(
    homeDirectory: string,
    private readonly processId: number,
    private readonly now: () => Date,
    private readonly report: (message: string) => void,
  ) {
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      throw new Error('local-development-presence-untrusted');
    }
    this.presencePath = path.join(
      homeDirectory,
      '.nimi',
      'run',
      'desktop',
      'local-development',
      'presence.v1.json',
    );
  }

  async start(endpoint: string): Promise<void> {
    if (this.heartbeatTimer || this.endpoint) throw new Error('local-development-supervisor-required');
    this.endpoint = endpoint;
    this.startedAt = this.now().toISOString();
    await this.writePresence();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS);
  }

  async heartbeat(): Promise<void> {
    try {
      await this.writePresence();
    } catch {
      this.report('presence heartbeat failed');
    }
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    try {
      await rm(this.presencePath, { force: true });
    } catch {
      this.report('presence cleanup failed');
    }
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
    await writeOwnerPrivateAtomicJson(this.presencePath, descriptor, 'local-development-presence');
  }
}
