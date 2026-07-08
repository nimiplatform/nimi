#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const parsed = { packageName: '', tarball: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--package') {
      parsed.packageName = String(argv[++index] || '').trim();
      continue;
    }
    if (token === '--tarball') {
      parsed.tarball = String(argv[++index] || '').trim();
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write([
        'Usage: node scripts/check-sdk-kit-pack-audit.mjs --package <sdk|kit> --tarball <path>',
        '',
        'Audits packed @nimiplatform/sdk and @nimiplatform/kit tarballs for source/test leakage.',
      ].join('\n'));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!['sdk', 'kit'].includes(parsed.packageName)) {
    throw new Error('--package must be sdk or kit');
  }
  if (!parsed.tarball) {
    throw new Error('--tarball is required');
  }
  return parsed;
}

function listTarball(tarball) {
  const absolute = path.resolve(tarball);
  accessSync(absolute);
  const relative = path.relative(process.cwd(), absolute);
  const tarballArg = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : absolute;
  const result = spawnSync('tar', ['-tf', tarballArg.replaceAll('\\', '/')], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`tar -tf failed for ${absolute}: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim().replaceAll('\\', '/'))
    .filter(Boolean);
}

function sdkForbidden(entry) {
  if (!entry.startsWith('package/')) {
    return 'entry must be under package/';
  }
  if (entry.startsWith('package/dist/')) {
    if (/\.(?:test|spec|example)\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry)) {
      return 'dist must not contain test/example files';
    }
    return null;
  }
  if (entry === 'package/package.json' || entry === 'package/LICENSE' || entry === 'package/README.md') {
    return null;
  }
  if (/^package\/(?:adapters|core|core-generated|features|realm|runtime|types|contracts)(?:\/|$)/u.test(entry)) {
    return 'SDK tarball must not include top-level source or generated source trees';
  }
  if (/\.(?:test|spec|example)\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry)) {
    return 'SDK tarball must not include tests/examples';
  }
  return null;
}

function kitForbidden(entry) {
  if (!entry.startsWith('package/')) {
    return 'entry must be under package/';
  }
  if (entry.startsWith('package/dist/')) {
    if (/\/(?:test|tests)\//u.test(entry) || /\.(?:test|spec|example)\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry)) {
      return 'dist must not contain test/example files';
    }
    return null;
  }
  if (
    entry === 'package/package.json'
    || entry === 'package/LICENSE'
    || entry === 'package/CHANGELOG.md'
    || entry === 'package/README.md'
    || entry === 'package/AGENTS.md'
    || /^package\/(?:auth|core|telemetry)\/README\.md$/u.test(entry)
    || /^package\/features\/[^/]+\/README\.md$/u.test(entry)
    || /^package\/shell\/(?:capabilities|electron|renderer)\/README\.md$/u.test(entry)
  ) {
    return null;
  }
  if (/^package\/(?:auth|ui|core|telemetry|features|shell)\/(?:src|test|tests)\//u.test(entry)) {
    return 'Kit tarball must not include source or test trees';
  }
  if (/\.(?:test|spec|example)\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(entry)) {
    return 'Kit tarball must not include tests/examples';
  }
  return null;
}

const { packageName, tarball } = parseArgs(process.argv.slice(2));
const entries = listTarball(tarball);
const classify = packageName === 'sdk' ? sdkForbidden : kitForbidden;
const violations = entries
  .map((entry) => ({ entry, reason: classify(entry) }))
  .filter((item) => item.reason);

if (violations.length > 0) {
  process.stderr.write(`${packageName} pack audit failed for ${tarball}:\n`);
  for (const violation of violations.slice(0, 100)) {
    process.stderr.write(`- ${violation.entry}: ${violation.reason}\n`);
  }
  if (violations.length > 100) {
    process.stderr.write(`... ${violations.length - 100} more violation(s)\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`${packageName} pack audit passed (${entries.length} entries)\n`);
}
