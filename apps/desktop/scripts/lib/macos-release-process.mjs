import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FORBIDDEN_ENTITLEMENTS = new Set([
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.debugger',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
  'com.apple.security.device.camera',
  'com.apple.security.get-task-allow',
]);

export function runReleaseCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const diagnostic = boundedDiagnostic(`${result.stderr || ''}\n${result.stdout || ''}`);
    throw new Error(`${path.basename(command)} failed with status ${result.status ?? 'unavailable'}${diagnostic ? `: ${diagnostic}` : ''}`, {
      cause: result.error,
    });
  }
  return Object.freeze({ stdout: String(result.stdout || ''), stderr: String(result.stderr || '') });
}

export function verifySignedMacOSCode(executable, expectedIdentifier, expectedTeamId) {
  runReleaseCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', executable]);
  const detail = runReleaseCommand('/usr/bin/codesign', [
    '--display', '--verbose=4', executable,
  ]);
  const output = `${detail.stdout}\n${detail.stderr}`;
  const signingIdentifier = exactLine(output, 'Identifier');
  const teamId = exactLine(output, 'TeamIdentifier');
  if (signingIdentifier !== expectedIdentifier || teamId !== expectedTeamId
    || !/flags=0x[0-9a-f]+\([^\n)]*runtime[^\n)]*\)/iu.test(output)
    || !/^Authority=Developer ID Application:/mu.test(output)
    || !/^Timestamp=/mu.test(output)) {
    throw new Error(`signed macOS role ${expectedIdentifier} does not satisfy the production code policy`);
  }
  const architectures = runReleaseCommand('/usr/bin/lipo', ['-archs', executable]).stdout.trim().split(/\s+/u);
  if (architectures.length !== 1 || architectures[0] !== 'arm64') {
    throw new Error(`signed macOS role ${expectedIdentifier} is not exact native arm64`);
  }
}

export function verifySignedMacOSApplication(appPath, roleExecutables) {
  runReleaseCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  runReleaseCommand('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  runReleaseCommand('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
  for (const executable of roleExecutables) {
    const architectures = runReleaseCommand('/usr/bin/lipo', ['-archs', executable]).stdout.trim().split(/\s+/u).sort();
    if (architectures.length !== 1 || architectures[0] !== 'arm64') {
      throw new Error(`macOS release role is not native arm64: ${path.basename(executable)}`);
    }
  }
  auditMacOSEntitlements(appPath);
}

export function verifySignedMacOSInstaller(pkgPath) {
  const signature = runReleaseCommand('/usr/sbin/pkgutil', ['--check-signature', pkgPath]);
  if (!/Developer ID Installer:/u.test(`${signature.stdout}\n${signature.stderr}`)) {
    throw new Error('macOS installer is not signed by Developer ID Installer');
  }
  runReleaseCommand('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=4', pkgPath]);
  runReleaseCommand('/usr/bin/xcrun', ['stapler', 'validate', pkgPath]);
}

export function requireMacOSSigningIdentity(identity) {
  const result = runReleaseCommand('/usr/bin/security', ['find-identity', '-v']);
  const matches = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/u)
    .filter((line) => line.includes(`"${identity}"`));
  if (matches.length !== 1) throw new Error('required macOS application signing identity is unavailable or ambiguous');
}

function auditMacOSEntitlements(appPath) {
  const codeFiles = collectCodeFiles(appPath);
  if (codeFiles.length === 0) throw new Error('signed macOS application contains no inspectable code');
  for (const file of codeFiles) {
    const result = runReleaseCommand('/usr/bin/codesign', ['--display', '--entitlements', ':-', file]);
    const output = `${result.stdout}\n${result.stderr}`;
    const keys = [...output.matchAll(/<key>([^<]+)<\/key>/gu)].map((match) => match[1]);
    if (keys.some((key) => FORBIDDEN_ENTITLEMENTS.has(key))) {
      throw new Error(`forbidden macOS entitlement on ${path.basename(file)}`);
    }
    const unexpected = keys.filter((key) => key !== 'com.apple.security.cs.allow-jit');
    if (unexpected.length > 0) throw new Error(`unadmitted macOS entitlement on ${path.basename(file)}`);
  }
}

function collectCodeFiles(root) {
  const result = [];
  const visit = (candidate) => {
    const metadata = statSync(candidate, { throwIfNoEntry: false });
    if (!metadata) return;
    if (metadata.isDirectory()) {
      for (const entry of readdirSync(candidate).sort()) visit(path.join(candidate, entry));
      return;
    }
    if (!metadata.isFile()) return;
    if ((metadata.mode & 0o111) !== 0 || /\.(?:dylib|node)$/u.test(candidate)) result.push(candidate);
  };
  visit(root);
  return result;
}

function exactLine(output, label) {
  const matches = [...output.matchAll(new RegExp(`^${label}=([^\\r\\n]+)$`, 'gmu'))];
  if (matches.length !== 1 || !matches[0][1]) throw new Error(`codesign ${label} is missing or ambiguous`);
  return matches[0][1].trim();
}

function boundedDiagnostic(value) {
  return String(value)
    .replaceAll(/[\r\n\t]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
}
