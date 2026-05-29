import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../.nimi/app-scaffold/lock.json', import.meta.url), 'utf8'));
if (lock?.semantics?.publicAdmissionTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim public admission truth');
}
if (lock?.semantics?.permissionGrantTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim permission grant truth');
}
console.log('[nimi-app] local-audit pre-submission self-check passed');
