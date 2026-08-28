import crypto from 'node:crypto';
import type { AgentCenterScope } from './agent-center-contract.js';

export function avatarMaterializationRef(
  scope: AgentCenterScope,
  kind: 'live2d' | 'vrm',
  avatarAssetRef: string,
): string {
  return `agent-center-avatar-asset:${custodySegment(scope.accountId)}:${custodySegment(scope.localAgentRef)}:${kind}:${avatarAssetRef}`;
}

export function sha256(bytes: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function custodySegment(value: string): string {
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/u.test(body)) {
    return value;
  }
  return `id_${sha256(value).slice(0, 24)}`;
}
