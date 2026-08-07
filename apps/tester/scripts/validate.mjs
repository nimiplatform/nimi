import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const EXPECTED_APP_ACCESS = ['realm.data', 'runtime.consume', 'agent.local'];

function validateAppAccessDeclaration(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Array.isArray(parsed?.app_access)
    || JSON.stringify(parsed.app_access) !== JSON.stringify(EXPECTED_APP_ACCESS)) {
    throw new Error('Tester must declare exactly realm.data, runtime.consume, and agent.local');
  }
  for (const retired of ['permissions', 'reason', 'grant_id', 'scope', 'qualifier', 'operation_id', 'resource_ref']) {
    if (Object.hasOwn(parsed, retired)) {
      throw new Error(`retired App permission vocabulary remains: ${retired}`);
    }
  }
}

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
validateAppAccessDeclaration(manifest);
process.stdout.write('[nimi-app] validate local-development checks passed\n');
