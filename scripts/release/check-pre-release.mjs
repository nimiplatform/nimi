#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readCargoVersion(root, relativePath) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const match = source.match(/^version\s*=\s*"([^"]+)"\s*$/mu);
  if (!match) throw new Error(`missing Cargo package version: ${relativePath}`);
  return { version: match[1] };
}

function changelogSection(source, heading) {
  const match = new RegExp(
    `^## \\[${heading.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`,
    'mu',
  ).exec(source);
  if (!match) return null;
  const remainder = source.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## \[/mu);
  return nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder;
}

function requireChangelog(violations, root, relativePath, releaseVersion = '') {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  const unreleased = changelogSection(source, 'Unreleased');
  if (unreleased === null) {
    violations.push(`${relativePath} is missing a ## [Unreleased] section`);
    return;
  }
  if (releaseVersion) {
    const release = changelogSection(source, releaseVersion);
    if (release === null || !/^\s*-\s+\S/mu.test(release)) {
      violations.push(`${relativePath} must contain release notes under ## [${releaseVersion}]`);
    }
    return;
  }
  if (!/^\s*-\s+\S/mu.test(unreleased) && !/^## \[[0-9]+\.[0-9]+\.[0-9]+\][\s\S]*?^\s*-\s+\S/mu.test(source)) {
    violations.push(`${relativePath} has no current release note entries`);
  }
}

function releaseTrainVersion(releaseTag) {
  if (!releaseTag) return '';
  const match = String(releaseTag).match(
    /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-rc\.[1-9]\d*)?$/,
  );
  if (!match) throw new Error(`--release-tag must be vX.Y.Z or vX.Y.Z-rc.N: ${releaseTag}`);
  return match[1];
}

export function preReleaseViolations(root = repoRoot, { releaseTag = '' } = {}) {
  const violations = [];
  const sdk = readJson(root, 'sdks/typescript/package.json');
  const kit = readJson(root, 'kit/package.json');
  const appTools = readJson(root, 'app-tools/package.json');
  const nativeWindows = readJson(root, 'kit/shell/protected-local-node/npm/win32-x64/package.json');
  const nativeDarwin = readJson(root, 'kit/shell/protected-local-node/npm/darwin-arm64/package.json');
  const protectedLocal = readCargoVersion(root, 'kit/shell/protected-local/Cargo.toml');
  const tauri = readCargoVersion(root, 'kit/shell/tauri/Cargo.toml');

  const nonFinalVersions = [
    ['@nimiplatform/sdk', sdk.version],
    ['@nimiplatform/kit', kit.version],
    ['@nimiplatform/app-tools', appTools.version],
    ['@nimiplatform/kit-protected-local-win32-x64', nativeWindows.version],
    ['@nimiplatform/kit-protected-local-darwin-arm64', nativeDarwin.version],
    ['nimi-shell-protected-local', protectedLocal.version],
    ['nimi-shell-tauri', tauri.version],
  ].filter(([, version]) => !STABLE_VERSION.test(String(version || '')));
  if (nonFinalVersions.length > 0) {
    violations.push(
      'public release manifests must use final stable SemVer before canary build; prerelease/non-final values: '
      + nonFinalVersions.map(([label, version]) => `${label}=${String(version)}`).join(', '),
    );
  }

  requireChangelog(violations, root, 'CHANGELOG.md', releaseTrainVersion(releaseTag));
  requireChangelog(violations, root, 'kit/CHANGELOG.md', releaseTag ? String(kit.version) : '');

  const goreleaser = parseYaml(readFileSync(path.join(root, '.goreleaser.yml'), 'utf8'));
  const runtimeBuild = Array.isArray(goreleaser.builds)
    ? goreleaser.builds.find((build) => build?.id === 'nimi')
    : null;
  if (!runtimeBuild) violations.push('.goreleaser.yml is missing the nimi runtime build');
  if (runtimeBuild?.env?.includes('CGO_ENABLED=0') !== true) {
    violations.push('.goreleaser.yml runtime build must remain CGO_ENABLED=0 for cross-platform canary output');
  }
  if (JSON.stringify(runtimeBuild?.goos) !== JSON.stringify(['linux', 'darwin', 'windows'])) {
    violations.push('.goreleaser.yml runtime goos must be linux, darwin, windows');
  }
  if (JSON.stringify(runtimeBuild?.goarch) !== JSON.stringify(['amd64', 'arm64'])) {
    violations.push('.goreleaser.yml runtime goarch must be amd64, arm64');
  }
  if (!runtimeBuild?.ldflags?.some((value) => String(value).includes('-X main.Version={{ .Version }}'))) {
    violations.push('.goreleaser.yml must inject the candidate version into main.Version');
  }
  if (goreleaser.release?.disable !== true) {
    violations.push('.goreleaser.yml release must stay disabled; the workflow owns global RC/stable tags');
  }
  if (!String(goreleaser.snapshot?.version_template || '').includes('NIMI_RELEASE_VERSION')) {
    violations.push('.goreleaser.yml snapshot version must accept NIMI_RELEASE_VERSION for promotable canaries');
  }

  return violations;
}

function parseArgs(argv) {
  const args = argv.filter((value) => value !== '--');
  if (args.length === 0) {
    return { releaseTag: String(process.env.NIMI_RELEASE_TAG || '').trim() };
  }
  if (args.length === 2 && args[0] === '--release-tag' && args[1]) {
    return { releaseTag: args[1] };
  }
  throw new Error('usage: check-pre-release.mjs [--release-tag vX.Y.Z[-rc.N]]');
}

function main(argv) {
  const options = parseArgs(argv);
  const violations = preReleaseViolations(repoRoot, options);
  if (violations.length > 0) {
    process.stderr.write('Pre-release metadata check failed:\n');
    for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Pre-release metadata check passed\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[check-pre-release] ${error.stack ?? error.message ?? String(error)}\n`);
    process.exit(1);
  }
}
