#!/usr/bin/env node
//
// Check release gate registry coherence.
//
// Owner: scripts (W1 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-001 / P-RELG-008 / P-RELG-009 / P-RELG-012 / P-RELG-013
// in .nimi/spec/platform/kernel/release-gate-contract.md.
//
// Validates the release-gate-registry.yaml against the D2 schema rules
// (gate id pattern, owner namespace allow-list, tier/target/reason-code
// references, prerequisite resolvability, anchors, evidence shape, etc.).
//
// Exits 1 with structured stderr on any violation; exits 0 on green.
// Per Auditor Precedence sub-rule C, this gate is a typed-contract emitter
// — both exit code AND structured output communicate the verdict. The
// structured output is plain text (one error per line), not JSON. Future
// versions may emit validator-cli-result.v1 JSON; coherence checker is
// kept simple at W1 to minimize bootstrap surface.
//
// Determinism: registry is read from a fixed path (or a path passed via
// --registry-path); no network access; no environment variable reads
// other than process.cwd().
// Offline-safe: yes.

import process from 'node:process';
import {
  loadRegistry,
  validateRegistry,
  loadKnownPRelgIds,
  loadKnownPGovIds,
} from './lib/release-gate/registry-loader.mjs';
import { checkWorkflowReferences } from './lib/release-gate/workflow-resolver.mjs';

function parseArgs(argv) {
  const opts = {
    registryPath: undefined,
    skipAnchorResolution: false,
    skipWorkflowResolution: false,
    rootDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--registry-path') {
      opts.registryPath = argv[++i];
    } else if (arg === '--skip-anchor-resolution') {
      opts.skipAnchorResolution = true;
    } else if (arg === '--skip-workflow-resolution') {
      opts.skipWorkflowResolution = true;
    } else if (arg === '--root-dir') {
      opts.rootDir = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      printUsage();
      process.exit(2);
    }
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/check-release-gate-registry-coherence.mjs [options]',
      '',
      'Options:',
      '  --registry-path <path>         Override default registry yaml path',
      '                                 (default: .nimi/spec/platform/kernel/tables/release-gate-registry.yaml)',
      '  --skip-anchor-resolution       Do not load P-RELG/P-GOV anchor sources',
      '                                 (used by tests; production runs always resolve)',
      '  --skip-workflow-resolution     Do not run the W4 workflow-yml',
      '                                 reference resolution pass (used by',
      '                                 tests; production runs always check)',
      '  --root-dir <path>              Override repo root for the workflow',
      '                                 resolution pass (default: cwd)',
      '  --help, -h                     Print this help and exit',
      '',
      'Exit: 0 on green; 1 on coherence violation; 2 on usage error',
    ].join('\n') + '\n'
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const loadResult = loadRegistry(opts.registryPath);
  if (!loadResult.ok) {
    for (const err of loadResult.errors) {
      process.stderr.write(`registry-load error: ${err}\n`);
    }
    process.exit(1);
  }

  const context = {};
  if (!opts.skipAnchorResolution) {
    context.knownPRelgIds = loadKnownPRelgIds();
    context.knownPGovIds = loadKnownPGovIds();
    if (context.knownPRelgIds.size === 0) {
      process.stderr.write(
        'release-gate-contract.md not found or has no P-RELG-* rules; ' +
          'aborting (cannot resolve gate.p_relg_anchors).\n'
      );
      process.exit(1);
    }
    if (context.knownPGovIds.size === 0) {
      process.stderr.write(
        'governance-contract.md not found or has no P-GOV-* rules; ' +
          'aborting (cannot resolve gate.parent_p_gov_anchors).\n'
      );
      process.exit(1);
    }
  }

  const validation = validateRegistry(loadResult.registry, context);
  if (!validation.ok) {
    process.stderr.write(`release-gate registry coherence: FAIL (${validation.errors.length} error(s))\n`);
    for (const err of validation.errors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.exit(1);
  }

  // W4 pass: every `pnpm <script>` reference inside .github/workflows/*.yml
  // must resolve to a defined script in the workspace package.json set.
  // Fail-close per P-RELG-011 enforcement.
  if (!opts.skipWorkflowResolution) {
    const workflowResult = checkWorkflowReferences(opts.rootDir);
    if (!workflowResult.ok) {
      process.stderr.write(
        `release-gate workflow resolution: FAIL (${workflowResult.unresolved.length} unresolved reference(s) across ${workflowResult.scanned} workflow file(s))\n`
      );
      for (const u of workflowResult.unresolved) {
        const filterDesc = u.filterPkg ? ` --filter ${u.filterPkg}` : '';
        const dirDesc = u.dirPath ? ` --dir ${u.dirPath}` : '';
        const recDesc = u.recursive ? ' --recursive' : '';
        process.stderr.write(
          `  - ${u.file}:${u.line} pnpm${filterDesc}${dirDesc}${recDesc} ${u.script}  [${u.reason}]\n`
        );
      }
      process.exit(1);
    }
  }

  const gateCount = Array.isArray(loadResult.registry.gates)
    ? loadResult.registry.gates.length
    : 0;
  process.stdout.write(
    `release-gate registry coherence: OK (${gateCount} gates, schema=${loadResult.registry.schema_version}, registry_version=${loadResult.registry.registry_version})\n`
  );
  if (!opts.skipWorkflowResolution) {
    process.stdout.write(
      `release-gate workflow resolution: OK\n`
    );
  }
  process.exit(0);
}

main();
