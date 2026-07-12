#!/usr/bin/env node
//
// Generate (or check) package.json scripts.lint body from the
// release-gate registry projection.
//
// Owner: scripts; this generator projects the registry authority below.
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-013
// registry version discipline.
//
// Modes:
//   default    write the projected lint chain into package.json
//              scripts.lint
//   --check    exit 0 if package.json scripts.lint matches the
//              projection; exit 1 with a structured diff otherwise
//
// Determinism: registry → projector-lint → string. Idempotent.
// package.json is read in full and re-serialised with the same
// indentation; only scripts.lint changes.
// Offline-safe: yes; no network or external command.

import fs from 'node:fs';
import process from 'node:process';
import { loadRegistry } from './lib/release-gate/registry-loader.mjs';
import { projectLintChain } from './lib/release-gate/projector-lint.mjs';

const PACKAGE_JSON_PATH_DEFAULT = 'package.json';

function parseArgs(argv) {
  const opts = {
    check: false,
    packageJsonPath: PACKAGE_JSON_PATH_DEFAULT,
    registryPath: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--check':
        opts.check = true;
        break;
      case '--package-json':
        opts.packageJsonPath = argv[++i];
        break;
      case '--registry-path':
        opts.registryPath = argv[++i];
        break;
      case '--help':
      case '-h':
        process.stdout.write(USAGE + '\n');
        process.exit(0);
        return null;
      default:
        process.stderr.write(`unknown argument: ${arg}\n`);
        process.exit(2);
    }
  }
  return opts;
}

const USAGE = [
  'Usage: node scripts/generate-lint-chain.mjs [options]',
  '',
  'Options:',
  '  --check                Exit 0 if package.json scripts.lint matches',
  '                         the registry projection; exit 1 otherwise.',
  '                         Default mode writes the projection.',
  '  --package-json <path>  Override default path (default: package.json)',
  '  --registry-path <path> Override default registry yaml path',
  '  --help                 Print this help and exit',
  '',
  'Determinism: same registry → same projection. Generator preserves',
  'package.json indentation, key order outside scripts.lint, and',
  'trailing newline.',
].join('\n');

function detectIndent(text) {
  // Sniff from first indented line; fall back to 2 spaces.
  const m = text.match(/^( +|\t)(?=\S)/m);
  if (!m) return '  ';
  return m[1];
}

function detectTrailingNewline(text) {
  return text.endsWith('\n');
}

function rewriteScriptsLint(originalText, newLintBody) {
  // Locate the "lint": "..." line in scripts. Use a robust regex
  // that handles escaped quotes and multi-line strings produced by
  // JSON.stringify (which keeps "..." on one line).
  const re = /"lint"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const match = re.exec(originalText);
  if (!match) {
    throw new Error(
      'package.json: could not locate scripts.lint string for in-place update'
    );
  }
  // Build the replacement value JSON-escaped
  const replacement = JSON.stringify(newLintBody);
  return (
    originalText.slice(0, match.index) +
    `"lint": ${replacement}` +
    originalText.slice(match.index + match[0].length)
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Load registry
  const loadResult = loadRegistry(opts.registryPath);
  if (!loadResult.ok) {
    for (const err of loadResult.errors) {
      process.stderr.write(`registry-load error: ${err}\n`);
    }
    process.exit(1);
  }

  // Project
  let projection;
  try {
    projection = projectLintChain(loadResult.registry);
  } catch (error) {
    process.stderr.write(
      `lint chain projection failed: ${String(error?.message ?? error)}\n`
    );
    process.exit(1);
  }

  // Read package.json
  let originalText;
  try {
    originalText = fs.readFileSync(opts.packageJsonPath, 'utf8');
  } catch (error) {
    process.stderr.write(
      `failed to read ${opts.packageJsonPath}: ${String(error?.message ?? error)}\n`
    );
    process.exit(1);
  }

  let pkg;
  try {
    pkg = JSON.parse(originalText);
  } catch (error) {
    process.stderr.write(
      `failed to parse ${opts.packageJsonPath}: ${String(error?.message ?? error)}\n`
    );
    process.exit(1);
  }
  if (typeof pkg?.scripts?.lint !== 'string') {
    process.stderr.write(
      `${opts.packageJsonPath}: scripts.lint missing or not a string\n`
    );
    process.exit(1);
  }

  const currentBody = pkg.scripts.lint;
  const projectedBody = projection.body;

  if (opts.check) {
    if (currentBody === projectedBody) {
      process.stdout.write(
        `lint chain matches projection (${projection.gateIds.length} gates)\n`
      );
      process.exit(0);
    }
    process.stderr.write(
      `lint chain DRIFT detected:\n` +
        `  current  length: ${currentBody.length}\n` +
        `  projected length: ${projectedBody.length}\n` +
        `  projected gate count: ${projection.gateIds.length}\n` +
        `Re-run: node scripts/generate-lint-chain.mjs\n`
    );
    process.exit(1);
  }

  // Write mode
  if (currentBody === projectedBody) {
    process.stdout.write(
      `lint chain already matches projection (${projection.gateIds.length} gates); no write needed\n`
    );
    process.exit(0);
  }

  // Detect indent + trailing newline so we can preserve them
  const trailingNewline = detectTrailingNewline(originalText);
  const newText =
    rewriteScriptsLint(originalText, projectedBody) +
    (trailingNewline && !originalText.endsWith('\n') ? '\n' : '');
  // The above keeps trailing newline behaviour stable.
  const finalText = trailingNewline
    ? newText.endsWith('\n')
      ? newText
      : newText + '\n'
    : newText.replace(/\n$/, '');

  fs.writeFileSync(opts.packageJsonPath, finalText);
  process.stdout.write(
    `lint chain regenerated: ${projection.gateIds.length} gates written to ${opts.packageJsonPath}\n`
  );
  process.exit(0);
}

main();
