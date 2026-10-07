import { isJsonObject } from '@nimiplatform/sdk/types';
import type { NimiLocalAppAssetsClient } from '@nimiplatform/sdk/app';
import { OBJECT_MAX_BYTES, type ObjectBudget } from './world-tour-object-asset.js';

export type WorldObjectAsset = { relativePath: string; sha256: string; sizeBytes: number };
export type WorldObjectTransform = { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
export type WorldObjectInstance = { id: string; name: string; asset: WorldObjectAsset; transform: WorldObjectTransform };
export type WorldComposition = { version: 1; archivePath: string; archiveSha256: string; revision: number; instances: WorldObjectInstance[] };
export type WorldCompositionIdentity = Pick<WorldComposition, 'archivePath' | 'archiveSha256'>;

export const COMPOSITION_MAX_INSTANCES = 16;
export const COMPOSITION_MAX_ASSETS = 8;
function invalid(): never { throw new Error('world-composition-invalid'); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isJsonObject(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) invalid();
  return value;
}
function triple(value: unknown, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(x => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max)) invalid();
  return [...value] as [number, number, number];
}
export function validateObjectTransform(value: unknown): WorldObjectTransform {
  const transform = exact(value, ['position', 'rotation', 'scale']);
  return { position: triple(transform.position, -1000, 1000), rotation: triple(transform.rotation, -36000, 36000), scale: triple(transform.scale, 0.01, 100) };
}
export function parseWorldComposition(value: unknown, identity: WorldCompositionIdentity): WorldComposition {
  const doc = exact(value, ['version', 'archivePath', 'archiveSha256', 'revision', 'instances']);
  if (doc.version !== 1 || doc.archivePath !== identity.archivePath || doc.archiveSha256 !== identity.archiveSha256 || !/^sha256:[0-9a-f]{64}$/u.test(identity.archiveSha256) ||
    !Number.isSafeInteger(doc.revision) || Number(doc.revision) < 0 || !Array.isArray(doc.instances) || doc.instances.length > COMPOSITION_MAX_INSTANCES) invalid();
  const ids = new Set<string>(), assets = new Set<string>();
  const instances = doc.instances.map(value => {
    const item = exact(value, ['id', 'name', 'asset', 'transform']);
    if (typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/u.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) invalid();
    ids.add(item.id);
    const asset = exact(item.asset, ['relativePath', 'sha256', 'sizeBytes']);
    if (typeof asset.relativePath !== 'string' || !/^world-tour\/objects\/[0-9a-f]{64}\.glb$/u.test(asset.relativePath) || typeof asset.sha256 !== 'string' ||
      asset.relativePath !== `world-tour/objects/${asset.sha256.slice(7)}.glb` || !/^sha256:[0-9a-f]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) || Number(asset.sizeBytes) < 1 || Number(asset.sizeBytes) > OBJECT_MAX_BYTES) invalid();
    assets.add(asset.relativePath);
    return { id: item.id, name: item.name, asset: { relativePath: asset.relativePath, sha256: asset.sha256, sizeBytes: Number(asset.sizeBytes) }, transform: validateObjectTransform(item.transform) };
  });
  if (assets.size > COMPOSITION_MAX_ASSETS) invalid();
  return { version: 1, ...identity, revision: Number(doc.revision), instances };
}

export function checkCompositionBudget(instances: readonly WorldObjectInstance[], models: ReadonlyMap<string, ObjectBudget>): void {
  const assets = new Set(instances.map(x => x.asset.relativePath));
  if (instances.length > COMPOSITION_MAX_INSTANCES || assets.size > COMPOSITION_MAX_ASSETS) throw new Error('world-object-limit');
  let vertices = 0, triangles = 0, textureBytes = 0;
  for (const item of instances) { const model = models.get(item.asset.relativePath); if (!model) throw new Error('world-object-missing'); vertices += model.vertices; triangles += model.triangles; }
  for (const path of assets) textureBytes += models.get(path)!.textureBytes;
  if (vertices > 1_000_000 || triangles > 2_000_000 || textureBytes > 128 * 1024 * 1024) throw new Error('world-object-limit');
}

export async function readWorldObjectAsset(asset: WorldObjectAsset, storage: Pick<NimiLocalAppAssetsClient, 'read'>): Promise<Uint8Array> {
  let result: Awaited<ReturnType<NimiLocalAppAssetsClient['read']>>;
  try { result = await storage.read({ relativePath: asset.relativePath }); }
  catch { throw new Error('world-object-missing'); }
  if (result.asset.sizeBytes !== asset.sizeBytes || result.asset.sha256 !== asset.sha256 || result.asset.mediaType !== 'model/gltf-binary') throw new Error('world-object-missing');
  const bytes = new Uint8Array(asset.sizeBytes); let offset = 0;
  for await (const chunk of result.body) { if (offset + chunk.length > bytes.length) throw new Error('world-object-missing'); bytes.set(chunk, offset); offset += chunk.length; }
  if (offset !== bytes.length || await objectDigest(bytes) !== asset.sha256) throw new Error('world-object-missing');
  return bytes;
}
export async function objectDigest(bytes: Uint8Array): Promise<string> {
  return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

type CompositionStorage = { readJson(path: string): Promise<{ value: unknown }>; writeJson(path: string, value: unknown): Promise<unknown> };
export function compositionPath(archivePath: string): string { return `${archivePath}.scene.json`; }
export async function readWorldComposition(storage: CompositionStorage, identity: WorldCompositionIdentity): Promise<WorldComposition | null> {
  try { return parseWorldComposition((await storage.readJson(compositionPath(identity.archivePath))).value, identity); }
  catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'not-found') return null; throw cause; }
}
// App JSON storage has no CAS. This catches stale windows before writing, but
// does not claim that another process cannot race between the read and write.
export async function saveWorldComposition(storage: CompositionStorage, identity: WorldCompositionIdentity, instances: WorldObjectInstance[], baseline: WorldComposition | null): Promise<WorldComposition> {
  const current = await readWorldComposition(storage, identity);
  if (JSON.stringify(current) !== JSON.stringify(baseline)) throw new Error('world-composition-conflict');
  const saved = parseWorldComposition({ version: 1, ...identity, revision: (baseline?.revision ?? 0) + 1, instances }, identity);
  await storage.writeJson(compositionPath(identity.archivePath), saved);
  const after = await readWorldComposition(storage, identity);
  if (JSON.stringify(after) !== JSON.stringify(saved)) throw new Error('world-composition-conflict');
  return saved;
}
