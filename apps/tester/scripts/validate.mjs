import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

function validatePermissionDeclarations(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Array.isArray(parsed?.permissions)) {
    throw new Error('permissions must be the top-level public permission declaration array');
  }
  if (parsed.permissions.length !== 0) {
    throw new Error('Tester must declare no permissions while the admitted public permission set is empty');
  }
  for (const retired of ['declared_nimi_api_scopes', 'scope', 'qualifier', 'operation_id', 'resource_ref']) {
    if (Object.hasOwn(parsed, retired) || Object.hasOwn(parsed?.permissions ?? {}, retired)) {
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
