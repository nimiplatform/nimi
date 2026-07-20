#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(path) {
  return fs.readFileSync(path, 'utf8');
}

function gitLsFiles(args = []) {
  const result = spawnSync('git', ['ls-files', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function trackedTextFiles() {
  return gitLsFiles().filter((file) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    return /\.(?:md|ya?ml|json|mjs|js|ts|tsx|sh)$/u.test(file)
      || ['AGENTS.md', 'CLAUDE.md', 'package.json', 'pnpm-workspace.yaml'].includes(file);
  });
}

function isRawPackagePathAllowed(file) {
  return file.startsWith('docs/')
    || file === 'scripts/check-nimi-nimicoding-split-readiness.mjs'
    || file === 'scripts/nimicoding-host-hardcut.test.mjs';
}

function isRetiredHistory(file) {
  return file.startsWith('archive/')
    || file.startsWith('.nimi/topics/')
    || file.startsWith('.nimi/local/');
}

const trackedNimicodingSource = gitLsFiles(['nimi-coding']);
if (trackedNimicodingSource.length > 0) {
  fail(`tracked monorepo package source remains under nimi-coding/: ${trackedNimicodingSource.slice(0, 8).join(', ')}`);
}

const workspaceText = readText('pnpm-workspace.yaml');
if (/['"]?nimi-coding['"]?/u.test(workspaceText)) {
  fail('pnpm-workspace.yaml must not include the split nimi-coding package');
}

const packageJson = JSON.parse(readText('package.json'));
const nimicodingDependency = packageJson.devDependencies?.['@nimiplatform/nimi-coding']
  ?? packageJson.dependencies?.['@nimiplatform/nimi-coding'];
const bootstrapText = readText('.nimi/config/bootstrap.yaml');
const bootstrapVersion = bootstrapText.match(/^cli_version:\s*["']?([^"'\s]+)["']?\s*$/mu)?.[1];
if (!bootstrapVersion) {
  fail('.nimi/config/bootstrap.yaml must declare cli_version');
} else {
  const expectedNimicodingDependency = `^${bootstrapVersion}`;
  if (nimicodingDependency !== expectedNimicodingDependency) {
    fail(`package.json must depend on @nimiplatform/nimi-coding as ${expectedNimicodingDependency}, got ${nimicodingDependency ?? '<missing>'}`);
  }
}

const scriptText = Object.entries(packageJson.scripts ?? {})
  .map(([name, command]) => `${name}: ${command}`)
  .join('\n');
for (const forbidden of [
  '--filter @nimiplatform/nimi-coding',
  'check:spec-authority-cutover-readiness',
  'nimicoding:repo-local-trial-direct-copy',
]) {
  if (scriptText.includes(forbidden)) {
    fail(`package.json scripts must not reference retired nimicoding monorepo surface: ${forbidden}`);
  }
}

const releaseWorkflow = fs.existsSync('.github/workflows/release.yml')
  ? readText('.github/workflows/release.yml')
  : '';
for (const forbidden of [
  'nimicoding/v*',
  '- nimicoding',
  "target == 'nimicoding'",
  'nimi-coding/package.json',
  '--filter @nimiplatform/nimi-coding',
]) {
  if (releaseWorkflow.includes(forbidden)) {
    fail(`release workflow must not own nimicoding package release after split: ${forbidden}`);
  }
}

for (const file of trackedTextFiles()) {
  if (isRetiredHistory(file)) continue;
  if (isRawPackagePathAllowed(file)) continue;
  const text = readText(file);
  if (/nimi-coding\/\*\*/u.test(text)) {
    fail(`${file} keeps nimi-coding/** as a host retrieval or authority root`);
  }
  const normalizedText = text.replaceAll('package://@nimiplatform/nimi-coding/', 'package://NIMICODING/');
  const rawRefs = [...normalizedText.matchAll(/(?:^|[^A-Za-z0-9@])nimi-coding\/[A-Za-z0-9._*{}?/@-]*/gu)]
    .map((match) => match[0].trim());
  if (rawRefs.length > 0) {
    fail(`${file} contains local package path refs after split: ${[...new Set(rawRefs)].slice(0, 5).join(', ')}`);
  }
  if (/--filter\s+@nimiplatform\/nimi-coding/u.test(text)) {
    fail(`${file} still runs package workspace filters for split nimicoding`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`nimi-nimicoding-split-readiness: FAIL\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('nimi-nimicoding-split-readiness: OK\n');
