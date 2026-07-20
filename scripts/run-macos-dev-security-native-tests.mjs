#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('macOS development security native tests require native Apple Silicon macOS');
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-native-tests');
const outputPath = path.join(outputRoot, 'macos-dev-security-native-tests');
const objectPath = path.join(outputRoot, 'macos-dev-security-native-tests.o');
const sdkPath = runReleaseCommand('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).stdout.trim();
const swiftFrontendPath = runReleaseCommand('/usr/bin/xcrun', ['--find', 'swift-frontend']).stdout.trim();
if (!path.isAbsolute(sdkPath) || !path.isAbsolute(swiftFrontendPath)) {
  throw new Error('xcrun returned a non-absolute macOS SDK or Swift frontend path');
}
const swiftToolchainRoot = path.resolve(path.dirname(swiftFrontendPath), '..');
const sources = [
  'apps/desktop/macos/generated/macos_local_development_profile.swift',
  'scripts/macos-dev-security-native-test-support.swift',
  'apps/desktop/macos/dev-security/BoundedProcessWait.swift',
  'apps/desktop/macos/dev-security/RepairProcessGroupPolicy.swift',
  'apps/desktop/macos/dev-security/RepairProcessWitness.swift',
  'apps/desktop/macos/dev-security/FixedCommandRunner.swift',
  'apps/desktop/macos/dev-security/SubprocessFailureDiagnostics.swift',
  'apps/desktop/macos/dev-security/POSIXIdentityLookup.swift',
  'apps/desktop/macos/dev-security/POSIXIdentityProjection.swift',
  'apps/desktop/macos/dev-security/OpenDirectoryDeleteRecovery.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairTransition.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairExecutor.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairPersistence.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairJournalCodec.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairReceipt.swift',
  'apps/desktop/macos/dev-security/PartialInstallationRepairDeadline.swift',
  'apps/desktop/macos/dev-security/StableExecutableVnode.swift',
  'apps/desktop/macos/dev-security/StableMutationLock.swift',
  'scripts/macos-dev-security-journal-storage-native-tests.swift',
  'scripts/macos-dev-security-executor-native-tests.swift',
  'scripts/macos-dev-security-vnode-native-tests.swift',
  'scripts/macos-dev-security-native-tests.swift',
].map((relative) => path.join(repoRoot, relative));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
runReleaseCommand('/usr/bin/xcrun', [
  'swift-frontend',
  '-c',
  '-whole-module-optimization',
  '-parse-as-library',
  '-warnings-as-errors',
  '-target', 'arm64-apple-macos13.0',
  '-sdk', sdkPath,
  '-module-name', 'NimiMacOSDevSecurityNativeTests',
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
  '-o', outputPath,
  objectPath,
], { cwd: repoRoot, inherit: true });
await rm(objectPath, { force: true });
runReleaseCommand(outputPath, [], { cwd: repoRoot, inherit: true });
