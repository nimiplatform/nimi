import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type WorldCollisionGeometry = { vertices: Float32Array; indices: Uint32Array; bounds: THREE.Box3 };

export function worldSpatialTransform(scale: number, ground: number, coordinateSystem: 'opencv' | 'spz-rub' = 'opencv'): THREE.Matrix4 {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(ground) || (coordinateSystem !== 'opencv' && coordinateSystem !== 'spz-rub')) throw new Error('world-spatial-metadata-invalid');
  return new THREE.Matrix4().compose(new THREE.Vector3(0, ground, 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), coordinateSystem === 'opencv' ? Math.PI : 0), new THREE.Vector3(scale, scale, scale));
}

export function validateEmbeddedCollider(bytes: Uint8Array): void {
  if (bytes.byteLength < 24 || bytes.byteLength > 32 * 1024 * 1024) throw new Error('world-collider-size-invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a || view.getUint32(12, true) > 1024 * 1024 || view.getUint32(12, true) > bytes.byteLength - 20) throw new Error('world-collider-glb-invalid');
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'uri' && (typeof item !== 'string' || !item.startsWith('data:'))) throw new Error('world-collider-external-resource');
      visit(item);
    }
  };
  visit(json);
}

export async function loadWorldCollisionGeometry(bytes: Uint8Array, scale: number, ground: number, coordinateSystem: 'opencv' | 'spz-rub' = 'opencv'): Promise<WorldCollisionGeometry> {
  validateEmbeddedCollider(bytes);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('world-collider-external-resource');
    return url;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes.slice().buffer, '');
  const transform = worldSpatialTransform(scale, ground, coordinateSystem);
  const positions: number[] = [], indices: number[] = [];
  const bounds = new THREE.Box3(); const point = new THREE.Vector3();
  try {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node instanceof THREE.SkinnedMesh || node.morphTargetInfluences?.length) throw new Error('world-collider-deforming-mesh');
      const position = node.geometry.getAttribute('position');
      if (!position || position.itemSize !== 3 || positions.length / 3 + position.count > 1_000_000) throw new Error('world-collider-geometry-limit');
      const matrix = new THREE.Matrix4().multiplyMatrices(transform, node.matrixWorld);
      if (!matrix.elements.every(Number.isFinite)) throw new Error('world-collider-transform-invalid');
      const base = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(matrix);
        if (![point.x, point.y, point.z].every(Number.isFinite) || point.length() > 10_000) throw new Error('world-collider-position-invalid');
        positions.push(point.x, point.y, point.z); bounds.expandByPoint(point);
      }
      const index = node.geometry.index; const count = index?.count ?? position.count;
      if (count % 3 || indices.length + count > 3_000_000) throw new Error('world-collider-index-limit');
      for (let i = 0; i < count; i++) {
        const value = index ? index.getX(i) : i;
        if (!Number.isInteger(value) || value < 0 || value >= position.count) throw new Error('world-collider-index-invalid');
        indices.push(base + value);
      }
    });
    if (!positions.length || !indices.length || bounds.isEmpty()) throw new Error('world-collider-empty');
    return { vertices: new Float32Array(positions), indices: new Uint32Array(indices), bounds };
  } finally {
    gltf.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
  }
}
