import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

import {
  parseZhiyuResourcePackPlacementAck,
  type ZhiyuResourcePackPlacementAck,
  type ZhiyuResourcePackPlacementEvent,
} from './resource-pack-placement-ipc.js';

const PLACEMENT_PATH = '/v1/agent-center-resource-pack-placement';
const HEARTBEAT_INTERVAL_MS = 3_000;
const DEFAULT_ACK_TIMEOUT_MS = 12_000;
const MAX_REQUEST_BYTES = 4 * 1024;

type PresenceDescriptor = Readonly<{
  schemaVersion: 1;
  appId: 'nimi.zhiyu';
  purpose: 'agent-center-resource-pack-placement';
  bridgeId: string;
  pid: number;
  endpoint: string;
  token: string;
  startedAt: string;
  lastHeartbeatAt: string;
}>;

type PendingPlacement = {
  readonly requestId: string;
  readonly resolve: (result: ZhiyuPlacementResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type ZhiyuPlacementResult = Readonly<
  | { status: 'ready'; reasonCode: 'zhiyu-resource-pack-placement-ready' }
  | {
      status: 'failed';
      reasonCode: 'launch-failed' | 'destination-not-ready' | 'destination-session-failed' | 'agent-resolution-failed';
      actionHint: 'retry_zhiyu_resource_pack_placement';
    }
>;

export type ZhiyuElectronResourcePackPlacementHost = Readonly<{
  acknowledge(value: unknown): void;
  shutdown(): Promise<void>;
}>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function createZhiyuElectronResourcePackPlacementHost(input: {
  readonly homeDirectory: string;
  readonly focusMainWindow: () => Promise<void>;
  readonly emitPlacement: (event: ZhiyuResourcePackPlacementEvent) => void;
  readonly redeemPlacement: (correlationRef: string) => Promise<{ readonly conversationAnchorId: string }>;
  readonly resolveDestinationAgent: (conversationAnchorId: string) => Promise<Readonly<
    | { status: 'ready'; agentHandle: string }
    | { status: 'failed'; reasonCode: 'destination-session-failed' | 'agent-resolution-failed' }
  >>;
  readonly now?: () => number;
  readonly heartbeatIntervalMs?: number;
  readonly ackTimeoutMs?: number;
}): Promise<ZhiyuElectronResourcePackPlacementHost> {
  const host = new ElectronResourcePackPlacementHost(input);
  await host.start();
  return {
    acknowledge: (value) => host.acknowledge(value),
    shutdown: () => host.shutdown(),
  };
}

class ElectronResourcePackPlacementHost {
  private readonly bridgeId = `zhiyu-pack-placement-${randomBytes(18).toString('base64url')}`;
  private readonly token = randomBytes(32).toString('base64url');
  private readonly presencePath: string;
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly ackTimeoutMs: number;
  private server: Server | undefined;
  private endpoint = '';
  private startedAt = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatWrite: Promise<void> = Promise.resolve();
  private pending: PendingPlacement | undefined;
  private resolving = false;
  private stopped = false;

  constructor(private readonly input: {
    readonly homeDirectory: string;
    readonly focusMainWindow: () => Promise<void>;
    readonly emitPlacement: (event: ZhiyuResourcePackPlacementEvent) => void;
    readonly redeemPlacement: (correlationRef: string) => Promise<{ readonly conversationAnchorId: string }>;
    readonly resolveDestinationAgent: (conversationAnchorId: string) => Promise<Readonly<
      | { status: 'ready'; agentHandle: string }
      | { status: 'failed'; reasonCode: 'destination-session-failed' | 'agent-resolution-failed' }
    >>;
    readonly now?: () => number;
    readonly heartbeatIntervalMs?: number;
    readonly ackTimeoutMs?: number;
  }) {
    this.presencePath = path.join(
      path.resolve(input.homeDirectory),
      '.nimi',
      'run',
      'zhiyu',
      'resource-pack-placement',
      'presence.v1.json',
    );
    this.now = input.now ?? Date.now;
    this.heartbeatIntervalMs = input.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.ackTimeoutMs = input.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response).catch(() => {
        if (!response.headersSent) {
          writeJson(response, 200, { bridgeId: this.bridgeId, ...placementFailed('destination-not-ready') });
        } else if (!response.writableEnded) {
          response.end();
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(0, '127.0.0.1', resolve);
      });
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('zhiyu-resource-pack-placement-bind-failed');
      this.endpoint = `http://127.0.0.1:${address.port}`;
      this.startedAt = new Date(this.now()).toISOString();
      await this.writePresence();
      this.heartbeatTimer = setInterval(() => this.queueHeartbeat(), this.heartbeatIntervalMs);
      this.heartbeatTimer.unref?.();
    } catch (error) {
      const server = this.server;
      this.server = undefined;
      if (server) await closeServer(server).catch(() => undefined);
      throw error;
    }
  }

  acknowledge(value: unknown): void {
    const ack = parseZhiyuResourcePackPlacementAck(value);
    const pending = this.pending;
    if (!pending || pending.requestId !== ack.requestId) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(resultFromAck(ack));
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    await this.heartbeatWrite.catch(() => undefined);
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(placementFailed('destination-not-ready'));
    }
    const server = this.server;
    this.server = undefined;
    if (server) await closeServer(server);
    await this.removePresenceIfOwned();
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== PLACEMENT_PATH) {
      writeJson(response, 404, { status: 'failed', reasonCode: 'destination-not-ready' });
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      writeJson(response, 401, { bridgeId: this.bridgeId, ...placementFailed('launch-failed') });
      return;
    }
    let correlationRef: string;
    try {
      correlationRef = parseCorrelationDispatch(await readJsonBody(request));
    } catch {
      writeJson(response, 400, { bridgeId: this.bridgeId, ...placementFailed('agent-resolution-failed') });
      return;
    }
    if (this.pending || this.resolving) {
      writeJson(response, 200, { bridgeId: this.bridgeId, ...placementFailed('destination-not-ready') });
      return;
    }
    this.resolving = true;
    try {
      const redemption = await this.input.redeemPlacement(correlationRef);
      const resolution = await this.input.resolveDestinationAgent(redemption.conversationAnchorId);
      if (resolution.status !== 'ready') {
        writeJson(response, 200, { bridgeId: this.bridgeId, ...placementFailed(resolution.reasonCode) });
        return;
      }
      try {
        await this.input.focusMainWindow();
        const result = await this.emitAndWait(resolution.agentHandle);
        writeJson(response, 200, { bridgeId: this.bridgeId, ...result });
      } catch {
        writeJson(response, 200, { bridgeId: this.bridgeId, ...placementFailed('launch-failed') });
      }
    } catch {
      writeJson(response, 200, { bridgeId: this.bridgeId, ...placementFailed('agent-resolution-failed') });
    } finally {
      this.resolving = false;
    }
  }

  private emitAndWait(
    agentHandle: string,
  ): Promise<ZhiyuPlacementResult> {
    const requestId = `zhiyu-pack-placement-${randomBytes(18).toString('base64url')}`;
    const result = new Promise<ZhiyuPlacementResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.requestId !== requestId) return;
        this.pending = undefined;
        resolve(placementFailed('destination-not-ready'));
      }, this.ackTimeoutMs);
      timer.unref?.();
      this.pending = { requestId, resolve, timer };
    });
    try {
      this.input.emitPlacement(Object.freeze({
        schemaVersion: 1,
        requestId,
        agentHandle,
      }));
    } catch (error) {
      const pending = this.pending;
      this.pending = undefined;
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(placementFailed('destination-not-ready'));
      }
      throw error;
    }
    return result;
  }

  private queueHeartbeat(): void {
    if (this.stopped) return;
    this.heartbeatWrite = this.heartbeatWrite.then(() => this.writePresence()).catch(() => undefined);
  }

  private async writePresence(): Promise<void> {
    const descriptor: PresenceDescriptor = {
      schemaVersion: 1,
      appId: 'nimi.zhiyu',
      purpose: 'agent-center-resource-pack-placement',
      bridgeId: this.bridgeId,
      pid: process.pid,
      endpoint: this.endpoint,
      token: this.token,
      startedAt: this.startedAt,
      lastHeartbeatAt: new Date(this.now()).toISOString(),
    };
    await writeOwnerPrivatePresence(this.presencePath, descriptor);
  }

  private async removePresenceIfOwned(): Promise<void> {
    try {
      const metadata = await lstat(this.presencePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) return;
      const raw = JSON.parse(await readFile(this.presencePath, 'utf8')) as Record<string, unknown>;
      if (raw.bridgeId !== this.bridgeId) return;
      await rm(this.presencePath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

function resultFromAck(ack: ZhiyuResourcePackPlacementAck): ZhiyuPlacementResult {
  if (ack.status === 'ready') {
    return Object.freeze({
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
  }
  return placementFailed(ack.reasonCode);
}

function parseCorrelationDispatch(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('placement-dispatch-invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'correlationRef,schemaVersion' || record.schemaVersion !== 1) {
    throw new Error('placement-dispatch-invalid');
  }
  const ref = typeof record.correlationRef === 'string' ? record.correlationRef.trim() : '';
  if (!ref || ref !== record.correlationRef || ref.length > 160 || !/^zhiyu-placement-[A-Za-z0-9_-]+$/u.test(ref)) {
    throw new Error('placement-correlation-invalid');
  }
  return ref;
}

function placementFailed(
  reasonCode: 'launch-failed' | 'destination-not-ready' | 'destination-session-failed' | 'agent-resolution-failed',
): ZhiyuPlacementResult {
  return Object.freeze({ status: 'failed', reasonCode, actionHint: 'retry_zhiyu_resource_pack_placement' });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) return undefined;
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function writeOwnerPrivatePresence(targetPath: string, value: unknown): Promise<void> {
  const parent = path.dirname(targetPath);
  await rejectSymlinkAncestry(parent);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await rejectSymlinkAncestry(parent);
  if (process.platform !== 'win32') await chmod(parent, 0o700);
  await rejectSymlinkIfExists(targetPath);
  const tempPath = path.join(parent, `${path.basename(targetPath)}.${randomBytes(12).toString('base64url')}.tmp`);
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
    if (process.platform !== 'win32') await chmod(tempPath, 0o600);
    await rename(tempPath, targetPath);
    if (process.platform !== 'win32') await chmod(targetPath, 0o600);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function rejectSymlinkAncestry(candidate: string): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('zhiyu-resource-pack-placement-presence-parent-symlink');
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

async function rejectSymlinkIfExists(candidate: string): Promise<void> {
  try {
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error('zhiyu-resource-pack-placement-presence-symlink');
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
