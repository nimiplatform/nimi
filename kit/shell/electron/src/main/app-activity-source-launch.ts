import {
  readDesktopOpenJsonResponse,
  resolveDesktopOpenFetch,
  resolveDesktopOpenPresenceDescriptor,
} from './desktop-open.js';
import type { NimiElectronStandardShellHost } from './types.js';

export const DESKTOP_APP_ACTIVITY_SOURCE_LAUNCH_PATH = '/v1/app-activity-source-launch';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const OPEN_REQUEST_ID_PATTERN = /^aor_[A-Za-z0-9_-]{32}$/u;

export type NimiElectronAppActivitySourceLaunchResult =
  | { readonly status: 'requested' }
  | { readonly status: 'unavailable'; readonly reason: 'host-unavailable' | 'source-unavailable' }
  | { readonly status: 'failed'; readonly reason: 'launch-failed' };

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-005
/**
 * Asks the running Desktop Host to launch or focus the exact source of one
 * Runtime-issued open request. The request id is Host-private and carries no
 * authority by itself; Desktop resolves the source through Runtime. This never
 * starts Desktop and never reports navigation success.
 */
export async function requestElectronAppActivitySourceLaunch(input: {
  readonly host?: NimiElectronStandardShellHost;
  readonly openRequestId: string;
  readonly requestTimeoutMs?: number;
}): Promise<NimiElectronAppActivitySourceLaunchResult> {
  if (!OPEN_REQUEST_ID_PATTERN.test(input.openRequestId)) return { status: 'failed', reason: 'launch-failed' };
  const descriptorResult = await resolveDesktopOpenPresenceDescriptor(input.host);
  if (!descriptorResult.ok) return { status: 'unavailable', reason: 'host-unavailable' };
  const fetchImpl = resolveDesktopOpenFetch(input.host);
  if (!fetchImpl) return { status: 'unavailable', reason: 'host-unavailable' };
  const descriptor = descriptorResult.descriptor;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort('app_activity_source_launch_timeout'), input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${descriptor.endpoint}${DESKTOP_APP_ACTIVITY_SOURCE_LAUNCH_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, openRequestId: input.openRequestId }),
      signal: abort.signal,
    });
    if (response.status === 401 || response.status === 403) return { status: 'unavailable', reason: 'host-unavailable' };
    const raw = await readDesktopOpenJsonResponse(response);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'failed', reason: 'launch-failed' };
    const record = raw as Record<string, unknown>;
    if (record.bridgeId !== descriptor.bridgeId) return { status: 'failed', reason: 'launch-failed' };
    return parseElectronAppActivitySourceLaunchResult(record);
  } catch {
    return abort.signal.aborted
      ? { status: 'failed', reason: 'launch-failed' }
      : { status: 'unavailable', reason: 'host-unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

export function parseElectronAppActivitySourceLaunchResult(value: Record<string, unknown>): NimiElectronAppActivitySourceLaunchResult {
  const keys = Object.keys(value).filter((key) => key !== 'bridgeId').sort().join(',');
  if (value.status === 'requested' && keys === 'status') return { status: 'requested' };
  if (keys === 'reason,status' && value.status === 'unavailable'
    && (value.reason === 'host-unavailable' || value.reason === 'source-unavailable')) {
    return { status: 'unavailable', reason: value.reason };
  }
  return { status: 'failed', reason: 'launch-failed' };
}
