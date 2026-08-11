import { spawnSync } from 'node:child_process';

const MIN_GO_MAJOR = 1;
const MIN_GO_MINOR = 26;
const MIN_GO_PATCH = 5;
const GO_INSTALL_URL = 'https://go.dev/dl/';
const REQUIRED_TOOLCHAIN = `go${MIN_GO_MAJOR}.${MIN_GO_MINOR}.${MIN_GO_PATCH}`;

const fail = (message) => {
  process.stderr.write(`[check-go-env] ${message} Install Go: ${GO_INSTALL_URL}\n`);
  process.exit(1);
};

const result = spawnSync('go', ['version'], { encoding: 'utf8' });
if (result.error) {
  if (result.error.code === 'ENOENT') {
    fail(`Go is required but was not found in PATH. Install Go ${MIN_GO_MAJOR}.${MIN_GO_MINOR}.${MIN_GO_PATCH}+ and retry.`);
  }
  fail(`Failed to execute "go version": ${result.error.message}`);
}

if (result.status !== 0) {
  const details = (result.stderr || result.stdout || '').trim();
  fail(`"go version" returned exit code ${result.status}${details ? `: ${details}` : ''}`);
}

const output = (result.stdout || '').trim();
const detected = parseGoVersion(output);
if (!detected) {
  fail(`Could not parse Go version from output: ${output}`);
}

if (isAtLeastRequired(detected)) {
  process.stdout.write(`[check-go-env] detected ${formatGoVersion(detected)} (ok)\n`);
  process.exit(0);
}

const toolchainResult = spawnSync('go', ['version'], {
  encoding: 'utf8',
  env: { ...process.env, GOTOOLCHAIN: `${REQUIRED_TOOLCHAIN}+auto` },
});
const toolchainOutput = (toolchainResult.stdout || '').trim();
const toolchainVersion = parseGoVersion(toolchainOutput);
if (toolchainResult.status === 0 && toolchainVersion && isAtLeastRequired(toolchainVersion)) {
  process.stdout.write(
    `[check-go-env] detected ${formatGoVersion(detected)}; ${formatGoVersion(toolchainVersion)} available through GOTOOLCHAIN=auto (ok)\n`,
  );
  process.exit(0);
}

fail(
  `Go ${MIN_GO_MAJOR}.${MIN_GO_MINOR}.${MIN_GO_PATCH}+ is required. Detected ${formatGoVersion(detected)}.`,
);

function parseGoVersion(text) {
  const versionMatch = text.match(/\bgo(\d+)\.(\d+)(?:\.(\d+))?\b/);
  if (!versionMatch) return null;
  return {
    major: Number(versionMatch[1]),
    minor: Number(versionMatch[2]),
    patch: Number(versionMatch[3] ?? 0),
  };
}

function isAtLeastRequired(version) {
  if (version.major !== MIN_GO_MAJOR) return version.major > MIN_GO_MAJOR;
  if (version.minor !== MIN_GO_MINOR) return version.minor > MIN_GO_MINOR;
  return version.patch >= MIN_GO_PATCH;
}

function formatGoVersion(version) {
  return `go${version.major}.${version.minor}.${version.patch}`;
}
