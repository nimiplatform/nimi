import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

function validatePermissionDeclarations(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Array.isArray(parsed?.permissions)) {
    throw new Error('permissions must be the top-level public permission declaration array');
  }
  const permissions = new Map(parsed.permissions.map((permission) => [permission?.id, permission]));
  const interact = permissions.get('agents.interact');
  const textGenerate = permissions.get('ai.text.generate');
  if (parsed.permissions.length !== 2
    || permissions.size !== 2
    || typeof interact?.reason !== 'string'
    || !interact.reason.toLowerCase().includes('all current and future agents')
    || typeof textGenerate?.reason !== 'string'
    || !textGenerate.reason.toLowerCase().includes('foreground text generation')) {
    throw new Error('Tester must declare exactly agents.interact and ai.text.generate with their bounded account and foreground execution reasons');
  }
  for (const retired of ['declared_nimi_api_scopes', 'scope', 'qualifier', 'operation_id', 'resource_ref']) {
    if (Object.hasOwn(parsed, retired) || parsed.permissions.some((permission) => Object.hasOwn(permission, retired))) {
      throw new Error(`retired permission vocabulary remains: ${retired}`);
    }
  }
}

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
validatePermissionDeclarations(manifest);
console.log('[nimi-app] validate local-development checks passed');
