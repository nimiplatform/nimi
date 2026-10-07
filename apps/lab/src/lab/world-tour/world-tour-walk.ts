import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { WorldCollisionGeometry } from './world-tour-collider.js';

let initialized: Promise<void> | undefined;
export type WorldBodySize = { bodyHeight: number; radius: number };
export function validateWorldBodySize(size: WorldBodySize): void {
  if (!Number.isFinite(size.bodyHeight) || !Number.isFinite(size.radius) || size.bodyHeight < 0.5 || size.bodyHeight > 2.4 ||
      size.radius < 0.1 || size.radius > 0.4 || size.bodyHeight <= 2 * size.radius) throw new Error('world-body-size-invalid');
}

export async function createWorldWalk(geometry: WorldCollisionGeometry, origin: THREE.Vector3, size: WorldBodySize) {
  validateWorldBodySize(size);
  if (![origin.x, origin.y, origin.z].every(Number.isFinite)) throw new Error('world-origin-invalid');
  size = { bodyHeight: size.bodyHeight, radius: size.radius };
  await (initialized ??= RAPIER.init());
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const terrain = world.createCollider(RAPIER.ColliderDesc.trimesh(geometry.vertices, geometry.indices));
  const halfHeight = size.bodyHeight / 2;
  const eyeOffset = size.bodyHeight * 0.4;
  const shape = new RAPIER.Capsule(halfHeight - size.radius, size.radius);
  const character = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight - size.radius, size.radius).setSensor(true));
  const controller = world.createCharacterController(0.015);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 3);
  controller.disableAutostep();
  controller.enableSnapToGround(0.2);
  world.step();
  let disposed = false;
  let blockedSteps = 0;
  const terrainOnly = (c: RAPIER.Collider) => c.handle === terrain.handle;
  const floorAt = (x: number, z: number, startY: number, distance: number) => {
    const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 }), distance,
      true, undefined, undefined, character, undefined, terrainOnly);
    if (!hit || hit.normal.y < Math.SQRT1_2) return null;
    return startY - hit.timeOfImpact;
  };
  const clearAt = (position: THREE.Vector3) =>
    position.x - size.radius >= geometry.bounds.min.x && position.x + size.radius <= geometry.bounds.max.x &&
    position.z - size.radius >= geometry.bounds.min.z && position.z + size.radius <= geometry.bounds.max.z &&
    !world.intersectionWithShape(position, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, undefined, character, undefined, terrainOnly);
  const supportedAt = (center: THREE.Vector3) => {
    if (!clearAt(center)) return false;
    const bottom = center.y - halfHeight;
    for (const [dx, dz] of [[0, 0], [size.radius * 0.7, 0], [-size.radius * 0.7, 0], [0, size.radius * 0.7], [0, -size.radius * 0.7]]) {
      const floor = floorAt(center.x + dx!, center.z + dz!, bottom + 0.08, 0.3);
      if (floor === null || bottom - floor < -0.025 || bottom - floor > 0.22) return false;
    }
    return true;
  };
  const findSpawn = (): THREE.Vector3 | null => {
    let best: THREE.Vector3 | null = null; let score = Infinity;
    // Search downward from the admitted initial viewpoint, not the mesh
    // maximum. This finds open platforms without starting above an indoor roof.
    const rayY = origin.y + 0.08;
    for (let ix = -6; ix <= 6; ix++) for (let iz = -6; iz <= 6; iz++) {
      const x = origin.x + ix * 0.4, z = origin.z + iz * 0.4;
      if (x < geometry.bounds.min.x + size.radius || x > geometry.bounds.max.x - size.radius ||
          z < geometry.bounds.min.z + size.radius || z > geometry.bounds.max.z - size.radius) continue;
      const floor = floorAt(x, z, rayY, rayY - geometry.bounds.min.y + 0.2);
      if (floor === null) continue;
      const candidate = new THREE.Vector3(x, floor + halfHeight + 0.02, z);
      if (!supportedAt(candidate)) continue;
      const nextScore = Math.abs(floor) * 3 + Math.hypot(x - origin.x, z - origin.z);
      if (nextScore < score) { best = candidate; score = nextScore; }
    }
    return best;
  };
  const flyShape = new RAPIER.Ball(0.06);
  const findFlyEye = (): THREE.Vector3 | null => {
    let best: THREE.Vector3 | null = null; let score = Infinity;
    const rayY = origin.y + 0.08;
    for (let ix=-6;ix<=6;ix++) for(let iz=-6;iz<=6;iz++) {
      const x=origin.x+ix*0.4,z=origin.z+iz*0.4;
      const floor=floorAt(x,z,rayY,rayY-geometry.bounds.min.y+0.2); if(floor===null)continue;
      const eye=new THREE.Vector3(x, Math.max(origin.y, floor + 0.12), z);
      if (world.intersectionWithShape(eye,{x:0,y:0,z:0,w:1},flyShape,undefined,undefined,character,undefined,terrainOnly))continue;
      const s=Math.hypot(x-origin.x,z-origin.z)+Math.abs(floor)*3;
      if(s<score){best=eye;score=s}
    }
    return best;
  };
  const spawn = findSpawn();
  if (spawn) { character.setTranslation(spawn); world.step(); }
  const eye = () => {
    const p = character.translation(); return new THREE.Vector3(p.x, p.y + eyeOffset, p.z);
  };
  const move = (direction: THREE.Vector3, seconds: number, speed: number) => {
    if (disposed || !spawn) throw new Error('world-walk-unavailable');
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(speed) || speed < 0 || speed > 5) throw new Error('world-walk-step-invalid');
    const time = Math.min(seconds, 0.1), count = Math.max(1, Math.ceil(time * 120)), dt = time / count;
    const horizontal = direction.clone().setY(0); if (horizontal.lengthSq() > 1) horizontal.normalize();
    for (let i = 0; i < count; i++) {
      controller.computeColliderMovement(character, { x: horizontal.x * speed * dt, y: -0.8 * dt, z: horizontal.z * speed * dt },
        undefined, undefined, terrainOnly);
      const delta = controller.computedMovement(), old = character.translation();
      const next = new THREE.Vector3(old.x + delta.x, old.y + delta.y, old.z + delta.z);
      if (supportedAt(next)) { character.setTranslation(next); world.step(); }
      else blockedSteps++;
    }
    return eye();
  };
  return {
    available: Boolean(spawn), size, safeFlightEye: findFlyEye(), spawnEye: spawn ? spawn.clone().add(new THREE.Vector3(0, eyeOffset, 0)) : null,
    move, readEye: eye,
    reset: () => { if (!spawn || disposed) throw new Error('world-walk-unavailable'); character.setTranslation(spawn); world.step(); return eye(); },
    applyEye: (position: THREE.Vector3) => {
      if (disposed || !spawn) throw new Error('world-walk-unavailable');
      const center = position.clone().add(new THREE.Vector3(0, -eyeOffset, 0));
      if (!supportedAt(center)) throw new Error('world-walk-viewpoint-unsafe');
      character.setTranslation(center); world.step(); return eye();
    },
    readState: () => ({ available: Boolean(spawn), size, grounded: !disposed && spawn ? supportedAt(new THREE.Vector3().copy(character.translation())) : false, blockedSteps }),
    dispose: () => { if (disposed) return; disposed = true; world.free(); },
  };
}
