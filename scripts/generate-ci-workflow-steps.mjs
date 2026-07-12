#!/usr/bin/env node
//
// Generate CI workflow steps from registry projection.
//
// Owner: scripts; this generator projects the registry authority below.
// Authority: P-RELG-010 owner of .github/** step block codegen.
//
// Walks .github/workflows/*.yml files looking for marker fences and
// regenerates the content between them based on the projection key.
//
// Determinism: same registry → same projection → same bytes. Idempotent.
// Offline-safe.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadRegistry } from './lib/release-gate/registry-loader.mjs';
import {
  projectCiStepBlock,
  isKnownProjectionKey,
} from './lib/release-gate/projector-ci-step-block.mjs';

const FENCE_HEAD_RE = /^(\s*)#\s*>>>\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*>>>\s*$/i;
const FENCE_TAIL_RE = /^(\s*)#\s*<<<\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*<<<\s*$/i;

function parseArgs(argv) {
  const opts = {
    registryPath: undefined,
    workflowPath: undefined, // if set, only process this file
    workflowsDir: '.github/workflows',
    check: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--registry-path':
        opts.registryPath = argv[++i];
        break;
      case '--workflow-path':
        opts.workflowPath = argv[++i];
        break;
      case '--workflows-dir':
        opts.workflowsDir = argv[++i];
        break;
      case '--check':
        opts.check = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        process.stderr.write(`unknown argument: ${arg}\n`);
        process.exit(2);
    }
  }
  return opts;
}

const USAGE = [
  'Usage: node scripts/generate-ci-workflow-steps.mjs [options]',
  '',
  'Options:',
  '  --registry-path <path>    Override default registry yaml path',
  '  --workflow-path <path>    Process a single workflow file only',
  '  --workflows-dir <dir>     Override workflows directory (default: .github/workflows)',
  '  --check                   Exit 1 on drift instead of writing',
  '  --help, -h                Print this help and exit 0',
].join('\n');

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  const loadResult = loadRegistry(opts.registryPath);
  if (!loadResult.ok) {
    for (const err of loadResult.errors) {
      process.stderr.write(`registry-load error: ${err}\n`);
    }
    process.exit(1);
  }
  const registry = loadResult.registry;

  const files = [];
  if (opts.workflowPath) {
    files.push(opts.workflowPath);
  } else {
    try {
      const entries = fs.readdirSync(opts.workflowsDir);
      for (const entry of entries) {
        if (/\.ya?ml$/.test(entry)) {
          files.push(path.join(opts.workflowsDir, entry));
        }
      }
      files.sort();
    } catch (error) {
      process.stderr.write(`error reading workflows directory: ${error.message}\n`);
      process.exit(1);
    }
  }

  let driftDetected = false;
  for (const filePath of files) {
    const result = processWorkflowFile(filePath, registry, opts.check);
    if (result.drift) {
      driftDetected = true;
    }
  }

  if (opts.check && driftDetected) {
    process.exit(1);
  }
  process.exit(0);
}

function processWorkflowFile(filePath, registry, checkMode) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    process.stderr.write(`error reading ${filePath}: ${error.message}\n`);
    process.exit(1);
  }

  const lines = text.split('\n');
  const outLines = [];
  let open = null;
  let drift = false;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headMatch = line.match(FENCE_HEAD_RE);
    const tailMatch = line.match(FENCE_TAIL_RE);

    if (headMatch) {
      if (open) {
        process.stderr.write(`${filePath}:${i + 1}: error: unclosed fence for key "${open.key}"\n`);
        process.exit(1);
      }
      const indentStr = headMatch[1];
      const key = headMatch[2];
      if (!isKnownProjectionKey(key)) {
        process.stderr.write(`${filePath}:${i + 1}: error: unknown projection-key "${key}"\n`);
        process.exit(1);
      }
      open = { key, indent: indentStr.length, headLine: i + 1, startIdx: outLines.length };
      outLines.push(line);
      continue;
    }

    if (tailMatch) {
      if (!open) {
        process.stderr.write(`${filePath}:${i + 1}: error: unexpected fence footer\n`);
        process.exit(1);
      }
      const key = tailMatch[2];
      if (key !== open.key) {
        process.stderr.write(`${filePath}:${i + 1}: error: mismatched fence footer (expected "${open.key}", got "${key}")\n`);
        process.exit(1);
      }

      // Generate new content
      const projected = projectCiStepBlock(registry, open.key, { indent: open.indent });
      const newBodyLines = projected.body ? projected.body.split('\n') : [];
      if (newBodyLines.length > 0 && newBodyLines[newBodyLines.length - 1] === '') {
        newBodyLines.pop();
      }

      // Check for drift
      const currentBodyLines = outLines.slice(open.startIdx + 1);
      if (currentBodyLines.join('\n') !== newBodyLines.join('\n')) {
        drift = true;
        changed = true;
        if (checkMode) {
          process.stderr.write(`${filePath}:${open.headLine}: drift detected for key "${open.key}"\n`);
          process.stderr.write(`EXPECTED:\n${projected.body}\n`);
          process.stderr.write(`ACTUAL:\n${currentBodyLines.join('\n')}\n`);
        }
      }

      // Rebuild outLines with projected content
      outLines.splice(open.startIdx + 1, outLines.length - (open.startIdx + 1), ...newBodyLines);
      outLines.push(line);
      open = null;
      continue;
    }

    if (!open) {
      outLines.push(line);
    } else {
      // Capture current body lines for drift check
      outLines.push(line);
    }
  }

  if (open) {
    process.stderr.write(`${filePath}:${open.headLine}: error: unclosed fence for key "${open.key}"\n`);
    process.exit(1);
  }

  if (changed && !checkMode) {
    try {
      fs.writeFileSync(filePath, outLines.join('\n'), 'utf8');
      process.stdout.write(`updated ${filePath}\n`);
    } catch (error) {
      process.stderr.write(`error writing ${filePath}: ${error.message}\n`);
      process.exit(1);
    }
  }

  return { drift };
}

main();
