import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  safeParseNimiDesktopOpenIntentEnvelope,
  type NimiDesktopOpenIntentEnvelope,
  type NimiDesktopOpenResultReasonCode,
} from '@nimiplatform/kit/core/desktop-open';
import {
  buildAvatarHostHandoffRequest,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH,
  type NimiElectronAgentCenterResourcePackPlacementResult,
} from '@nimiplatform/kit/shell/electron/main';
import type { DesktopZhiyuResourcePackPlacementDispatch } from './zhiyu-resource-pack-placement.js';
import { writeOwnerPrivateAtomicJson } from './owner-private-atomic-json.js';

export const DESKTOP_OPEN_INTENT_EVENT = 'desktop-open://open-intent';

const DESKTOP_OPEN_INTENT_PATH = '/v1/open-intent';
export const DESKTOP_AVATAR_HOST_HANDOFF_PATH = '/v1/avatar-handoff';
export const DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH = '/v1/zhiyu-resource-pack-placement/redeem';
const PRESENCE_HEARTBEAT_INTERVAL_MS = 3_000;
const RENDERER_READY_HEARTBEAT_TTL_MS = 10_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const READY_COMMAND = 'desktop_open_intent_set_ready';
const ZHIYU_PLACEMENT_CORRELATION_TTL_MS = 15_000;

type DesktopOpenIntentResponse = Readonly<Record<string, unknown>>;

type DesktopOpenPresenceDescriptor = {
  readonly schemaVersion: 1;
  readonly desktopAppId: 'nimi.desktop';
  readonly bridgeId: string;
  readonly pid: number;
  readonly endpoint: string;
  readonly token: string;
  readonly startedAt: string;
  readonly lastHeartbeatAt: string;
};

