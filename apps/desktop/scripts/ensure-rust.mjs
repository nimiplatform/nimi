#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  throw new Error('Desktop native build requires Rust and cargo in PATH. Install Rust from https://rustup.rs and retry.');
}
process.stdout.write(`[ensure-rust] ${result.stdout.trim()}\n`);
