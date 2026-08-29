export type ZhiyuResourcePackPlacementRequest = Readonly<{
  agentHandle: string;
}>;

export type ZhiyuResourcePackPlacementAck = Readonly<
  | {
      status: 'ready';
      reasonCode: 'zhiyu-resource-pack-placement-ready';
    }
  | {
      status: 'failed';
      reasonCode: 'destination-session-failed' | 'agent-resolution-failed';
    }
>;

type ZhiyuResourcePackPlacementBridge = Readonly<{
  subscribe(listener: (payload: unknown) => void): () => void;
  acknowledge(payload: unknown): void;
}>;

declare global {
  interface Window {
    readonly __nimiZhiyuResourcePackPlacement?: ZhiyuResourcePackPlacementBridge;
  }
}

export function subscribeZhiyuResourcePackPlacement(
  listener: (request: ZhiyuResourcePackPlacementRequest) => void,
): () => void {
  const bridge = window.__nimiZhiyuResourcePackPlacement;
  if (!bridge) return () => undefined;
  return bridge.subscribe((payload) => listener(parsePlacementRequest(payload)));
}

export function acknowledgeZhiyuResourcePackPlacement(
  ack: ZhiyuResourcePackPlacementAck,
): void {
  const bridge = window.__nimiZhiyuResourcePackPlacement;
  if (!bridge) throw new Error('Zhiyu Resource Pack placement bridge is unavailable.');
  bridge.acknowledge({ schemaVersion: 1, ...parsePlacementAck(ack) });
}

function parsePlacementRequest(value: unknown): ZhiyuResourcePackPlacementRequest {
  const record = exactRecord(value, [
    'agentHandle',
    'schemaVersion',
  ]);
  if (record.schemaVersion !== 1) throw new Error('Zhiyu Resource Pack placement request is invalid.');
  return Object.freeze({
    agentHandle: exactAgentHandle(record.agentHandle),
  });
}

function parsePlacementAck(value: ZhiyuResourcePackPlacementAck): ZhiyuResourcePackPlacementAck {
  if (value.status === 'ready' && value.reasonCode === 'zhiyu-resource-pack-placement-ready') {
    return Object.freeze({ status: value.status, reasonCode: value.reasonCode });
  }
  if (value.status === 'failed'
    && (value.reasonCode === 'destination-session-failed' || value.reasonCode === 'agent-resolution-failed')) {
    return Object.freeze({ status: value.status, reasonCode: value.reasonCode });
  }
  throw new Error('Zhiyu Resource Pack placement acknowledgement is invalid.');
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Zhiyu Resource Pack placement payload is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('Zhiyu Resource Pack placement payload is invalid.');
  }
  return record;
}

function exactAgentHandle(value: unknown): string {
  const handle = typeof value === 'string' ? value.trim() : '';
  if (!handle || handle !== value || handle.length > 256 || /[\u0000-\u001f\u007f]/u.test(handle)) {
    throw new Error('Zhiyu Resource Pack placement Agent handle is invalid.');
  }
  return handle;
}
