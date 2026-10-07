import { isJsonObject } from '@nimiplatform/sdk/types';

export type WorldTourCameraPreset = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  archiveSha256?: string;
  navigation?: { mode: 'walk' | 'fly'; bodyHeight: number; radius: number };
};

export function parseWorldTourCameraPreset(value: unknown): WorldTourCameraPreset {
  if (!isJsonObject(value)
    || !Array.isArray(value.position) || value.position.length !== 3 || !value.position.every(Number.isFinite)
    || !Array.isArray(value.quaternion) || value.quaternion.length !== 4 || !value.quaternion.every(Number.isFinite)
    || typeof value.fov !== 'number' || !Number.isFinite(value.fov) || value.fov < 20 || value.fov > 120) {
    throw new Error('world-tour-camera-preset-invalid');
  }
  const quaternion = value.quaternion as WorldTourCameraPreset['quaternion'];
  if (Math.abs(Math.hypot(...quaternion) - 1) > 0.01) throw new Error('world-tour-camera-preset-invalid');
  if (value.archiveSha256 !== undefined && (typeof value.archiveSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.archiveSha256))) throw new Error('world-tour-camera-preset-invalid');
  let navigation: WorldTourCameraPreset['navigation'];
  if (value.navigation !== undefined) {
    const n = value.navigation;
    if (!isJsonObject(n) || (n.mode !== 'walk' && n.mode !== 'fly') || typeof n.bodyHeight !== 'number' || typeof n.radius !== 'number' ||
        !Number.isFinite(n.bodyHeight) || !Number.isFinite(n.radius) || n.bodyHeight < 0.5 || n.bodyHeight > 2.4 || n.radius < 0.1 || n.radius > 0.4 || n.bodyHeight <= 2 * n.radius) throw new Error('world-tour-camera-preset-invalid');
    navigation = { mode: n.mode, bodyHeight: n.bodyHeight, radius: n.radius };
  }
  return { ...(value.archiveSha256 ? { archiveSha256: value.archiveSha256 } : {}), ...(navigation ? { navigation } : {}), position: value.position as WorldTourCameraPreset['position'], quaternion, fov: value.fov };
}

export function assertWorldCameraArchive(pose: WorldTourCameraPreset, archiveSha256: string | undefined): void {
  if (pose.archiveSha256 && pose.archiveSha256 !== archiveSha256) throw new Error('world-camera-archive-mismatch');
}
