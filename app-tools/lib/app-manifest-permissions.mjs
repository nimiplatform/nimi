import { parse as parseYaml } from 'yaml';

const KNOWN_PERMISSION_IDS = new Set([
  'agents.interact',
  'agents.configure',
  'artifacts.open',
  'account.profile.read',
  'memory.read',
  'memory.write',
  'knowledge.read',
  'knowledge.write',
  'notifications.send',
  'notifications.receive',
  'files.open',
  'files.save',
  'realm.library.read',
  'realm.library.manage',
  'realm.publish',
  'ai.background',
  'shared_resources.open',
]);
const ADMITTED_PERMISSION_IDS = new Set([
  'agents.interact',
  'agents.configure',
]);
const MAX_REASON_BYTES = 240;

export function normalizePermissionRequirements(input) {
  const source = input === undefined ? [] : input;
  if (!Array.isArray(source)) throw new Error('Permission requirements must be an array');
  const seen = new Set();
  return source.map((requirement, index) => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new Error(`Invalid permission requirement ${index}`);
    }
    if (JSON.stringify(Object.keys(requirement).sort()) !== JSON.stringify(['id', 'reason'])) {
      throw new Error(`Invalid permission requirement fields at index ${index}`);
    }
    const id = typeof requirement.id === 'string' ? requirement.id.trim() : '';
    const reason = typeof requirement.reason === 'string' ? requirement.reason.trim() : '';
    if (!id || id !== requirement.id || !reason || reason !== requirement.reason || Buffer.byteLength(reason, 'utf8') > MAX_REASON_BYTES) {
      throw new Error(`Invalid permission requirement ${id || index}`);
    }
    if (!KNOWN_PERMISSION_IDS.has(id)) throw new Error(`Unknown permission requirement: ${id}`);
    if (!ADMITTED_PERMISSION_IDS.has(id)) throw new Error(`Reserved permission requirement: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate permission requirement: ${id}`);
    seen.add(id);
    return { id, reason };
  });
}

export function assertManifestPermissionRequirements(manifest, manifestPath) {
  let parsed;
  try {
    parsed = parseYaml(manifest);
  } catch (error) {
    throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Object.hasOwn(parsed || {}, 'permissions') || !Array.isArray(parsed.permissions)) {
    throw new Error('Submitted manifest permissions must be an array');
  }
  const seen = new Set();
  for (const [index, requirement] of parsed.permissions.entries()) {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new Error(`Submitted manifest permission requirement ${index} must be an object`);
    }
    if (JSON.stringify(Object.keys(requirement).sort()) !== JSON.stringify(['id', 'reason'])) {
      throw new Error(`Submitted manifest permission requirement ${index} fields must be exactly id and reason`);
    }
    const id = typeof requirement.id === 'string' ? requirement.id.trim() : '';
    const reason = typeof requirement.reason === 'string' ? requirement.reason.trim() : '';
    if (!id || id !== requirement.id || !reason || reason !== requirement.reason || Buffer.byteLength(reason, 'utf8') > MAX_REASON_BYTES) {
      throw new Error(`Submitted manifest permission requirement ${index} requires canonical id and bounded reason`);
    }
    if (!KNOWN_PERMISSION_IDS.has(id)) {
      throw new Error(`Submitted manifest permission requirement ${index} uses unknown permission id: ${id}`);
    }
    if (!ADMITTED_PERMISSION_IDS.has(id)) {
      throw new Error(`Submitted manifest permission requirement ${index} uses reserved permission id: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`Submitted manifest permission requirement ${index} duplicates permission id: ${id}`);
    }
    seen.add(id);
  }
  if (!manifestPath.endsWith('nimi.app.yaml')) {
    throw new Error('Submitted manifest permission requirements were not read from nimi.app.yaml');
  }
}
