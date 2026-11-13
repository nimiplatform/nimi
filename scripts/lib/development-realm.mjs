import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { resolveDevelopmentRealm, developmentRealmEnvironment } from '../../app-tools/lib/development-environment.mjs';

export { developmentRealmEnvironment };

export function readDevelopmentRealm(root, selection, environment = process.env) {
  const file = path.join(root, '.env');
  const env = { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...environment };
  return resolveDevelopmentRealm(selection, env);
}

export function parseRealmArguments(argv) {
  let realm;
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--realm') { rest.push(argv[index]); continue; }
    if (realm !== undefined || !['official', 'local'].includes(argv[index + 1])) throw new Error('--realm requires official or local exactly once.');
    realm = argv[++index];
  }
  return { realm, rest };
}
