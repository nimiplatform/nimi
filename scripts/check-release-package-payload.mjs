#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TARGETS = Object.freeze({
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', format: 'mach-o' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', format: 'mach-o' },
  'linux-arm64': { os: 'linux', cpu: 'arm64', format: 'elf' },
  'linux-x64': { os: 'linux', cpu: 'x64', format: 'elf' },
  'win32-arm64': { os: 'win32', cpu: 'arm64', format: 'pe' },
  'win32-x64': { os: 'win32', cpu: 'x64', format: 'pe' },
});

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const parsed = { family: '', target: '', tarball: '', expectedVersion: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === '--family') {
      parsed.family = String(value || '');
      index += 1;
    } else if (token === '--target') {
      parsed.target = String(value || '');
      index += 1;
    } else if (token === '--tarball') {
      parsed.tarball = String(value || '');
      index += 1;
    } else if (token === '--expected-version') {
      parsed.expectedVersion = String(value || '');
      index += 1;
    } else {
      fail(`unknown argument: ${token}`);
    }
  }
  if (!['kit-native', 'runtime-native', 'runtime-launcher'].includes(parsed.family)) {
    fail('--family must be kit-native, runtime-native, or runtime-launcher');
  }
  if (!parsed.tarball) fail('--tarball is required');
  if (!parsed.expectedVersion) fail('--expected-version is required');
  if (parsed.family === 'runtime-launcher') {
    if (parsed.target) fail('runtime-launcher does not accept --target');
  } else if (!TARGETS[parsed.target]) {
    fail(`unsupported --target: ${parsed.target || '<missing>'}`);
  }
  if (parsed.family === 'kit-native' && !['darwin-arm64', 'win32-x64'].includes(parsed.target)) {
    fail(`kit-native does not publish target ${parsed.target}`);
  }
  return parsed;
}

function packageContract({ family, target }) {
  if (family === 'runtime-launcher') {
    return {
      name: '@nimiplatform/nimi',
      binary: 'bin/nimi.js',
      allowedFiles: ['LICENSE', 'README.md', 'bin/nimi.js', 'package.json'],
    };
  }
  if (family === 'kit-native') {
    return {
      name: `@nimiplatform/kit-protected-local-${target}`,
      binary: 'nimi_shell_protected_local.node',
      allowedFiles: ['LICENSE', 'README.md', 'index.cjs', 'nimi_shell_protected_local.node', 'package.json'],
    };
  }
  return {
    name: `@nimiplatform/nimi-${target}`,
    binary: target.startsWith('win32-') ? 'bin/nimi.exe' : 'bin/nimi',
    allowedFiles: [
      'LICENSE',
      'README.md',
      target.startsWith('win32-') ? 'bin/nimi.exe' : 'bin/nimi',
      'package.json',
    ],
  };
}

function runTar(args, options = {}) {
  const result = spawnSync('tar', args, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    fail(`tar ${args[0]} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

function tarballEntries(tarball) {
  return String(runTar(['-tf', tarball]))
    .split(/\r?\n/u)
    .map((entry) => entry.trim().replaceAll('\\', '/'))
    .filter((entry) => entry && !entry.endsWith('/'));
}

function assertManifest(manifest, parsed, contract) {
  if (manifest.name !== contract.name) fail(`package name ${manifest.name || '<missing>'} must be ${contract.name}`);
  if (manifest.version !== parsed.expectedVersion) {
    fail(`package version ${manifest.version || '<missing>'} must be ${parsed.expectedVersion}`);
  }
  if (manifest.private === true) fail('package must be publishable');
  if (manifest.publishConfig?.access !== 'public') fail('publishConfig.access must be public');
  const expectedLicense = parsed.family === 'kit-native' ? 'MIT' : 'Apache-2.0';
  if (manifest.license !== expectedLicense) fail(`package license must be ${expectedLicense}`);

  if (parsed.family === 'runtime-launcher') {
    if (manifest.bin?.nimi !== contract.binary) fail(`launcher bin.nimi must be ${contract.binary}`);
    return;
  }

  const target = TARGETS[parsed.target];
  if (JSON.stringify(manifest.os) !== JSON.stringify([target.os])) fail(`package os must be ["${target.os}"]`);
  if (JSON.stringify(manifest.cpu) !== JSON.stringify([target.cpu])) fail(`package cpu must be ["${target.cpu}"]`);
  if (parsed.family === 'kit-native') {
    if (manifest.main !== 'index.cjs') fail('kit-native main must be index.cjs');
  } else if (manifest.bin?.nimi !== contract.binary) {
    fail(`runtime-native bin.nimi must be ${contract.binary}`);
  }
}

function detectBinary(buffer) {
  if (buffer.length < 24) fail('native payload is too small');
  if (buffer.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = buffer.readUInt32LE(4);
    return { format: 'mach-o', cpu: cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : 'unknown' };
  }
  if (buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') {
    const machine = buffer[5] === 2 ? buffer.readUInt16BE(18) : buffer.readUInt16LE(18);
    return { format: 'elf', cpu: machine === 183 ? 'arm64' : machine === 62 ? 'x64' : 'unknown' };
  }
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (peOffset + 6 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) fail('invalid PE header');
    const machine = buffer.readUInt16LE(peOffset + 4);
    return { format: 'pe', cpu: machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : 'unknown' };
  }
  fail('unrecognized native binary format');
}

function auditTarball(parsed) {
  const tarball = path.resolve(parsed.tarball);
  statSync(tarball);
  const contract = packageContract(parsed);
  const entries = tarballEntries(tarball);
  const expectedEntries = contract.allowedFiles.map((entry) => `package/${entry}`).sort();
  const actualEntries = [...entries].sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    fail(`tarball payload must be exactly ${expectedEntries.join(', ')}; got ${actualEntries.join(', ')}`);
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-release-package-payload-'));
  try {
    runTar(['-xf', tarball, '-C', tempRoot, 'package/package.json', `package/${contract.binary}`]);
    const packageRoot = path.join(tempRoot, 'package');
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    assertManifest(manifest, parsed, contract);
    const binary = readFileSync(path.join(packageRoot, contract.binary));
    if (parsed.family === 'runtime-launcher') {
      if (!binary.toString('utf8').startsWith('#!/usr/bin/env node\n')) fail('runtime launcher must keep its Node shebang');
    } else {
      const detected = detectBinary(binary);
      const target = TARGETS[parsed.target];
      if (detected.format !== target.format || detected.cpu !== target.cpu) {
        fail(`native payload is ${detected.format}/${detected.cpu}, expected ${target.format}/${target.cpu}`);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  process.stdout.write(`${parsed.family} payload check passed (${parsed.target || 'launcher'} ${parsed.expectedVersion})\n`);
}

try {
  auditTarball(parseArgs(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`release package payload check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
