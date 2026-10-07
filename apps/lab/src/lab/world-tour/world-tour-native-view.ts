import * as THREE from 'three';

// A scene-unit browsing anchor, never a calibrated floor or collision spawn.
export function nativeWorldBrowsingAnchor(bounds: THREE.Box3, object?: THREE.Object3D): { origin: THREE.Vector3; speed: number } {
  if (object) {
    object.updateWorldMatrix(true, false);
    bounds = bounds.clone().applyMatrix4(object.matrixWorld);
  }
  const extent = bounds.getSize(new THREE.Vector3()).length();
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), extent].every(Number.isFinite) || extent <= 0) throw new Error('world-scene-bounds-invalid');
  const origin = new THREE.Vector3();
  if (!bounds.containsPoint(origin)) bounds.getCenter(origin);
  return { origin, speed: Math.max(extent * 0.03, 0.01) };
}
