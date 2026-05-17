#!/usr/bin/env node
// Topic 2026-05-15-avatar-vrm-deferral-and-authority-reconciliation
// wave-3 smoke gate.
//
// Ensures all admitted representative VRM samples exist, then runs the
// deterministic 21-run smoke matrix. The Vitest path parses each on-disk .vrm
// GLB metadata and drives Avatar's lifecycle, projection, generated-motion,
// expression, and lipsync code paths. Report files are written only when this
// script sets NIMI_AVATAR_VRM_WAVE5_REPORTS=1.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { ensureAllVrmSamples } from './fetch-vrm-models.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const samples = await ensureAllVrmSamples();
for (const sample of samples) {
  process.stdout.write(
    `[vrm-wave5-smoke] sample ready: ${sample.id} ${sample.sizeBytes} bytes -> ${sample.filePath}\n`,
  );
}

execFileSync(
  'pnpm',
  [
    '--filter',
    '@nimiplatform/avatar',
    'exec',
    'vitest',
    'run',
    'src/shell/renderer/vrm/vrm-wave5-real-sample-smoke.test.ts',
  ],
  {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NIMI_AVATAR_VRM_WAVE5_REPORTS: '1',
    },
    stdio: 'inherit',
  },
);
