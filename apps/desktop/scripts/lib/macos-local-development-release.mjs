import {
  chmod,
  cp,
  mkdir,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sign } from '@electron/osx-sign';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE as CONTRACT } from '../generated/macos-local-development-profile.mjs';
import { runReleaseCommand } from './macos-release-process.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(desktopRoot, '../..');
const localRoot = path.join(repoRoot, '.nimi', 'local');

export async function finalizeMacOSLocalDevelopmentCandidate({
  candidateRoot,
  sourceRoot,
}) {
  const runtimePath = path.join(candidateRoot, 'runtime', 'bin', 'nimi-runtime');
  const launchdPath = path.join(candidateRoot, 'launchd', 'ai.nimi.runtime.dev.plist');
  const helperPath = path.join(candidateRoot, 'installer', 'nimi-macos-dev-security');
  await Promise.all([
    mkdir(path.dirname(runtimePath), { recursive: true }),
    mkdir(path.dirname(launchdPath), { recursive: true }),
    mkdir(path.dirname(helperPath), { recursive: true }),
  ]);
  await cp(path.join(sourceRoot, 'nimi-runtime'), runtimePath, { force: false });
  await chmod(runtimePath, 0o755);
  await cp(
    path.join(desktopRoot, 'macos', 'generated', 'ai.nimi.runtime.dev.plist'),
    launchdPath,
    { force: false },
  );
  runReleaseCommand(process.execPath, [
    path.join(repoRoot, 'scripts', 'build-macos-dev-security-helper.mjs'),
  ], { cwd: repoRoot, inherit: true });
  await cp(
    path.join(localRoot, 'macos-dev-security-build', 'nimi-macos-dev-security'),
    helperPath,
    { force: false },
  );
  await chmod(helperPath, 0o755);

  const desktopApp = path.join(candidateRoot, 'Nimi Dev.app');
  const localHostApp = path.join(
    desktopApp,
    'Contents',
    'Frameworks',
    'Nimi Local App Host Dev.app',
  );
  await signApplication(localHostApp);
  await signApplication(desktopApp, (candidate) => (
    candidate === localHostApp || candidate.startsWith(`${localHostApp}${path.sep}`)
  ));

  const runtimeEntitlements = path.join(desktopRoot, 'macos', 'entitlements', 'runtime.plist');
  signExecutable(
    runtimePath,
    CONTRACT.runtimeSigningIdentifier,
    runtimeEntitlements,
  );
  signExecutable(
    helperPath,
    CONTRACT.installerSigningIdentifier,
    runtimeEntitlements,
  );

  await verifyLocalDevelopmentCode(
    runtimePath,
    CONTRACT.runtimeSigningIdentifier,
  );
  await verifyLocalDevelopmentCode(
    path.join(desktopApp, 'Contents', 'MacOS', 'Nimi Dev'),
    CONTRACT.desktopSigningIdentifier,
  );
  await verifyLocalDevelopmentCode(
    path.join(localHostApp, 'Contents', 'MacOS', 'Nimi Local App Host Dev'),
    CONTRACT.localAppHostSigningIdentifier,
  );
  await verifyLocalDevelopmentCode(
    helperPath,
    CONTRACT.installerSigningIdentifier,
  );
  runReleaseCommand('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=4',
    desktopApp,
  ]);
}

async function signApplication(app, ignore) {
  const electronEntitlements = path.join(desktopRoot, 'macos', 'entitlements', 'electron-local-development.plist');
  const runtimeEntitlements = path.join(desktopRoot, 'macos', 'entitlements', 'runtime.plist');
  await sign({
    app,
    identity: '-',
    identityValidation: false,
    ignore,
    optionsForFile: (candidate) => ({
      additionalArguments: ['--timestamp=none'],
      entitlements: candidate === app || candidate.endsWith('.app')
        || candidate.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)
        ? electronEntitlements
        : runtimeEntitlements,
      hardenedRuntime: true,
      signatureFlags: 'runtime',
    }),
    platform: 'darwin',
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
  });
}

function signExecutable(file, identifier, entitlements) {
  runReleaseCommand('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--identifier',
    identifier,
    '--options',
    'runtime',
    '--timestamp=none',
    '--entitlements',
    entitlements,
    file,
  ]);
}

async function verifyLocalDevelopmentCode(file, identifier) {
  runReleaseCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', file]);
  const detail = runReleaseCommand('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    file,
  ]);
  const output = `${detail.stdout}\n${detail.stderr}`;
  assertMacOSLocalDevelopmentAdHocCodeSigningOutput(output, identifier);
  if (runReleaseCommand('/usr/bin/lipo', ['-archs', file]).stdout.trim() !== 'arm64') {
    throw new Error(`local-development code is not native arm64: ${identifier}`);
  }
}

export function assertMacOSLocalDevelopmentAdHocCodeSigningOutput(output, identifier) {
  const flagRows = [...String(output).matchAll(
    /^CodeDirectory\b[^\r\n]*\bflags=0x[0-9a-f]+\(([^)\r\n]*)\)/gimu,
  )];
  const flags = flagRows.length === 1
    ? new Set(flagRows[0][1].split(',').map((value) => value.trim()))
    : new Set();
  if (exactLine(output, 'Identifier') !== identifier
    || exactLine(output, 'Signature') !== 'adhoc'
    || exactLine(output, 'TeamIdentifier') !== 'not set'
    || !flags.has('adhoc')
    || !flags.has('runtime')
    || /^Authority=/mu.test(String(output))) {
    throw new Error(`local-development ad-hoc code identity rejected: ${identifier}`);
  }
}

function exactLine(output, name) {
  const matches = [...output.matchAll(new RegExp(`^${name}=([^\\r\\n]*)$`, 'gmu'))];
  if (matches.length !== 1 || !matches[0][1]) {
    throw new Error(`codesign ${name} is missing or ambiguous`);
  }
  return matches[0][1].trim();
}
