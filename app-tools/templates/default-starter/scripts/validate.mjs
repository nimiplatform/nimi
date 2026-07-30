import { readFileSync } from 'node:fs';
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

function validatePermissionRequirements(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Object.hasOwn(parsed || {}, 'permissions') || !Array.isArray(parsed.permissions)) {
    throw new Error('permissions must be an array');
  }
  const seen = new Set();
  for (const [index, requirement] of parsed.permissions.entries()) {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new Error(`permission requirement ${index} must be an object`);
    }
    if (JSON.stringify(Object.keys(requirement).sort()) !== JSON.stringify(['id', 'reason'])) {
      throw new Error(`permission requirement ${index} fields must be exactly id and reason`);
    }
    const id = typeof requirement.id === 'string' ? requirement.id.trim() : '';
    const reason = typeof requirement.reason === 'string' ? requirement.reason.trim() : '';
    if (!id || id !== requirement.id || !reason || reason !== requirement.reason || Buffer.byteLength(reason, 'utf8') > 240) {
      throw new Error(`permission requirement ${index} requires canonical id and bounded reason`);
    }
    if (!KNOWN_PERMISSION_IDS.has(id)) throw new Error(`permission requirement ${index} uses unknown permission id: ${id}`);
    if (!ADMITTED_PERMISSION_IDS.has(id)) throw new Error(`permission requirement ${index} uses reserved permission id: ${id}`);
    if (seen.has(id)) throw new Error(`permission requirement ${index} duplicates permission id: ${id}`);
    seen.add(id);
  }
}

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
validatePermissionRequirements(manifest);
console.log('[nimi-app] validate local-development checks passed');
