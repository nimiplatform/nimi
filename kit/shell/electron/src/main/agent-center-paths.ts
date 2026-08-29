import crypto from 'node:crypto';

export function avatarMaterializationRef(
  kind: 'live2d' | 'vrm',
  avatarAssetRef: string,
): string {
  return `avatar-materialization:${kind}:${avatarAssetRef}`;
}

export function sha256(bytes: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
