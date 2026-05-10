#!/usr/bin/env node
//
// Check release gate projection drift.
//
// Owner: scripts (W2 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-009
// drift gate self-bootstrap, P-RELG-010 .github/** step block codegen.
//
// Compares projection surfaces against what the registry projects:
//   - W2 mode (current): registry-coherent-with-current-lint and
//     fence-walk for any existing fences (zero at W2 close)
//   - W3 mode (activated by W3 commit): byte-compares package.json
//     scripts.lint against projector-lint output
//   - W5 mode (activated by W5 commit): walks .github/workflows/*.yml
//     for marker fences and byte-compares each fence body against
//     projector-ci-step-block output
//
// Determinism: pure projection comparison; no network; no command
// execution. Offline-safe.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadRegistry } from './lib/release-gate/registry-loader.mjs';
import { projectLintChain } from './lib/release-gate/projector-lint.mjs';
import {
  projectCiStepBlock,
  isKnownProjectionKey,
} from './lib/release-gate/projector-ci-step-block.mjs';

function parseArgs(argv) {
  const opts = {
    registryPath: undefined,
    workflowsDir: '.github/workflows',
    packageJsonPath: 'package.json',
    mode: 'auto', // auto | w2 | w3 | w5
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--registry-path':
        opts.registryPath = argv[++i];
        break;
      case '--workflows-dir':
        opts.workflowsDir = argv[++i];
        break;
      case '--package-json':
        opts.packageJsonPath = argv[++i];
        break;
      case '--mode':
        opts.mode = argv[++i];
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
  'Usage: node scripts/check-release-gate-projection-drift.mjs [options]',
  '',
  'Options:',
  '  --registry-path <path>    Override default registry yaml path',
  '  --workflows-dir <dir>     Override .github/workflows directory',
  '  --package-json <path>     Override package.json path',
  '  --mode <auto|w2|w3|w5>    Activation mode (default: auto)',
  '                            auto: detect by presence of fences / lint regen marker',
  '                            w2: registry-coherent-with-current-lint only',
  '                            w3: include lint-chain projection drift',
  '                            w5: include CI workflow fence projection drift',
  '  --help                    Print this help and exit',
  '',
  'Exit: 0 on green; 1 on drift detected; 2 on usage error',
].join('\n');

const FENCE_HEAD_RE = /^\s*#\s*>>>\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*>>>\s*$/i;
const FENCE_TAIL_RE = /^\s*#\s*<<<\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*<<<\s*$/i;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];

  const loadResult = loadRegistry(opts.registryPath);
  if (!loadResult.ok) {
    for (const err of loadResult.errors) {
      process.stderr.write(`registry-load error: ${err}\n`);
    }
    process.exit(1);
  }
  const registry = loadResult.registry;

  // W3+ mode: lint chain projection drift detection
  if (opts.mode === 'w3' || opts.mode === 'w5' || opts.mode === 'auto') {
    const lintCheck = checkLintChainDrift(registry, opts.packageJsonPath, opts.mode);
    errors.push(...lintCheck.errors);
    warnings.push(...lintCheck.warnings);
  }

  // W5+ mode: CI workflow fence projection drift detection
  if (opts.mode === 'w5' || opts.mode === 'auto') {
    const fenceCheck = checkWorkflowFenceDrift(registry, opts.workflowsDir);
    errors.push(...fenceCheck.errors);
    warnings.push(...fenceCheck.warnings);
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stdout.write(`WARN: ${w}\n`);
    }
  }

  if (errors.length === 0) {
    process.stdout.write(
      `release-gate projection drift: OK (mode=${opts.mode})\n`
    );
    process.exit(0);
  }

  process.stderr.write(
    `release-gate projection drift: FAIL (${errors.length} drift(s))\n`
  );
  for (const err of errors) {
    process.stderr.write(`  - ${err}\n`);
  }
  process.exit(1);
}

