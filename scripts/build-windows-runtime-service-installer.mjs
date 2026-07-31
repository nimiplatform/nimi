#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from './lib/windows-dev-signing.mjs';
import {
  captureRuntimeBuildSource,
  fileSha256,
  validateRuntimeBuildRecord,
  WINDOWS_RUNTIME_BUILD_SOURCE_PATHS,
} from './lib/runtime-build-record.mjs';

if (process.platform !== 'win32') {
  throw new Error('Windows Runtime service installer can be built only on Windows');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const source = path.join(scriptDir, 'install-windows-runtime-service.ps1');
const outputDir = path.join(repoRoot, 'dist', 'windows-runtime-service-installer');
const output = path.join(outputDir, 'install-nimi-runtime.ps1');
const resourceOutputDir = path.join(outputDir, 'resources');
const appIdentityProjectionSource = path.join(repoRoot, 'config', 'platform-nimi-app-identity-surfaces.yaml');
const runtimeCandidateSource = path.join(repoRoot, 'dist', 'nimi.exe');
const runtimeBuildRecordSource = path.join(repoRoot, 'dist', 'nimi-build-record.json');
const localAgentChatRepairOutput = path.join(resourceOutputDir, 'repair-local-agent-chat.exe');
const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
mkdirSync(resourceOutputDir, { recursive: true });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const appIdentityProjectionSha256 = sha256(appIdentityProjectionSource);
const runtimeSha256 = sha256(runtimeCandidateSource);
const runtimeBuildRecord = JSON.parse(readFileSync(runtimeBuildRecordSource, 'utf8'));
validateRuntimeBuildRecord(runtimeBuildRecord, {
  source: captureRuntimeBuildSource(repoRoot, { pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS }),
  runtimeBinarySha256: runtimeSha256,
  signerCertificateSha256: identity.certificateSha256,
});
const runtimeBuildRecordSha256 = fileSha256(runtimeBuildRecordSource);

const repairBuild = spawnSync(
  'go',
  ['build', '-trimpath', '-o', localAgentChatRepairOutput, './tools/repair-local-agent-chat'],
  {
    cwd: runtimeDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (repairBuild.error || repairBuild.status !== 0) {
  throw new Error(
    `failed to build LocalAgent chat repair helper: ${repairBuild.error?.message || `exit ${repairBuild.status}`}`,
  );
}
const repairSigned = signWindowsDevFiles([localAgentChatRepairOutput], { cwd: repoRoot });
if (repairSigned.certificateSha256 !== identity.certificateSha256) {
  throw new Error('LocalAgent chat repair helper signer changed during build');
}
const localAgentChatRepairSha256 = sha256(localAgentChatRepairOutput);
const installerCandidateVersionId = createHash('sha256')
  .update(runtimeSha256)
  .update('\0')
  .update(runtimeBuildRecordSha256)
  .update('\0')
  .update(localAgentChatRepairSha256)
  .digest('hex');

const installerSource = readFileSync(source, 'utf8')
  .replace('__BUILD_APP_IDENTITY_PROJECTION_SHA256__', appIdentityProjectionSha256)
  .replace('__BUILD_RUNTIME_SHA256__', runtimeSha256)
  .replace('__BUILD_RUNTIME_RECORD_SHA256__', runtimeBuildRecordSha256)
  .replace('__BUILD_LOCAL_AGENT_CHAT_REPAIR_SHA256__', localAgentChatRepairSha256)
  .replace('__BUILD_INSTALLER_CANDIDATE_VERSION_ID__', installerCandidateVersionId);
if (installerSource.includes('__BUILD_')) {
  throw new Error('Windows Runtime installer resource hash substitution is incomplete');
}
writeFileSync(output, installerSource, 'utf8');
copyFileSync(appIdentityProjectionSource, path.join(resourceOutputDir, 'nimi-app-identity-surfaces.yaml'));
copyFileSync(runtimeBuildRecordSource, path.join(resourceOutputDir, 'runtime-build-record.json'));
const signed = signWindowsDevFiles([output], { cwd: repoRoot });
if (signed.certificateSha256 !== identity.certificateSha256) {
  throw new Error('Windows Runtime installer signer changed during build');
}
const installerSha256 = sha256(output);
process.stdout.write(`${JSON.stringify({
  status: 'signed',
  installerPath: output,
  signerCertificateSha256: identity.certificateSha256,
  appIdentityProjectionSha256,
  runtimeSha256,
  runtimeBuildRecordSha256,
  localAgentChatRepairSha256,
  installerCandidateVersionId,
  runtimeCandidateId: runtimeBuildRecord.candidateId,
  sourceDirtyDescriptorSha256: runtimeBuildRecord.source.dirtyDescriptorSha256,
  sourceTreeSha256: runtimeBuildRecord.source.sourceTreeSha256,
  installerSha256,
})}\n`);
