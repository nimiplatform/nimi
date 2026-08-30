import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseElectronAgentCenterResourcePackPlacementResult,
  type NimiElectronAgentCenterResourcePackPlacementResult,
} from '@nimiplatform/kit/shell/electron/main';

export const ZHIYU_RESOURCE_PACK_PLACEMENT_PATH = '/v1/agent-center-resource-pack-placement';

const PRESENCE_RELATIVE_PATH = ['.nimi', 'run', 'zhiyu', 'resource-pack-placement', 'presence.v1.json'] as const;
const DEFAULT_HEARTBEAT_MAX_AGE_MS = 10_000;
const DEFAULT_LAUNCH_WAIT_MS = 8_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const LAUNCH_POLL_MS = 100;

export type DesktopZhiyuResourcePackPlacementDispatch = Readonly<{
  schemaVersion: 1;
  correlationRef: string;
}>;

type ZhiyuPlacementPresenceDescriptor = Readonly<{
  bridgeId: string;
  endpoint: string;
  token: string;
  lastHeartbeatAt: string;
}>;

type PlacementFetchResponse = Readonly<{
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

type PlacementFetch = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  }>,
) => Promise<PlacementFetchResponse>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function requestRunningZhiyuResourcePackPlacement(input: {
  readonly homeDirectory: string;
  readonly request: DesktopZhiyuResourcePackPlacementDispatch;
  readonly startExactZhiyu?: () => Promise<boolean>;
  readonly fetch?: PlacementFetch;
  readonly now?: () => number;
  readonly maxHeartbeatAgeMs?: number;
  readonly launchWaitMs?: number;
  readonly requestTimeoutMs?: number;
}): Promise<NimiElectronAgentCenterResourcePackPlacementResult> {
  let request: DesktopZhiyuResourcePackPlacementDispatch;
  try {
    request = parseDispatch(input.request);
  } catch {
    return placementFailed('launch-failed');
  }

  const readDescriptor = () => resolvePresenceDescriptor({
    homeDirectory: input.homeDirectory,
    now: input.now?.() ?? Date.now(),
    maxHeartbeatAgeMs: input.maxHeartbeatAgeMs ?? DEFAULT_HEARTBEAT_MAX_AGE_MS,
  });
  let descriptor = await readDescriptor();
  if (!descriptor && input.startExactZhiyu) {
    const started = await input.startExactZhiyu().catch(() => false);
    if (started) {
      const deadline = Date.now() + (input.launchWaitMs ?? DEFAULT_LAUNCH_WAIT_MS);
      while (!descriptor && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_POLL_MS));
        descriptor = await readDescriptor();
      }
    }
  }
  if (!descriptor) return placementUnavailable('target-app-unavailable', 'start_zhiyu_and_retry');

  const fetchImpl = input.fetch ?? (typeof globalThis.fetch === 'function'
    ? ((url, init) => globalThis.fetch(url, init) as Promise<PlacementFetchResponse>)
    : undefined);
  if (!fetchImpl) return placementUnavailable('operation-unavailable', 'retry_zhiyu_resource_pack_placement');

  let response: PlacementFetchResponse;
  const requestAbort = new AbortController();
  const requestTimer = setTimeout(
    () => requestAbort.abort('zhiyu_resource_pack_placement_timeout'),
    input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  requestTimer.unref?.();
  try {
    response = await fetchImpl(`${descriptor.endpoint}${ZHIYU_RESOURCE_PACK_PLACEMENT_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: requestAbort.signal,
    });
  } catch {
    if (requestAbort.signal.aborted) return placementFailed('destination-not-ready');
    return placementUnavailable('target-app-unavailable', 'start_zhiyu_and_retry');
  } finally {
    clearTimeout(requestTimer);
  }
  if (response.status === 401 || response.status === 403) return placementFailed('launch-failed');

  try {
    const raw = typeof response.json === 'function'
      ? await response.json()
      : typeof response.text === 'function'
        ? JSON.parse(await response.text()) as unknown
        : undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return placementFailed('destination-not-ready');
    const record = raw as Record<string, unknown>;
    if (record.bridgeId !== descriptor.bridgeId) return placementFailed('launch-failed');
    return parseElectronAgentCenterResourcePackPlacementResult(record);
  } catch {
    return placementFailed('destination-not-ready');
  }
}

async function resolvePresenceDescriptor(input: {
  readonly homeDirectory: string;
  readonly now: number;
  readonly maxHeartbeatAgeMs: number;
}): Promise<ZhiyuPlacementPresenceDescriptor | null> {
  const descriptorPath = path.join(path.resolve(input.homeDirectory), ...PRESENCE_RELATIVE_PATH);
  try {
    await assertNoSymlinkAncestry(descriptorPath);
    return parsePresenceDescriptor(await readFile(descriptorPath, 'utf8'), input.now, input.maxHeartbeatAgeMs);
  } catch {
    return null;
  }
}

function parseDispatch(value: unknown): DesktopZhiyuResourcePackPlacementDispatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('placement-dispatch-invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'correlationRef,schemaVersion' || record.schemaVersion !== 1) {
    throw new Error('placement-dispatch-invalid');
  }
  return Object.freeze({ schemaVersion: 1, correlationRef: correlationRef(record.correlationRef) });
}

function parsePresenceDescriptor(text: string, now: number, maxHeartbeatAgeMs: number): ZhiyuPlacementPresenceDescriptor {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('placement-presence-invalid');
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [
    'appId', 'bridgeId', 'endpoint', 'lastHeartbeatAt', 'pid', 'purpose', 'schemaVersion', 'startedAt', 'token',
  ].sort().join(',')
    || record.schemaVersion !== 1
    || record.appId !== 'nimi.zhiyu'
    || record.purpose !== 'agent-center-resource-pack-placement'
    || !Number.isSafeInteger(record.pid)
    || Number(record.pid) <= 0) {
    throw new Error('placement-presence-invalid');
  }
  const descriptor = {
    bridgeId: requiredText(record.bridgeId),
    endpoint: loopbackOrigin(record.endpoint),
    token: requiredText(record.token),
    lastHeartbeatAt: requiredText(record.lastHeartbeatAt),
  };
  const heartbeat = Date.parse(descriptor.lastHeartbeatAt);
  if (!Number.isFinite(heartbeat) || now - heartbeat > maxHeartbeatAgeMs) throw new Error('placement-presence-stale');
  return descriptor;
}

async function assertNoSymlinkAncestry(candidate: string): Promise<void> {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error('placement-presence-symlink');
    if (current === resolved && !metadata.isFile()) throw new Error('placement-presence-not-file');
  }
}

function loopbackOrigin(value: unknown): string {
  const parsed = new URL(requiredText(value));
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'http:'
    || (hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1')
    || !parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('placement-endpoint-invalid');
  }
  return parsed.origin;
}

function correlationRef(value: unknown): string {
  const ref = requiredText(value);
  if (ref.length > 160 || !/^zhiyu-placement-[A-Za-z0-9_-]+$/u.test(ref)) throw new Error('placement-correlation-invalid');
  return ref;
}

function requiredText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value) throw new Error('placement-text-invalid');
  return text;
}

function placementUnavailable(
  reasonCode: 'target-app-unavailable' | 'operation-unavailable',
  actionHint: 'start_zhiyu_and_retry' | 'retry_zhiyu_resource_pack_placement',
): NimiElectronAgentCenterResourcePackPlacementResult {
  return Object.freeze({ status: 'unavailable', reasonCode, actionHint });
}

function placementFailed(
  reasonCode: 'launch-failed' | 'destination-not-ready' | 'destination-session-failed' | 'agent-resolution-failed',
): NimiElectronAgentCenterResourcePackPlacementResult {
  return Object.freeze({ status: 'failed', reasonCode, actionHint: 'retry_zhiyu_resource_pack_placement' });
}
