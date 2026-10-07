import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const OBJECT_MAX_BYTES = 16 * 1024 * 1024;
export const OBJECT_MAX_VERTICES = 250_000;
export const OBJECT_MAX_TRIANGLES = 500_000;
export type ObjectBudget = { vertices: number; triangles: number; textureBytes: number };
export type LoadedWorldObject = ObjectBudget & { root: THREE.Group; dimensions: [number, number, number]; dispose(): void };

const allowedExtensions = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_emissive_strength']);
function invalid(): never { throw new Error('world-object-invalid'); }
function limit(): never { throw new Error('world-object-limit'); }
function unsupported(): never { throw new Error('world-object-unsupported'); }
function record(value: unknown): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, any>; }
function integer(value: unknown, max: number): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) invalid(); return Number(value); }

function imagePixels(bytes: Uint8Array, mime: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === 'image/png' && bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker!)) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break; }
      offset += length;
    }
  } else unsupported();
  if (!width || !height) invalid();
  if (width > 2048 || height > 2048) limit();
  return width * height;
}

// File, geometry and image budgets are checked before GLTFLoader can allocate
// decoded buffers/textures. Only BIN-backed resources are admitted.
export function validateWorldObjectGLB(bytes: Uint8Array): ObjectBudget {
  if (bytes.length < 28) invalid();
  if (bytes.length > OBJECT_MAX_BYTES) limit();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) invalid();
  const jsonLength = view.getUint32(12, true);
  if (!jsonLength || jsonLength > 1024 * 1024 || jsonLength % 4 || 20 + jsonLength + 8 > bytes.length) invalid();
  const document = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength))));
  const binOffset = 28 + jsonLength, binLength = view.getUint32(20 + jsonLength, true);
  if (view.getUint32(24 + jsonLength, true) !== 0x004e4942 || binOffset + binLength !== bytes.length || binLength % 4 || record(document.asset).version !== '2.0') invalid();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'uri') throw new Error('world-object-external');
      if (key === 'extensions') for (const name of Object.keys(record(item))) if (!allowedExtensions.has(name)) unsupported();
      visit(item);
    }
  };
  visit(document);
  for (const name of [...document.extensionsUsed ?? [], ...document.extensionsRequired ?? []]) if (!allowedExtensions.has(name)) unsupported();
  if (document.animations?.length || document.skins?.length || document.cameras?.length) unsupported();
  if (!Array.isArray(document.buffers) || document.buffers.length !== 1 || integer(record(document.buffers[0]).byteLength, binLength) < binLength - 3) invalid();
  const bufferViews: Record<string, any>[] = document.bufferViews?.map(record) ?? [];
  for (const bv of bufferViews) if (bv.buffer !== 0 || integer(bv.byteOffset ?? 0, binLength) + integer(bv.byteLength, binLength) > binLength) invalid();
  const accessors: Record<string, any>[] = document.accessors?.map(record) ?? [];
  if (accessors.length > 1024) limit();
  for (const accessor of accessors) { integer(accessor.count, 1_500_000); if (accessor.sparse) integer(record(accessor.sparse).count, accessor.count); }
  const nodes: Record<string, any>[] = document.nodes?.map(record) ?? [];
  const meshes: Record<string, any>[] = document.meshes?.map(record) ?? [];
  if (nodes.length > 256 || meshes.length > 128 || (document.materials?.length ?? 0) > 64 || (document.images?.length ?? 0) > 8 || (document.textures?.length ?? 0) > 8) limit();
  if (!Array.isArray(document.scenes) || document.scenes.length !== 1 || (document.scene !== undefined && document.scene !== 0)) unsupported();
  const seen = new Set<number>(); let vertices = 0, triangles = 0, textureBytes = 0;
  const walk = (index: number) => {
    integer(index, nodes.length - 1); if (seen.has(index)) invalid(); seen.add(index);
    const node = nodes[index]!;
    if (node.skin !== undefined || node.weights) unsupported();
    for (const [field, length] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]] as const) {
      if (node[field] !== undefined && (!Array.isArray(node[field]) || node[field].length !== length || !node[field].every((x: unknown) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 10_000))) invalid();
    }
    if (node.mesh !== undefined) {
      const mesh = meshes[integer(node.mesh, meshes.length - 1)]!;
      if (mesh.weights) unsupported();
      for (const primitive of mesh.primitives ?? []) {
        const p = record(primitive); if ((p.mode ?? 4) !== 4 || p.targets?.length) unsupported();
        const attributes = record(p.attributes); const position = accessors[integer(attributes.POSITION, accessors.length - 1)]!;
        if (position.type !== 'VEC3' || position.componentType !== 5126 || !position.count || position.count > OBJECT_MAX_VERTICES) limit();
        for (const [name, index] of Object.entries(attributes)) {
          if (!['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(name)) unsupported();
          const attribute = accessors[integer(index, accessors.length - 1)]!;
          const types = name === 'COLOR_0' ? ['VEC3', 'VEC4'] : [name === 'TANGENT' ? 'VEC4' : name.startsWith('TEXCOORD_') ? 'VEC2' : 'VEC3'];
          if (attribute.count !== position.count || !types.includes(attribute.type) || ![5120, 5121, 5122, 5123, 5125, 5126].includes(attribute.componentType)) invalid();
        }
        const indices = p.indices === undefined ? undefined : accessors[integer(p.indices, accessors.length - 1)]!;
        if (indices && (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType))) invalid();
        const count = indices?.count ?? position.count;
        if (!count || count % 3) invalid(); vertices += position.count; triangles += count / 3;
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of record(document.scenes[0]).nodes ?? []) walk(node);
  if (!vertices || vertices > OBJECT_MAX_VERTICES || triangles > OBJECT_MAX_TRIANGLES) limit();
  const imageBytes = (document.images ?? []).map((source: unknown) => {
    const image = record(source), bv = bufferViews[integer(image.bufferView, bufferViews.length - 1)]!;
    const start = binOffset + (bv.byteOffset ?? 0);
    return imagePixels(bytes.subarray(start, start + bv.byteLength), image.mimeType) * 4;
  });
  // Different samplers can create separate GPU textures from the same image.
  // Count each declared texture, while retaining the image decode floor.
  textureBytes = Math.max(imageBytes.reduce((sum: number, bytes: number) => sum + bytes, 0),
    (document.textures ?? []).reduce((sum: number, texture: unknown) => sum + imageBytes[integer(record(texture).source, imageBytes.length - 1)]!, 0));
  if (textureBytes > 32 * 1024 * 1024) limit();
  return { vertices, triangles, textureBytes };
}

export function disposeWorldObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => { if (node instanceof THREE.Mesh) { geometries.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value); } } });
  geometries.forEach(x => x.dispose()); textures.forEach(x => { const image = x.source.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close(); x.dispose(); }); materials.forEach(x => x.dispose());
}

