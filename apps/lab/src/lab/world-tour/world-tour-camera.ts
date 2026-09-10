import { isJsonObject } from '@nimiplatform/sdk/types';

export type WorldTourCameraPreset = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
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
  return { position: value.position as WorldTourCameraPreset['position'], quaternion, fov: value.fov };
}
