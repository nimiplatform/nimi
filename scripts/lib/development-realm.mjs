import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { resolveDevelopmentRealm, developmentRealmEnvironment } from '../../app-tools/lib/development-environment.mjs';

export { developmentRealmEnvironment, resolveDevelopmentRealm };

const supervisorFlags = new Map([
  ['realm', 'name'], ['realm-url', 'apiOrigin'], ['realtime-url', 'realtimeOrigin'],
  ['web-url', 'webOrigin'], ['realm-environment-id', 'environmentId'],
]);

export function supervisorRealmArguments(profile) {
  return [...supervisorFlags].flatMap(([flag, field]) => [`--${flag}`, profile[field]]);
}

// ps and CIM expose a command string. Only validated public selection fields
// leave this boundary. Missing flags remain absent, including on older owners.
export function readSupervisorRealm(command) {
  const fields = {};
  for (const match of command.matchAll(/(?:^|\s)--([a-z-]+)(?=\s|=|$)/gu)) {
    const field = supervisorFlags.get(match[1]);
    if (!field) continue;
    const tail = command.slice(match.index + match[0].length);
    const value = /^(?:\s+|=)(?:"([^"]+)"|([^"\s]+))(?=\s|$)/u.exec(tail);
    if (!value || Object.hasOwn(fields, field)) return null;
    fields[field] = value[1] ?? value[2];
  }
  if (!fields.name || !fields.apiOrigin) return null;
  try {
    const canonical = resolveDevelopmentRealm(fields.name, developmentRealmEnvironment(fields));
    return Object.keys(fields).every(key => fields[key] === canonical[key]) ? fields : null;
  } catch {
    return null;
  }
}

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
