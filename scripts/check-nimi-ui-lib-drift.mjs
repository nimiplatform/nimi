#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/generate-nimi-ui-lib.mjs', '--check'], {
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
