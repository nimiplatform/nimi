#!/usr/bin/env node
//
// Nimi Release Preflight — Node entry point.
//
// Owner: scripts; this entry point executes the registry authority below.
// Authority: P-RELG-001..014 in
// .nimi/spec/platform/kernel/release-gate-contract.md.
//
// Replaces scripts/check-release-preflight.sh (deleted in W2). This
// entry point is intentionally thin: it composes the CLI, registry
// loader, runner, evidence writer, and log formatter modules under
// scripts/lib/release-gate/.
//
// Usage: pnpm preflight [options]   (see --help)
//
// Determinism: gate selection by tier ∩ target ∩ filter; topo-sort
// stable tie-break by gate id. Same registry + same flags + same git
// HEAD → same evidence shape (modulo timestamps + log file paths).
// Offline-safe at the runner level (registry's requires_secrets +
// requires_external_repo are the gating mechanism for live tier).

import process from 'node:process';
import { loadRegistry } from './lib/release-gate/registry-loader.mjs';
import { parseArgs, printUsage } from './lib/release-gate/cli.mjs';
import { captureHostEnvironment } from './lib/release-gate/env-probe.mjs';
import { selectGates, executeGates, computeProcessExitCode } from './lib/release-gate/runner.mjs';
import {
  buildEvidenceDocument,
  assertEvidenceShape,
  writeEvidenceFile,
  defaultEvidencePath,
} from './lib/release-gate/evidence.mjs';
import { formatHeader, formatSummary } from './lib/release-gate/log-formatter.mjs';

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error}\n`);
    printUsage();
    process.exit(2);
  }
  const options = parsed.options;
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const colorEnabled =
    options.color && (process.stdout.isTTY ?? false) && process.env.NO_COLOR == null;

  // 1. Load registry
  const loadResult = loadRegistry();
  if (!loadResult.ok) {
    for (const err of loadResult.errors) {
      process.stderr.write(`registry-load error: ${err}\n`);
    }
    process.exit(1);
  }
  const registry = loadResult.registry;

  // 2. Select gates
  const { selected, selectedTier } = selectGates(registry.gates, options);
  if (selected.length === 0) {
    process.stderr.write(
      `no gates matched tier=${options.tier} target=${options.target}` +
        (options.filter ? ` filter=${options.filter}` : '') +
        '\n'
    );
    process.exit(1);
  }

  // 3. Capture host environment + open evidence document
  const startedAt = new Date().toISOString();
  const hostEnvironment = captureHostEnvironment();

  // 4. Print header
  process.stdout.write(
    formatHeader({
      profileId: registry.profile_id,
      registryVersion: registry.registry_version,
      hostEnvironment,
      tier: options.tier,
      target: options.target,
      requireRelease: options.requireRelease,
      allowBlockedTiers: options.allowBlockedTiers,
      color: colorEnabled,
    })
  );

  // 5. Execute
  const { rows } = await executeGates({
    gates: selected,
    selectedTier,
    options: { ...options, color: colorEnabled },
    onProgress: (line) => process.stdout.write(line),
    onLiveProgress: (line) => process.stderr.write(line),
  });

  const finishedAt = new Date().toISOString();

  // 6. Build evidence document
  const document = buildEvidenceDocument({
    profileId: registry.profile_id,
    registryVersion: registry.registry_version,
    startedAt,
    finishedAt,
    hostEnvironment,
    tierFilter: options.tier,
    targetFilter: options.target,
    requireRelease: options.requireRelease,
    gateRows: rows,
  });

  assertEvidenceShape(document);

  // 7. Write evidence
  const evidencePath = defaultEvidencePath(startedAt);
  writeEvidenceFile(document, evidencePath);

  // 8. Print summary
  process.stdout.write(
    formatSummary({
      summary: document.summary,
      evidencePath,
      requireRelease: options.requireRelease,
      color: colorEnabled,
    })
  );

  // 9. Optional --json: stream evidence document to stdout
  if (options.json) {
    process.stdout.write(JSON.stringify(document, null, 2) + '\n');
  }

  // 10. Compute exit code per L4 / L5
  const gatesById = new Map(selected.map((g) => [g.id, g]));
  const exitCode = computeProcessExitCode({ rows, gatesById, options });
  process.exit(exitCode);
}

main().catch((error) => {
  process.stderr.write(`release-preflight failed: ${error.stack ?? error.message ?? String(error)}\n`);
  process.exit(1);
});
