import {
  readDesktopOpenJsonResponse,
  resolveDesktopOpenFetch,
  resolveDesktopOpenPresenceDescriptor,
} from './desktop-open.js';
import type {
  NimiElectronAgentCenterResourcePackPlacementResult,
  NimiElectronStandardShellHost,
} from './types.js';

export const DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH = '/v1/agent-center-resource-pack-placement/request';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function requestElectronAgentCenterResourcePackPlacement(input: {
  readonly host?: NimiElectronStandardShellHost;
  readonly conversationAnchorId: string;
  readonly requestTimeoutMs?: number;
}): Promise<NimiElectronAgentCenterResourcePackPlacementResult> {
  const conversationAnchorId = exactAnchor(input.conversationAnchorId);
  const descriptorResult = await resolveDesktopOpenPresenceDescriptor(input.host);
  if (!descriptorResult.ok) {
    return placementUnavailable('target-app-unavailable', 'start_zhiyu_and_retry');
  }
  const fetchImpl = resolveDesktopOpenFetch(input.host);
  if (!fetchImpl) {
    return placementUnavailable('operation-unavailable', 'retry_zhiyu_resource_pack_placement');
  }
  const descriptor = descriptorResult.descriptor;
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort('agent_center_resource_pack_placement_timeout'),
    input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  timer.unref?.();
  try {
    const response = await fetchImpl(`${descriptor.endpoint}${DESKTOP_AGENT_CENTER_RESOURCE_PACK_PLACEMENT_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${descriptor.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schemaVersion: 1, conversationAnchorId }),
      signal: abort.signal,
    });
    if (response.status === 401 || response.status === 403) return placementFailed('launch-failed');
    const raw = await readDesktopOpenJsonResponse(response);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return placementFailed('destination-not-ready');
    const record = raw as Record<string, unknown>;
    if (record.bridgeId !== descriptor.bridgeId) return placementFailed('launch-failed');
    return parseElectronAgentCenterResourcePackPlacementResult(record);
  } catch {
    return abort.signal.aborted
      ? placementFailed('destination-not-ready')
      : placementUnavailable('target-app-unavailable', 'start_zhiyu_and_retry');
  } finally {
    clearTimeout(timer);
  }
}

export function parseElectronAgentCenterResourcePackPlacementResult(
  value: unknown,
): NimiElectronAgentCenterResourcePackPlacementResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return placementFailed('destination-not-ready');
  const record = value as Record<string, unknown>;
  if (record.status === 'ready'
    && record.reasonCode === 'zhiyu-resource-pack-placement-ready'
    && exactKeys(record, ['bridgeId', 'status', 'reasonCode'])) {
    return { status: 'ready', reasonCode: 'zhiyu-resource-pack-placement-ready' };
  }
  if (record.status === 'unavailable'
    && (record.reasonCode === 'target-app-unavailable' || record.reasonCode === 'operation-unavailable')
    && (record.actionHint === 'start_zhiyu_and_retry' || record.actionHint === 'retry_zhiyu_resource_pack_placement')
    && exactKeys(record, ['bridgeId', 'status', 'reasonCode', 'actionHint'])) {
    return {
      status: 'unavailable',
      reasonCode: record.reasonCode,
      actionHint: record.actionHint,
    };
  }
  if (record.status === 'failed'
    && (record.reasonCode === 'launch-failed'
      || record.reasonCode === 'destination-not-ready'
      || record.reasonCode === 'destination-session-failed'
      || record.reasonCode === 'agent-resolution-failed')
    && record.actionHint === 'retry_zhiyu_resource_pack_placement'
    && exactKeys(record, ['bridgeId', 'status', 'reasonCode', 'actionHint'])) {
    return {
      status: 'failed',
      reasonCode: record.reasonCode,
      actionHint: 'retry_zhiyu_resource_pack_placement',
    };
  }
  return placementFailed('destination-not-ready');
}

function exactAnchor(value: unknown): string {
  const anchor = typeof value === 'string' ? value.trim() : '';
  if (!anchor || anchor !== value || anchor.length > 256 || /[\u0000-\u001f\u007f]/u.test(anchor)) {
    throw new Error('agent-center-resource-pack-placement-anchor-invalid');
  }
  return anchor;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index]);
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
