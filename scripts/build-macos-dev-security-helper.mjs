#!/usr/bin/env node
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('macOS development security helper must be built natively on Apple Silicon');
}

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const sourceRoot = path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security');
const generatedRoot = path.join(repoRoot, 'apps', 'desktop', 'macos', 'generated');
const outputRoot = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-build');
const outputPath = path.join(outputRoot, 'nimi-macos-dev-security');
const objectPath = path.join(outputRoot, 'nimi-macos-dev-security.o');
const sources = [
  path.join(generatedRoot, 'macos_local_development_profile.swift'),
  'DER.swift',
  'DevSecuritySupport.swift',
  'CodeSigningSearchList.swift',
  'KeychainAccessControl.swift',
  'TrustSettingsValidation.swift',
  'ProfileKeyCleanup.swift',
  'CertificateAuthority.swift',
  'CertificateAuthorityKeychain.swift',
  'CertificateAuthorityValidation.swift',
  'DevelopmentCertificateProfile.swift',
  'SigningProfileCleanupRecord.swift',
  'SignedCode.swift',
  'ReleaseRecord.swift',
  'InstalledReleaseTrust.swift',
  'DirectoryServiceAccountPlan.swift',
  'OpenDirectoryAccountStore.swift',
  'OpenDirectoryAccountRepair.swift',
  'RuntimePrincipalTransaction.swift',
  'PartialInstallationRepair.swift',
  'PartialInstallationRepairStorage.swift',
  'InstallerState.swift',
  'SigningTransaction.swift',
  'InstallationTransactionJournal.swift',
  'InstalledHealth.swift',
  'ServiceLifecycle.swift',
  'main.swift',
].map((name) => path.isAbsolute(name) ? name : path.join(sourceRoot, name));

await Promise.all([
  rm(outputPath, { force: true }),
  rm(objectPath, { force: true }),
]);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const sdkPath = runReleaseCommand('/usr/bin/xcrun', [
  '--sdk', 'macosx', '--show-sdk-path',
]).stdout.trim();
const swiftFrontendPath = runReleaseCommand('/usr/bin/xcrun', [
  '--find', 'swift-frontend',
]).stdout.trim();
if (!path.isAbsolute(sdkPath) || !path.isAbsolute(swiftFrontendPath)) {
  throw new Error('xcrun returned a non-absolute macOS SDK or Swift frontend path');
}
const swiftToolchainRoot = path.resolve(path.dirname(swiftFrontendPath), '..');

runReleaseCommand('/usr/bin/xcrun', [
  'swift-frontend',
  '-c',
  '-O',
  '-whole-module-optimization',
  '-parse-as-library',
  '-target', 'arm64-apple-macos13.0',
  '-sdk', sdkPath,
  '-module-name', 'NimiMacOSDevSecurity',
  '-o', objectPath,
  ...sources,
], { cwd: repoRoot, inherit: true });
runReleaseCommand('/usr/bin/xcrun', [
  'clang',
  '-target', 'arm64-apple-macos13.0',
  '-isysroot', sdkPath,
  '-L', path.join(sdkPath, 'usr', 'lib', 'swift'),
  '-L', path.join(swiftToolchainRoot, 'lib', 'swift-5.0', 'macosx'),
  '-Wl,-rpath,/usr/lib/swift',
  '-framework', 'Security',
  '-framework', 'OpenDirectory',
  '-o', outputPath,
  objectPath,
], { cwd: repoRoot, inherit: true });
await rm(objectPath, { force: true });
const metadata = await stat(outputPath);
if (!metadata.isFile() || metadata.size <= 0 || (metadata.mode & 0o111) === 0) {
  throw new Error('macOS development security helper build did not produce an executable');
}
runReleaseCommand('/usr/bin/lipo', ['-archs', outputPath]);
process.stdout.write(`${JSON.stringify({
  architecture: 'arm64',
  outputPath,
  posture: 'linker_signed_adhoc_bootstrap_is_non_authorizing_and_requires_explicit_root_install_and_local_ca_resigning_transaction',
  status: 'built',
})}\n`);
