import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const lockUrl = new URL('../.nimi/app-scaffold/lock.json', import.meta.url);
const intentUrl = new URL('../.nimi/app-scaffold/intent.json', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const manifestUrl = new URL('../nimi.app.yaml', import.meta.url);
const admissionUrl = new URL('../ADMISSION.md', import.meta.url);
const referenceManifestUrl = new URL('../../../app-tools/templates/app-source.manifest.json', import.meta.url);

function readText(url, label) {
  if (!existsSync(url)) {
    throw new Error(`tester local-audit missing ${label}`);
  }
  return readFileSync(url, 'utf8');
}

function assertNotGeneratedSemantics(semantics) {
  for (const field of [
    'publicAdmissionTruth',
    'releaseDescriptorTruth',
    'ordinaryVisibilityTruth',
    'installedAppUpdateTruth',
    'permissionGrantTruth',
  ]) {
    if (semantics?.[field] !== 'not-generated') {
      throw new Error(`scaffold lock must not claim ${field}`);
    }
  }
  if (semantics?.productReadinessClaimAllowed !== false) {
    throw new Error('scaffold lock must not claim product readiness');
  }
}

function assertSubmittedManifest() {
  const manifest = readText(manifestUrl, 'submitted manifest');
  const parsed = parseYaml(manifest);
  if (parsed?.manifest_role !== 'submitted-input') {
    throw new Error('submitted manifest must keep manifest_role: submitted-input');
  }
  if (parsed?.app_id !== 'nimi.tester') {
    throw new Error(`submitted manifest app_id must be nimi.tester: ${String(parsed?.app_id || 'missing')}`);
  }
  if (parsed?.display_name !== 'Nimi Lab') {
    throw new Error(`submitted manifest display_name must be Nimi Lab: ${String(parsed?.display_name || 'missing')}`);
  }
  if (/\badmitted\b|descriptor_role:\s*release|grant(ed)?_permissions/i.test(manifest)) {
    throw new Error('submitted manifest contains admission, release descriptor, or grant wording');
  }
}

function assertTesterReferenceSourceMode() {
  if (existsSync(intentUrl)) {
    throw new Error('tester local-audit found scaffold intent without lock; run a complete scaffold init or remove the partial scaffold state');
  }
  const packageJson = JSON.parse(readText(packageUrl, 'package.json'));
  if (packageJson.name !== '@nimiplatform/tester') {
    throw new Error('tester local-audit requires scaffold lock outside the monorepo tester reference source');
  }
  const referenceManifest = JSON.parse(readText(referenceManifestUrl, 'tester reference source manifest'));
  if (referenceManifest.sourceApp !== 'apps/tester') {
    throw new Error('tester reference source manifest must point at apps/tester');
  }
  assertSubmittedManifest();
  const admission = readText(admissionUrl, 'admission request');
  if (!admission.includes('developer-submitted listing request')) {
    throw new Error('admission request must remain a developer-submitted listing request');
  }
  if (/approval|release descriptor|permission grant|install truth/i.test(admission) && !admission.includes('not an approval, release descriptor, permission grant, or install truth')) {
    throw new Error('admission request must not claim platform admission truth');
  }
}

if (!existsSync(lockUrl)) {
  assertTesterReferenceSourceMode();
  console.log('[nimi-app] local-audit tester-reference source self-check passed');
  process.exit(0);
}

const lock = JSON.parse(readFileSync(lockUrl, 'utf8'));
assertNotGeneratedSemantics(lock?.semantics);
console.log('[nimi-app] local-audit pre-submission self-check passed');
