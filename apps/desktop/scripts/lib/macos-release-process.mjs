import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

export async function sha256File(file) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

export async function inspectSignedMacOSCode(executable, expectedIdentifier, expectedTeamId) {
  runReleaseCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', executable]);
  const detail = runReleaseCommand('/usr/bin/codesign', [
    '--display', '--verbose=4', '--requirements', '-', executable,
  ]);
  const output = `${detail.stdout}\n${detail.stderr}`;
  const signingIdentifier = exactLine(output, 'Identifier');
  const teamId = exactLine(output, 'TeamIdentifier');
  const cdhash = exactLine(output, 'CDHash').toLowerCase();
  const designatedRequirement = exactDesignatedRequirement(output);
  if (signingIdentifier !== expectedIdentifier || teamId !== expectedTeamId
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(cdhash)
    || !/flags=0x[0-9a-f]+\([^\n)]*runtime[^\n)]*\)/iu.test(output)
    || !/^Authority=Developer ID Application:/mu.test(output)
    || !/^Timestamp=/mu.test(output)) {
    throw new Error(`signed macOS role ${expectedIdentifier} does not satisfy the production code policy`);
  }
  return Object.freeze({
    artifactSha256: await sha256File(executable),
    cdhash,
    designatedRequirement,
    signingIdentifier,
    teamId,
  });
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

export function signMacOSReleaseRecord(payload, signerPath, rootKeyId, expectedTeamId) {
  if (typeof payload !== 'string' || Buffer.byteLength(payload) === 0 || Buffer.byteLength(payload) > 64 * 1024) {
    throw new Error('macOS release record signer payload is invalid');
  }
  const metadata = lstatSync(signerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o022) !== 0
    || (metadata.mode & 0o111) === 0 || realpathSync(signerPath) !== signerPath) {
    throw new Error('macOS release record signer installation is untrusted');
  }
  runReleaseCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', signerPath]);
  const identity = runReleaseCommand('/usr/bin/codesign', ['--display', '--verbose=4', signerPath]);
  const teamId = exactLine(`${identity.stdout}\n${identity.stderr}`, 'TeamIdentifier');
  if (teamId !== expectedTeamId) throw new Error('macOS release record signer Team ID mismatch');
  const result = spawnSync(signerPath, ['sign-release-record', '--key-id', rootKeyId], {
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME || '/var/empty',
      LANG: 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: '/private/tmp',
    },
    input: payload,
    maxBuffer: 4 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0 || String(result.stderr || '').trim() !== '') {
    throw new Error(`macOS release record signing service failed with status ${result.status ?? 'unavailable'}`, {
      cause: result.error,
    });
  }
  const signature = String(result.stdout || '').trim();
  if (!/^[A-Za-z0-9_-]{86}$/u.test(signature)) {
    throw new Error('macOS release record signing service returned an invalid signature');
  }
  return signature;
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

function exactDesignatedRequirement(output) {
  const matches = [...output.matchAll(/^designated => (.+)$/gmu)];
  if (matches.length !== 1 || !matches[0][1]) throw new Error('codesign designated requirement is missing or ambiguous');
  return matches[0][1].trim();
}

function boundedDiagnostic(value) {
  return String(value)
    .replaceAll(/[\r\n\t]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
}