export type DesktopElectronOpenIntentHost = {
  readonly commandHandlers: Readonly<Record<typeof READY_COMMAND, (context: {
    readonly command: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => void>>;
  readonly requestZhiyuResourcePackPlacement: (input: {
    readonly conversationAnchorId: string;
  }) => Promise<NimiElectronAgentCenterResourcePackPlacementResult>;
  readonly shutdown: () => Promise<void>;
};

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-006
export async function createDesktopElectronOpenIntentHost(input: {
  readonly homeDirectory: string;
  readonly focusMainWindow: () => Promise<void>;
  readonly emitIntent: (envelope: NimiDesktopOpenIntentEnvelope) => void;
  readonly avatarHostHandoff?: (dispatch: AvatarHostHandoffEnvelope) => Promise<AvatarHostHandoffResult>;
  readonly zhiyuResourcePackPlacement?: (
    request: DesktopZhiyuResourcePackPlacementDispatch,
    ) => Promise<NimiElectronAgentCenterResourcePackPlacementResult>;
  readonly now?: () => number;
  readonly heartbeatIntervalMs?: number;
  readonly readinessTtlMs?: number;
}): Promise<DesktopElectronOpenIntentHost> {
  const host = new ElectronDesktopOpenIntentHost(input);
  await host.start();
  return {
    commandHandlers: {
      [READY_COMMAND]: ({ payload }) => host.setRendererReady(payload),
    },
    requestZhiyuResourcePackPlacement: (placement) => host.requestZhiyuResourcePackPlacement(placement),
    shutdown: () => host.shutdown(),
  };
}

class ElectronDesktopOpenIntentHost {
  private readonly bridgeId = `desktop-open-bridge-${randomBytes(18).toString('base64url')}`;
  private readonly token = randomBytes(32).toString('base64url');
  private readonly descriptorPath: string;
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly readinessTtlMs: number;
  private server: Server | undefined;
  private endpoint = '';
  private startedAt = '';
  private ready = false;
  private lastReadyHeartbeatMs: number | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatWrite: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly zhiyuPlacementCorrelations = new Map<string, {
    readonly conversationAnchorId: string;
    readonly expiresAt: number;
  }>();

  constructor(private readonly input: {
    readonly homeDirectory: string;
    readonly focusMainWindow: () => Promise<void>;
    readonly emitIntent: (envelope: NimiDesktopOpenIntentEnvelope) => void;
    readonly avatarHostHandoff?: (dispatch: AvatarHostHandoffEnvelope) => Promise<AvatarHostHandoffResult>;
    readonly zhiyuResourcePackPlacement?: (
      request: DesktopZhiyuResourcePackPlacementDispatch,
    ) => Promise<NimiElectronAgentCenterResourcePackPlacementResult>;
    readonly now?: () => number;
    readonly heartbeatIntervalMs?: number;
    readonly readinessTtlMs?: number;
  }) {
    this.descriptorPath = path.join(
      path.resolve(input.homeDirectory),
      '.nimi',
      'run',
      'desktop',
      'open-intent',
      'presence.v1.json',
    );
    this.now = input.now ?? Date.now;
    this.heartbeatIntervalMs = input.heartbeatIntervalMs ?? PRESENCE_HEARTBEAT_INTERVAL_MS;
    this.readinessTtlMs = input.readinessTtlMs ?? RENDERER_READY_HEARTBEAT_TTL_MS;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handleHttp(request, response).catch(() => {
        if (!response.headersSent) {
          writeJson(response, 200, rejected(
            this.bridgeId,
            'desktop-open-desktop-not-ready',
            'wait_for_desktop_ready',
          ));
        } else if (!response.writableEnded) {
          response.end();
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(0, '127.0.0.1', () => resolve());
      });
      const address = this.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('desktop-open-bridge-bind-failed');
      }
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

  setRendererReady(payload: Readonly<Record<string, unknown>>): void {
    if (Object.keys(payload).length !== 1 || typeof payload.ready !== 'boolean') {
      throw new Error('desktop-open-ready-payload-invalid');
    }
    this.ready = payload.ready;
    this.lastReadyHeartbeatMs = payload.ready ? this.now() : undefined;
  }

  async requestZhiyuResourcePackPlacement(input: {
    readonly conversationAnchorId: string;
  }): Promise<NimiElectronAgentCenterResourcePackPlacementResult> {
    const conversationAnchorId = boundedPlacementText(input.conversationAnchorId, 'conversation-anchor');
    if (!this.input.zhiyuResourcePackPlacement) {
      return placementUnavailable('operation-unavailable', 'retry_zhiyu_resource_pack_placement');
    }
    this.removeExpiredZhiyuPlacementCorrelations();
    const correlationRef = `zhiyu-placement-${randomBytes(24).toString('base64url')}`;
    this.zhiyuPlacementCorrelations.set(correlationRef, {
      conversationAnchorId,
      expiresAt: this.now() + ZHIYU_PLACEMENT_CORRELATION_TTL_MS,
    });
    try {
      return await this.input.zhiyuResourcePackPlacement({ schemaVersion: 1, correlationRef });
    } catch {
      return placementFailed('launch-failed');
    } finally {
      this.zhiyuPlacementCorrelations.delete(correlationRef);
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.zhiyuPlacementCorrelations.clear();
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    await this.heartbeatWrite.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    if (server) await closeServer(server);
    await this.removePresenceIfOwned();
  }

  private queueHeartbeat(): void {
    if (this.stopped) return;
    this.heartbeatWrite = this.heartbeatWrite
      .then(() => this.writePresence())
      .catch((error: unknown) => {
        process.stderr.write(`[desktop-open] presence heartbeat failed: ${safeErrorMessage(error)}\n`);
      });
  }

  private async writePresence(): Promise<void> {
    const descriptor: DesktopOpenPresenceDescriptor = {
      schemaVersion: 1,
      desktopAppId: 'nimi.desktop',
      bridgeId: this.bridgeId,
      pid: process.pid,
      endpoint: this.endpoint,
      token: this.token,
      startedAt: this.startedAt,
      lastHeartbeatAt: new Date(this.now()).toISOString(),
    };
    await writeOwnerPrivateAtomicJson(
      this.descriptorPath,
      descriptor,
      'desktop-open-presence',
    );
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST'
      || (request.url !== DESKTOP_OPEN_INTENT_PATH
        && request.url !== DESKTOP_AVATAR_HOST_HANDOFF_PATH
        && request.url !== DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH
        && request.url !== DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH)) {
      writeJson(response, 404, {
        status: 'rejected',
        reasonCode: 'desktop-open-intent-invalid',
        actionHint: 'fix_desktop_open_intent',
      });
      return;
    }
    if (!authorized(request.headers.authorization, this.token)) {
      writeJson(response, 401, rejected(
        this.bridgeId,
        'desktop-open-bridge-auth-failed',
        'check_desktop_runtime_bridge',
      ));
      return;
    }
    const raw = await readJsonBody(request);
    if (request.url === DESKTOP_ZHIYU_RESOURCE_PACK_REDEEM_PATH) {
      const redeemed = this.redeemZhiyuPlacementCorrelation(raw);
      writeJson(response, redeemed ? 200 : 404, {
        bridgeId: this.bridgeId,
        ...(redeemed
          ? { status: 'redeemed', conversationAnchorId: redeemed.conversationAnchorId }
          : { status: 'unavailable', reasonCode: 'correlation-unavailable' }),
      });
      return;
    }
    if (request.url === DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH) {
      try {
        const conversationAnchorId = parsePlacementRequest(raw);
        const result = await this.requestZhiyuResourcePackPlacement({ conversationAnchorId });
        writeJson(response, 200, { bridgeId: this.bridgeId, ...result });
      } catch {
        writeJson(response, 400, { bridgeId: this.bridgeId, ...placementFailed('agent-resolution-failed') });
      }
      return;
    }
    if (request.url === DESKTOP_AVATAR_HOST_HANDOFF_PATH) {
      if (!this.input.avatarHostHandoff) {
        writeJson(response, 503, { code: 'avatar-host-handoff-unavailable' });
        return;
      }
      try {
        const envelope = avatarHostHandoffEnvelope(raw);
        const handoff = envelope.request;
        const result = await this.input.avatarHostHandoff(envelope);
        writeJson(response, 200, {
          bridgeId: this.bridgeId,
          ...parseAvatarHostHandoffResult(result, handoff.command),
        });
      } catch {
        writeJson(response, 400, { code: 'avatar-host-handoff-invalid' });
      }
      return;
    }
    const parsed = safeParseNimiDesktopOpenIntentEnvelope(raw);
    if (!parsed.ok) {
      const reasonCode = parsed.error.reasonCode === 'desktop-open-target-unsupported'
        ? 'desktop-open-target-unsupported'
        : 'desktop-open-intent-invalid';
      writeJson(response, 200, rejected(
        this.bridgeId,
        reasonCode,
        'fix_desktop_open_intent',
      ));
      return;
    }
    if (!this.isRendererReady()) {
      writeJson(response, 200, rejected(
        this.bridgeId,
        'desktop-open-desktop-not-ready',
        'wait_for_desktop_ready',
      ));
      return;
    }
    try {
      await this.input.focusMainWindow();
      this.input.emitIntent(parsed.value);
    } catch {
      this.ready = false;
      this.lastReadyHeartbeatMs = undefined;
      writeJson(response, 200, rejected(
        this.bridgeId,
        'desktop-open-desktop-not-ready',
        'wait_for_desktop_ready',
      ));
      return;
    }
    writeJson(response, 200, {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: this.bridgeId,
      requestId: parsed.value.requestId,
      appliedTarget: parsed.value.intent.kind,
    });
  }

  private redeemZhiyuPlacementCorrelation(value: unknown): {
    readonly conversationAnchorId: string;
  } | null {
    const correlationRef = parsePlacementCorrelationRedemption(value);
    if (!correlationRef) return null;
    const correlation = this.zhiyuPlacementCorrelations.get(correlationRef);
    this.zhiyuPlacementCorrelations.delete(correlationRef);
    if (!correlation || correlation.expiresAt < this.now()) return null;
    return { conversationAnchorId: correlation.conversationAnchorId };
  }

  private removeExpiredZhiyuPlacementCorrelations(): void {
    const now = this.now();
    for (const [ref, correlation] of this.zhiyuPlacementCorrelations) {
      if (correlation.expiresAt < now) this.zhiyuPlacementCorrelations.delete(ref);
    }
  }

  private isRendererReady(): boolean {
    if (!this.ready || this.lastReadyHeartbeatMs === undefined) return false;
    if (this.now() - this.lastReadyHeartbeatMs > this.readinessTtlMs) {
      this.ready = false;
      this.lastReadyHeartbeatMs = undefined;
      return false;
    }
    return true;
  }

  private async removePresenceIfOwned(): Promise<void> {
    try {
      const metadata = await lstat(this.descriptorPath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) return;
      const value = JSON.parse(await readFile(this.descriptorPath, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      if ((value as Record<string, unknown>).bridgeId !== this.bridgeId) return;
      await rm(this.descriptorPath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

type AvatarHostHandoffEnvelope = Readonly<{
  readonly schemaVersion: 1;
  readonly sourceApp: string;
  readonly avatarHostTargetRef: string;
  readonly request: AvatarHostHandoffRequest;
}>;

function avatarHostHandoffEnvelope(value: unknown): AvatarHostHandoffEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('avatar-host-handoff-envelope-invalid');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'avatarHostTargetRef,request,schemaVersion,sourceApp' || record.schemaVersion !== 1) {
    throw new Error('avatar-host-handoff-envelope-invalid');
  }
  const sourceApp = typeof record.sourceApp === 'string' ? record.sourceApp.trim() : '';
  if (!sourceApp || sourceApp !== record.sourceApp || sourceApp.length > 160
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(sourceApp)) {
    throw new Error('avatar-host-handoff-source-app-invalid');
  }
  const avatarHostTargetRef = typeof record.avatarHostTargetRef === 'string'
    ? record.avatarHostTargetRef.trim()
    : '';
  if (avatarHostTargetRef !== record.avatarHostTargetRef
    || !/^avatar_target_[A-Za-z0-9_-]{43}$/u.test(avatarHostTargetRef)) {
    throw new Error('avatar-host-handoff-target-ref-invalid');
  }
  return {
    schemaVersion: 1,
    sourceApp,
    avatarHostTargetRef,
    request: buildAvatarHostHandoffRequest(record.request as AvatarHostHandoffRequest),
  };
}

function parsePlacementCorrelationRedemption(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'correlationRef,schemaVersion' || record.schemaVersion !== 1) return null;
  const correlationRef = typeof record.correlationRef === 'string' ? record.correlationRef.trim() : '';
  return correlationRef === record.correlationRef
    && correlationRef.length <= 160
    && /^zhiyu-placement-[A-Za-z0-9_-]+$/u.test(correlationRef)
    ? correlationRef
    : null;
}

function parsePlacementRequest(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop-zhiyu-placement-request-invalid');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'conversationAnchorId,schemaVersion' || record.schemaVersion !== 1) {
    throw new Error('desktop-zhiyu-placement-request-invalid');
  }
  return boundedPlacementText(record.conversationAnchorId, 'conversation-anchor');
}

function boundedPlacementText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value || text.length > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`desktop-zhiyu-placement-${field}-invalid`);
  }
  return text;
}

function placementUnavailable(
  reasonCode: 'target-app-unavailable' | 'operation-unavailable',
  actionHint: 'start_zhiyu_and_retry' | 'retry_zhiyu_resource_pack_placement',
): NimiElectronAgentCenterResourcePackPlacementResult {
  return { status: 'unavailable', reasonCode, actionHint };
}

function placementFailed(
  reasonCode: 'launch-failed' | 'destination-not-ready' | 'destination-session-failed' | 'agent-resolution-failed',
): NimiElectronAgentCenterResourcePackPlacementResult {
  return { status: 'failed', reasonCode, actionHint: 'retry_zhiyu_resource_pack_placement' };
}

function authorized(value: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(value ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(bytes);
  }
  if (tooLarge) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function rejected(
  bridgeId: string,
  reasonCode: NimiDesktopOpenResultReasonCode,
  actionHint: 'wait_for_desktop_ready' | 'fix_desktop_open_intent' | 'check_desktop_runtime_bridge',
): DesktopOpenIntentResponse {
  return { status: 'rejected', bridgeId, reasonCode, actionHint };
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

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('desktop-open-intent-http-shutdown-timeout'));
    }, 5_000);
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
