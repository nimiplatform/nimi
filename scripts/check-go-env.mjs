import { spawnSync } from 'node:child_process';

const MIN_GO_MAJOR = 1;
const MIN_GO_MINOR = 24;
const GO_INSTALL_URL = 'https://go.dev/dl/';

const fail = (message) => {
  process.stderr.write(`[check-go-env] ${message} Install Go: ${GO_INSTALL_URL}\n`);
  process.exit(1);
};

const result = spawnSync('go', ['version'], { encoding: 'utf8' });
if (result.error) {
  if (result.error.code === 'ENOENT') {
    fail('Go is required but was not found in PATH. Install Go 1.24+ and retry.');
  }
  fail(`Failed to execute "go version": ${result.error.message}`);
}

if (result.status !== 0) {
  const details = (result.stderr || result.stdout || '').trim();
  fail(`"go version" returned exit code ${result.status}${details ? `: ${details}` : ''}`);
}

const output = (result.stdout || '').trim();
const versionMatch = output.match(/\bgo(\d+)\.(\d+)(?:\.\d+)?\b/);
if (!versionMatch) {
  fail(`Could not parse Go version from output: ${output}`);
}

const major = Number(versionMatch[1]);
const minor = Number(versionMatch[2]);
const detected = `go${major}.${minor}`;
const belowMinimum = major < MIN_GO_MAJOR || (major === MIN_GO_MAJOR && minor < MIN_GO_MINOR);
if (belowMinimum) {
  fail(`Go 1.24+ is required. Detected ${detected}.`);
}

process.stdout.write(`[check-go-env] detected ${detected} (ok)\n`);
