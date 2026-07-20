#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const retiredHelperVerb = ['rotate', 'macos', 'dev', 'trust', 'helper'];
const FORBIDDEN_IDENTIFIERS = Object.freeze([
  `pnpm_${retiredHelperVerb.join('_')}`,
  retiredHelperVerb.join('-'),
  ['trust-helper-', 'rotation'].join(''),
  ['TrustHelper', 'Rotation'].join(''),
  ['rotation-', 'coordinator'].join(''),
  ['carrier_2_to_4_v1_', 'rotation'].join(''),
]);

const EXCLUDED_PREFIXES = Object.freeze([
  '.git/',
  '.nimi/local/',
  '.local/',
  'archive/',
  'docs/',
  'node_modules/',
]);

function admittedPath(relative) {
  const normalized = relative.split(path.sep).join('/');
  if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  if (normalized.includes('/archive/') || normalized.includes('/_archive/')) return false;
  return true;
}

export function findRetiredMacOSRotationIdentifiers(files) {
  const findings = [];
  for (const [relative, source] of files) {
    if (!admittedPath(relative) || typeof source !== 'string' || source.includes('\0')) continue;
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      if (source.includes(identifier) || relative.includes(identifier)) {
        findings.push({ relative, identifier });
      }
    }
  }
  return findings;
}

function repositoryFiles(repoRoot) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  return listed.stdout.split('\0').filter(Boolean).map((relative) => {
    const absolute = path.join(repoRoot, relative);
    return [relative, fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? fs.readFileSync(absolute, 'utf8')
      : null];
  });
}

export function checkRepository(repoRoot) {
  return findRetiredMacOSRotationIdentifiers(repositoryFiles(repoRoot));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const findings = checkRepository(repoRoot);
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(`[RETIRED_MACOS_ROTATION_IDENTIFIER] ${finding.identifier} (${finding.relative})\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write('retired macOS rotation identifier check passed\n');
  }
}
