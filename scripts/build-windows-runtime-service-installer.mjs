#!/usr/bin/env node
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
const source = path.join(scriptDir, 'install-windows-runtime-service.ps1');
const outputDir = path.join(repoRoot, 'dist', 'windows-runtime-service-installer');
const output = path.join(outputDir, 'install-nimi-runtime.ps1');
const resourceOutputDir = path.join(outputDir, 'resources');
const registrySource = path.join(repoRoot, 'config', 'platform-nimi-app-registry.yaml');
const releaseDescriptorsSource = path.join(repoRoot, 'config', 'platform-nimi-app-release-descriptors.yaml');
const runtimeCandidateSource = path.join(repoRoot, 'dist', 'nimi.exe');
const runtimeBuildRecordSource = path.join(repoRoot, 'dist', 'nimi-build-record.json');
const identity = requireWindowsDevSigningIdentity({ cwd: repoRoot });

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
mkdirSync(resourceOutputDir, { recursive: true });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const registrySha256 = sha256(registrySource);
const releaseDescriptorsSha256 = sha256(releaseDescriptorsSource);
const runtimeSha256 = sha256(runtimeCandidateSource);
const runtimeBuildRecord = JSON.parse(readFileSync(runtimeBuildRecordSource, 'utf8'));
validateRuntimeBuildRecord(runtimeBuildRecord, {
  source: captureRuntimeBuildSource(repoRoot, { pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS }),
  runtimeBinarySha256: runtimeSha256,
  signerCertificateSha256: identity.certificateSha256,
});
const runtimeBuildRecordSha256 = fileSha256(runtimeBuildRecordSource);
const installerSource = readFileSync(source, 'utf8')
  .replace('__BUILD_REGISTRY_SHA256__', registrySha256)
  .replace('__BUILD_RELEASE_DESCRIPTORS_SHA256__', releaseDescriptorsSha256)
  .replace('__BUILD_RUNTIME_SHA256__', runtimeSha256)
  .replace('__BUILD_RUNTIME_RECORD_SHA256__', runtimeBuildRecordSha256);
if (installerSource.includes('__BUILD_')) {
  throw new Error('Windows Runtime installer resource hash substitution is incomplete');
}
writeFileSync(output, installerSource, 'utf8');
copyFileSync(registrySource, path.join(resourceOutputDir, 'nimi-app-registry.yaml'));
copyFileSync(releaseDescriptorsSource, path.join(resourceOutputDir, 'nimi-app-release-descriptors.yaml'));
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
  registrySha256,
  releaseDescriptorsSha256,
  runtimeSha256,
  runtimeBuildRecordSha256,
  runtimeCandidateId: runtimeBuildRecord.candidateId,
  sourceDirtyDescriptorSha256: runtimeBuildRecord.source.dirtyDescriptorSha256,
  sourceTreeSha256: runtimeBuildRecord.source.sourceTreeSha256,
  installerSha256,
})}\n`);
