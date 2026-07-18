#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const manifestPath = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'desktop-release-manifest.json',
);

function parseArgs(argv) {
  const args = {
    version: '',
    releaseId: '',
    channel: 'stable',
    commit: '',
    builtAt: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = String(argv[index + 1] || '').trim();
    if (token === '--version') args.version = next;
    else if (token === '--release-id') args.releaseId = next;
    else if (token === '--channel') args.channel = next || 'stable';
    else if (token === '--commit') args.commit = next;
    else if (token === '--built-at') args.builtAt = next;
    else continue;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? String(result.stdout || '').trim() : 'dev';
}

function requireReleaseText(value, field) {
  if (!value || value.length > 128 || value.trim() !== value
    || !/^[\x21-\x7e]+$/.test(value) || /[\\/]/.test(value)) {
    throw new Error(`${field} must be 1..128 printable ASCII characters without path separators`);
  }
  return value;
}

export function createDesktopReleaseManifest(input) {
  return {
    desktopVersion: requireReleaseText(String(input.version || '').trim(), 'desktopVersion'),
    desktopReleaseId: requireReleaseText(String(input.releaseId || '').trim(), 'desktopReleaseId'),
    channel: requireReleaseText(String(input.channel || '').trim(), 'channel'),
    commit: requireReleaseText(String(input.commit || '').trim(), 'commit'),
    builtAt: String(input.builtAt || '').trim(),
  };
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const version = args.version || String(desktopPackage.version || '').trim();
  const commit = args.commit || currentCommit();
  const releaseId = args.releaseId || `${version}+${commit}`;
  const builtAt = args.builtAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(builtAt))) {
    throw new Error('builtAt must be an RFC 3339 timestamp');
  }
  const manifest = createDesktopReleaseManifest({
    version,
    releaseId,
    channel: args.channel,
    commit,
    builtAt,
  });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `[prepare-desktop-release-metadata] version=${manifest.desktopVersion} release=${manifest.desktopReleaseId}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
