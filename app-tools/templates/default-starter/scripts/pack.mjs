import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_ENTRY_REF = 'dist/index.html';
const ARTIFACT_EVIDENCE_PATH = 'dist/nimi-app-artifact-evidence.json';
const SUBMISSION_PACKET_PATH = 'dist/nimi-app-submission.json';
const MANIFEST_PATH = 'nimi.app.yaml';
const ADMISSION_REQUEST_PATH = '.nimi/admission/submission.yaml';
const BUILD_PROFILE_PATH = '.nimi/admission/build-profile.yaml';

const NON_ADMISSION_TRUTH = Object.freeze({
  publicAdmissionTruth: 'not-generated',
  releaseDescriptorTruth: 'not-generated',
  ordinaryVisibilityTruth: 'not-generated',
  permissionGrantTruth: 'not-generated',
  signingTruth: 'not-generated',
  notarizationTruth: 'not-generated',
  mirrorLicenseClearanceTruth: 'not-generated',
  productReadinessClaimAllowed: false,
});

function readRequiredText(relativePath, label) {
  if (!existsSync(relativePath)) {
    throw new Error(`${label} missing: ${relativePath}`);
  }
  return readFileSync(relativePath, 'utf8');
}

function buildNonGeneratedTruthClaimPattern(field) {
  return new RegExp(
    String.raw`"?${field}"?\s*:\s*['"]?(?!not-generated(?:['"]|[\s,}\]]|$))[^"',}\]\s]+`,
    'i',
  );
}

function buildBooleanTrueClaimPattern(field) {
  return new RegExp(String.raw`"?${field}"?\s*:\s*['"]?true`, 'i');
}

function assertNoProductTruthClaims(text, label) {
  const checks = [
    ['product readiness claim', buildBooleanTrueClaimPattern('productReadinessClaimAllowed')],
    ['admitted descriptor claim', /\badmission_status\s*:\s*admitted\b/i],
    ['ordinary-visible claim', /\bordinary_visibility\s*:\s*ordinary-visible\b/i],
    ['release descriptor claim', /\brelease_descriptor_ref\s*:/i],
    ['public admission truth claim', buildNonGeneratedTruthClaimPattern('publicAdmissionTruth')],
    ['release descriptor truth claim', buildNonGeneratedTruthClaimPattern('releaseDescriptorTruth')],
    ['ordinary visibility truth claim', buildNonGeneratedTruthClaimPattern('ordinaryVisibilityTruth')],
    ['permission grant truth claim', buildNonGeneratedTruthClaimPattern('permissionGrantTruth')],
    ['signing truth claim', buildNonGeneratedTruthClaimPattern('signingTruth')],
    ['notarization truth claim', buildNonGeneratedTruthClaimPattern('notarizationTruth')],
    ['mirror/license clearance truth claim', buildNonGeneratedTruthClaimPattern('mirrorLicenseClearanceTruth')],
  ];
  for (const [description, pattern] of checks) {
    if (pattern.test(text)) {
      throw new Error(`${label} contains ${description}`);
    }
  }
}

if (!existsSync(RENDERER_ENTRY_REF)) {
  throw new Error('renderer build output missing: run pnpm run build before packing');
}
const existingEvidencePath = join('dist', 'nimi-app-artifact-evidence.json');
if (existsSync(existingEvidencePath)) {
  assertNoProductTruthClaims(readFileSync(existingEvidencePath, 'utf8'), 'existing artifact evidence');
}
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(readFileSync(join('src-tauri', 'tauri.conf.json'), 'utf8'));
const manifest = readRequiredText(MANIFEST_PATH, 'submitted manifest input');
const submission = readRequiredText(ADMISSION_REQUEST_PATH, 'developer submission input');
const buildProfile = readRequiredText(BUILD_PROFILE_PATH, 'developer build profile input');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
if (!submission.includes('submission_role: developer-submitted-input')) {
  throw new Error('developer submission role marker missing');
}
if (!buildProfile.includes('profile_role: developer-workflow-input')) {
  throw new Error('developer build profile marker missing');
}
assertNoProductTruthClaims(manifest, 'submitted manifest input');
assertNoProductTruthClaims(submission, 'developer submission input');
assertNoProductTruthClaims(buildProfile, 'developer build profile input');

mkdirSync('dist', { recursive: true });
const rendererEntry = readFileSync(RENDERER_ENTRY_REF);
const artifactEvidence = {
  evidenceVersion: 1,
  evidenceRole: 'developer-submitted-input',
  generatedBy: '@nimiplatform/app-tools',
  packageName: packageJson.name,
  appVersion: tauriConfig.version,
  tauriIdentifier: tauriConfig.identifier,
  entryRef: RENDERER_ENTRY_REF,
  manifestPath: MANIFEST_PATH,
  admissionRequestPath: ADMISSION_REQUEST_PATH,
  buildProfileRef: BUILD_PROFILE_PATH,
  artifact: {
    role: 'renderer-entry',
    path: RENDERER_ENTRY_REF,
    mediaType: 'text/html',
    sizeBytes: rendererEntry.length,
    sha256: createHash('sha256').update(rendererEntry).digest('hex'),
  },
  ...NON_ADMISSION_TRUTH,
};
const packet = {
  packetRole: 'developer-submitted-input',
  packageName: packageJson.name,
  appVersion: tauriConfig.version,
  tauriIdentifier: tauriConfig.identifier,
  rendererEntry: RENDERER_ENTRY_REF,
  manifestPath: MANIFEST_PATH,
  admissionRequestPath: ADMISSION_REQUEST_PATH,
  buildProfilePath: BUILD_PROFILE_PATH,
  artifactEvidencePath: ARTIFACT_EVIDENCE_PATH,
  generatedBy: '@nimiplatform/app-tools',
  ...NON_ADMISSION_TRUTH,
};
writeFileSync(ARTIFACT_EVIDENCE_PATH, `${JSON.stringify(artifactEvidence, null, 2)}\n`);
writeFileSync(SUBMISSION_PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`[nimi-app] pack wrote ${SUBMISSION_PACKET_PATH} and ${ARTIFACT_EVIDENCE_PATH}`);
