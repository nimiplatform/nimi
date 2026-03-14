#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');

const agentsSpecs = [
  { rel: 'AGENTS.md', maxLines: 40 },
  { rel: 'runtime/AGENTS.md', maxLines: 30 },
  { rel: 'sdk/AGENTS.md', maxLines: 30 },
  { rel: 'spec/AGENTS.md', maxLines: 30 },
  { rel: 'scripts/AGENTS.md', maxLines: 30 },
  { rel: 'apps/desktop/AGENTS.md', maxLines: 30 },
  { rel: 'apps/web/AGENTS.md', maxLines: 30 },
  { rel: 'proto/AGENTS.md', maxLines: 30 },
];

const requiredSections = [
  '## Scope',
  '## Hard Boundaries',
  '## Retrieval Defaults',
  '## Verification Commands',
];

const staleTokens = [
  'local_ai_runtime',
  'runtime-ai-media-coverage',
  'docs/refactory',
];

const genericPnpmCommands = new Set([
  'install',
  'test',
  'build',
  'typecheck',
  'lint',
  'dev',
  'preview',
  'check',
  'verify',
]);

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function collectKnownPnpmScripts() {
  const scripts = new Set(Object.keys(readJson(rootPackageJsonPath).scripts || {}));
  const packageFiles = [
    'apps/desktop/package.json',
    'apps/web/package.json',
    'sdk/package.json',
    'docs/package.json',
    'examples/package.json',
    'nimi-mods/package.json',
  ];
  for (const rel of packageFiles) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const pkg = readJson(abs);
    for (const name of Object.keys(pkg.scripts || {})) {
      scripts.add(name);
    }
  }
  return scripts;
}

function validatePnpmCommand(command, knownScripts, failures, rel) {
  const tokens = command.trim().split(/\s+/u);
  if (tokens[0] !== 'pnpm') {
    return;
  }
  let index = 1;
  while (tokens[index]?.startsWith('--')) {
    index += 2;
  }
  const subcommand = String(tokens[index] || '').trim();
  if (!subcommand || genericPnpmCommands.has(subcommand) || knownScripts.has(subcommand)) {
    return;
  }
  failures.push(`${rel}: unknown pnpm command in AGENTS: ${command}`);
}

function validatePathToken(token, failures, rel) {
  if (token.includes(' ')) {
    return;
  }
  if (!token.includes('/')) {
    return;
  }
  if (token.startsWith('http') || token.startsWith('@') || token.includes('*') || token.includes('{')) {
    return;
  }
  const cleaned = token.replace(/[`,.;:()]+$/gu, '').replace(/^[(]+/u, '');
  if (!cleaned || cleaned.startsWith('$') || cleaned.endsWith('/')) {
    return;
  }
  const abs = path.join(repoRoot, cleaned);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: stale path reference in AGENTS: ${cleaned}`);
  }
}

function main() {
  const failures = [];
  const knownScripts = collectKnownPnpmScripts();

  for (const spec of agentsSpecs) {
    const abs = path.join(repoRoot, spec.rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing AGENTS file: ${spec.rel}`);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split(/\r?\n/u);
    if (lines.length > spec.maxLines) {
      failures.push(`${spec.rel}: exceeds freshness line budget (${lines.length} > ${spec.maxLines})`);
    }
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        failures.push(`${spec.rel}: missing required section ${section}`);
      }
    }
    for (const token of staleTokens) {
      if (content.includes(token)) {
        failures.push(`${spec.rel}: contains stale token ${token}`);
      }
    }
    const backtickTokens = content.match(/`[^`\n]+`/gu) || [];
    for (const raw of backtickTokens) {
      const token = raw.slice(1, -1);
      validatePathToken(token, failures, spec.rel);
      validatePnpmCommand(token, knownScripts, failures, spec.rel);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`agents freshness check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write('agents freshness check passed\n');
}

main();
