import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function gitFiles(repoRoot) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8').split('\0').filter(Boolean).sort();
}

const exactCandidateSourcePaths = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'go.work',
  'go.work.sum',
  'scripts/build-runtime.mjs',
  'scripts/build-windows-runtime-service-installer.mjs',
  'scripts/generate-first-party-protected-runtime-profiles.mjs',
  'scripts/install-windows-runtime-service.ps1',
  'scripts/lib/first-party-protected-runtime-profile-compiler.mjs',
  'scripts/lib/runtime-build-record.mjs',
  'scripts/lib/windows-dev-signing.mjs',
  'config/spec-frozen/runtime/tables/first-party-protected-runtime-profiles.yaml',
]);

const nimiCandidateSourcePrefixes = [
  'apps/desktop/',
  'apps/web/',
  'kit/',
  'nimi-cognition/',
  'runtime/',
  'sdks/typescript/',
];

const nimiCandidateExcludedPrefixes = [
  'apps/desktop/src-tauri/',
  'apps/desktop/test/',
  'apps/web/test/',
  'kit/test/',
  'sdks/typescript/test/',
];

function excludedNimiCandidateSource(relative) {
  return nimiCandidateExcludedPrefixes.some((prefix) => relative.startsWith(prefix))
    || /(?:^|\/)(?:__tests__|fixtures)\//u.test(relative)
    || /(?:\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|_test\.go)$/u.test(relative);
}

const realmCandidateSourcePrefixes = [
  'config/',
  'nimi-backend/',
  'packages/nimi-forge/',
];

function candidateSourceFiles(repoRoot, role) {
  const prefixes = role === 'realm' ? realmCandidateSourcePrefixes : nimiCandidateSourcePrefixes;
  return gitFiles(repoRoot).filter((relative) => (
    !executionCarrierPaths.has(relative)
    && (role !== 'nimi' || !excludedNimiCandidateSource(relative))
    && (exactCandidateSourcePaths.has(relative)
      || prefixes.some((prefix) => relative.startsWith(prefix)))
  ));
}

const executionCarrierPaths = new Set([
  'apps/desktop/product-control-node/npm/win32-x64/nimi_desktop_product_control.node',
  'kit/shell/protected-local-node/npm/win32-x64/nimi_shell_protected_local.node',
]);

function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sourceTreeSha256(repoRoot) {
  return hashSourceFiles(repoRoot, gitFiles(repoRoot));
}

function hashSourceFiles(repoRoot, files) {
  const digest = createHash('sha256');
  for (const relative of files) {
    const absolute = path.join(repoRoot, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      digest.update(relative).update('\0deleted\0');
      continue;
    }
    digest.update(relative).update('\0');
    if (stat.isSymbolicLink()) {
      digest.update('symlink\0').update(fs.readlinkSync(absolute)).update('\0');
    } else if (stat.isFile()) {
      digest.update('file\0').update(String(stat.mode & 0o111)).update('\0').update(fs.readFileSync(absolute)).update('\0');
    } else if (stat.isDirectory()) {
      digest.update('directory\0');
    } else {
      throw new Error(`unsupported admitted source entry: ${relative}`);
    }
  }
  return digest.digest('hex');
}

export function candidateSourceTreeSha256(repoRoot, role) {
  if (role !== 'nimi' && role !== 'realm') throw new Error(`unsupported candidate source role: ${role}`);
  return hashSourceFiles(repoRoot, candidateSourceFiles(repoRoot, role));
}

export function captureSourceState(nimiRoot) {
  const configuredRealmRoot = String(process.env.REALM_ROOT || '').trim();
  if (!configuredRealmRoot) {
    throw new Error('REALM_ROOT is required to capture the external Realm authority source state');
  }
  const realmRoot = path.resolve(configuredRealmRoot);
  const state = {
    schemaVersion: 'nimi.local-agent-product-source-state/v3',
    nimiCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: nimiRoot, encoding: 'utf8' }).trim(),
    realmCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: realmRoot, encoding: 'utf8' }).trim(),
    nimiSourceTreeSha256: candidateSourceTreeSha256(nimiRoot, 'nimi'),
    realmSourceTreeSha256: candidateSourceTreeSha256(realmRoot, 'realm'),
    journeyRegistrySha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-journeys.yaml')),
    executionPolicySha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-execution-policy.yaml')),
  };
  return {
    ...state,
    sourceDigest: createHash('sha256').update(JSON.stringify({
      schemaVersion: state.schemaVersion,
      nimiCommit: state.nimiCommit,
      realmCommit: state.realmCommit,
      nimiSourceTreeSha256: state.nimiSourceTreeSha256,
      realmSourceTreeSha256: state.realmSourceTreeSha256,
    })).digest('hex'),
  };
}
