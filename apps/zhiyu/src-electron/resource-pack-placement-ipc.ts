export const ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL = 'nimi:zhiyu:resource-pack-placement:event';
export const ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL = 'nimi:zhiyu:resource-pack-placement:ack';

export type ZhiyuResourcePackPlacementEvent = Readonly<{
  schemaVersion: 1;
  requestId: string;
  agentHandle: string;
}>;

export type ZhiyuResourcePackPlacementAck = Readonly<
  | {
      schemaVersion: 1;
      requestId: string;
      status: 'ready';
      reasonCode: 'zhiyu-resource-pack-placement-ready';
    }
  | {
      schemaVersion: 1;
      requestId: string;
      status: 'failed';
      reasonCode: 'destination-session-failed' | 'agent-resolution-failed';
    }
>;

export function parseZhiyuResourcePackPlacementAck(value: unknown): ZhiyuResourcePackPlacementAck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('zhiyu-resource-pack-placement-ack-invalid');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [
    'reasonCode',
    'requestId',
    'schemaVersion',
    'status',
  ].sort().join(',') || record.schemaVersion !== 1) {
    throw new Error('zhiyu-resource-pack-placement-ack-invalid');
  }
  const requestId = placementRequestId(record.requestId);
  if (record.status === 'ready' && record.reasonCode === 'zhiyu-resource-pack-placement-ready') {
    return Object.freeze({
      schemaVersion: 1,
      requestId,
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
  }
  if (record.status === 'failed'
    && (record.reasonCode === 'destination-session-failed' || record.reasonCode === 'agent-resolution-failed')) {
    return Object.freeze({
      schemaVersion: 1,
      requestId,
      status: 'failed',
      reasonCode: record.reasonCode,
    });
  }
  throw new Error('zhiyu-resource-pack-placement-ack-invalid');
}

export function placementRequestId(value: unknown): string {
  const requestId = typeof value === 'string' ? value.trim() : '';
  if (!requestId || requestId !== value || requestId.length > 160
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(requestId)) {
    throw new Error('zhiyu-resource-pack-placement-request-id-invalid');
  }
  return requestId;
}
