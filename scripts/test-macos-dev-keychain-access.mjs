#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { runReleaseCommand } from '../apps/desktop/scripts/lib/macos-release-process.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('native macOS Keychain access integration requires Apple Silicon macOS');
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(repoRoot, '.nimi', 'local', 'macos-dev-keychain-access-test');
const objectPath = path.join(outputRoot, 'integration.o');
const executablePath = path.join(outputRoot, 'integration');
const sdkPath = runReleaseCommand('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).stdout.trim();
const swiftFrontendPath = runReleaseCommand('/usr/bin/xcrun', ['--find', 'swift-frontend']).stdout.trim();
if (!path.isAbsolute(sdkPath) || !path.isAbsolute(swiftFrontendPath)) {
  throw new Error('xcrun returned a non-absolute SDK or Swift frontend path');
}
const swiftToolchainRoot = path.resolve(path.dirname(swiftFrontendPath), '..');
const sources = [
  path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security', 'DER.swift'),
  path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security', 'KeychainAccessControl.swift'),
  path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security', 'TrustSettingsValidation.swift'),
  path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security', 'ProfileKeyCleanup.swift'),
  path.join(repoRoot, 'apps', 'desktop', 'macos', 'dev-security', 'SignedCode.swift'),
  path.join(repoRoot, 'scripts', 'macos-dev-keychain-access-integration.swift'),
];

await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await Promise.all([rm(objectPath, { force: true }), rm(executablePath, { force: true })]);
runReleaseCommand('/usr/bin/xcrun', [
  'swift-frontend',
  '-c',
  '-O',
  '-whole-module-optimization',
  '-parse-as-library',
  '-target', 'arm64-apple-macos13.0',
  '-sdk', sdkPath,
  '-module-name', 'NimiMacOSKeychainAccessIntegration',
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
  '-o', executablePath,
  objectPath,
], { cwd: repoRoot, inherit: true });
await rm(objectPath, { force: true });
runReleaseCommand(executablePath, [], { cwd: repoRoot, inherit: true });
