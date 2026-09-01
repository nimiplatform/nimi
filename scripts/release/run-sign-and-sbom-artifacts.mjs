#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensurePinnedGoTool, prependPath } from '../lib/pinned-go-tools.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const signScript = path.join(scriptDir, 'sign-and-sbom-artifacts.mjs');

function main() {
  const cosign = ensurePinnedGoTool('cosign');
  const syft = ensurePinnedGoTool('syft');
  const toolBinDir = syft.binDir || cosign.binDir;
  const result = spawnSync(process.execPath, [signScript], {
    cwd: repoRoot,
    env: {
      ...prependPath(process.env, toolBinDir),
      NIMI_COSIGN_BIN: cosign.binaryPath,
      NIMI_SYFT_BIN: syft.binaryPath,
    },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? (result.signal ? 1 : 0));
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sign-and-sbom-wrapper] ${error.stack ?? error.message ?? String(error)}\n`);
  process.exit(1);
}
