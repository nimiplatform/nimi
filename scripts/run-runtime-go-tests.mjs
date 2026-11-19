import { spawnSync } from 'node:child_process';

// On Windows the full SQLite-backed service suites can spend over five
// minutes creating and flushing databases across hundreds of test cases.
const timeout = process.platform === 'win32' ? '15m' : '5m';
const result = spawnSync('go', ['test', '-count=1', `-timeout=${timeout}`, './...'], {
  cwd: new URL('../runtime/', import.meta.url),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
