#!/usr/bin/env node
// Topic 2026-05-01-avatar-apml-auto-adapter wave-5 smoke gate.
//
// Ensures the representative VRM sample exists, then runs the real-sample
// generated motion smoke test. The test parses the on-disk .vrm GLB metadata
// and drives Avatar's typed activity projection -> route -> generated provider
// -> AnimationClip path with fail-closed negative coverage.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { ensureVrmSample } from './fetch-vrm-models.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const sample = await ensureVrmSample('vrm1-constraint-twist');
process.stdout.write(
  `[vrm-wave5-smoke] real sample ready: ${sample.id} ${sample.sizeBytes} bytes -> ${sample.filePath}\n`,
);

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
    stdio: 'inherit',
  },
);