function checkLintChainDrift(registry, packageJsonPath, mode) {
  const errors = [];
  const warnings = [];
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    errors.push(
      `unable to read ${packageJsonPath}: ${String(error?.message ?? error)}`
    );
    return { errors, warnings };
  }
  const currentLintBody = pkg?.scripts?.lint;
  if (typeof currentLintBody !== 'string') {
    errors.push(`${packageJsonPath}: scripts.lint missing or not a string`);
    return { errors, warnings };
  }

  let projected;
  try {
    projected = projectLintChain(registry);
  } catch (error) {
    errors.push(
      `lint chain projection failed: ${String(error?.message ?? error)}`
    );
    return { errors, warnings };
  }

  if (mode === 'auto' || mode === 'w2') {
    // W2 mode is informational: report whether the projection MATCHES the
    // current hand-maintained lint body. We do NOT fail on drift here
    // because W3 lands the actual generation.
    if (projected.body !== currentLintBody) {
      warnings.push(
        `lint chain not yet generated from registry (W3 will land this transition); ` +
          `projected length=${projected.body.length}, current length=${currentLintBody.length}, ` +
          `gate count=${projected.gateIds.length}`
      );
    }
    return { errors, warnings };
  }

  // W3+ mode: drift is BLOCKING
  if (projected.body !== currentLintBody) {
    errors.push(
      `package.json scripts.lint drifted from registry projection (PROJECTION_DRIFT). ` +
        `Re-run: pnpm exec node scripts/generate-lint-chain.mjs (lands in W3).`
    );
  }
  return { errors, warnings };
}

function checkWorkflowFenceDrift(registry, workflowsDir) {
  const errors = [];
  const warnings = [];

  let entries = [];
  try {
    entries = fs.readdirSync(workflowsDir).filter((n) => /\.ya?ml$/.test(n));
  } catch (error) {
    warnings.push(
      `workflows dir unreadable (${workflowsDir}): ${String(error?.message ?? error)}; skipping fence drift check`
    );
    return { errors, warnings };
  }

  let totalFences = 0;
  for (const fileName of entries) {
    const fullPath = path.join(workflowsDir, fileName);
    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
      warnings.push(
        `failed to read ${fullPath}: ${String(error?.message ?? error)}`
      );
      continue;
    }
    const fences = extractFences(text);
    totalFences += fences.length;
    for (const fence of fences) {
      if (!isKnownProjectionKey(fence.key)) {
        errors.push(
          `${fileName}:${fence.headLine}: UNKNOWN_PROJECTION_KEY "${fence.key}"`
        );
        continue;
      }
      let projected;
      try {
        projected = projectCiStepBlock(registry, fence.key, { indent: fence.indent });
      } catch (error) {
        errors.push(
          `${fileName}:${fence.headLine}: projection failed for key "${fence.key}": ` +
            String(error?.message ?? error)
        );
        continue;
      }
      // Normalise trailing newlines for comparison
      const projectedNorm = projected.body.replace(/\n+$/, '');
      const fenceNorm = fence.bodyLines.join('\n').replace(/\n+$/, '');
      if (projectedNorm !== fenceNorm) {
        errors.push(
          `${fileName}:${fence.headLine}: PROJECTION_DRIFT for key "${fence.key}" — ` +
            `fence content does not match registry projection. Re-run: ` +
            `pnpm exec node scripts/generate-ci-workflow-steps.mjs (lands in W5).`
        );
      }
    }
  }
  if (totalFences === 0) {
    warnings.push(
      `no projection fences found in ${workflowsDir}; W5 lands them. (mode=auto skips fence-drift fail.)`
    );
  }
  return { errors, warnings };
}

function extractFences(text) {
  const lines = text.split('\n');
  const fences = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const head = line.match(FENCE_HEAD_RE);
    if (head) {
      if (open) {
        // Unmatched head before the previous closes; treat as fence-malformed
        open = null;
      }
      // Capture indent of the marker line
      const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
      open = { key: head[1], headLine: i + 1, indent, bodyLines: [] };
      continue;
    }
    const tail = line.match(FENCE_TAIL_RE);
    if (tail) {
      if (open && open.key === tail[1]) {
        fences.push(open);
        open = null;
      } else {
        open = null;
      }
      continue;
    }
    if (open) {
      open.bodyLines.push(line);
    }
  }
  return fences;
}

main();