export async function loadWorldObject(bytes: Uint8Array): Promise<LoadedWorldObject> {
  const budget = validateWorldObjectGLB(bytes);
  const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('world-object-external'); return url; });
  const gltf = await new GLTFLoader(manager).parseAsync(bytes.slice().buffer, '');
  try {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node instanceof THREE.SkinnedMesh || node.morphTargetInfluences?.length) unsupported();
      if (!node.matrixWorld.elements.every(Number.isFinite)) invalid();
      for (const value of Object.values(node.geometry.attributes)) { const attribute = value as THREE.BufferAttribute | THREE.InterleavedBufferAttribute; for (let i = 0; i < attribute.array.length; i++) if (!Number.isFinite(attribute.array[i])) invalid(); }
      if (node.geometry.index) for (const i of node.geometry.index.array) if (i >= node.geometry.getAttribute('position').count) invalid();
    });
    const bounds = new THREE.Box3().setFromObject(gltf.scene); const dimensions = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(x => Number.isFinite(x) && Math.abs(x) <= 1000) || dimensions.length() < 0.00001) invalid();
    const root = new THREE.Group(); const center = bounds.getCenter(new THREE.Vector3()); gltf.scene.position.set(-center.x, -bounds.min.y, -center.z); root.add(gltf.scene);
    return { root, dimensions: dimensions.toArray(), ...budget, dispose: () => disposeWorldObject(root) };
  } catch (cause) { disposeWorldObject(gltf.scene); throw cause; }
}
