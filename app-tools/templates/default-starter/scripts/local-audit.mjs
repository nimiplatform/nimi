import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../.nimi/app-scaffold/lock.json', import.meta.url), 'utf8'));
if (lock?.semantics?.publicAdmissionTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim public admission truth');
}
if (lock?.semantics?.releaseDescriptorTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim release descriptor truth');
}
if (lock?.semantics?.ordinaryVisibilityTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim ordinary visibility truth');
}
if (lock?.semantics?.permissionGrantTruth !== 'not-generated') {
  throw new Error('scaffold lock must not claim permission grant truth');
}
if (lock?.semantics?.productReadinessClaimAllowed !== false) {
  throw new Error('scaffold lock must not claim product readiness');
}
console.log('[nimi-app] local-audit pre-submission self-check passed');
