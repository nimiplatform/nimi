#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const targets = {
  'darwin:arm64': {
    packageName: '@nimiplatform/nimi-darwin-arm64',
    binaryPath: 'bin/nimi',
  },
  'darwin:x64': {
    packageName: '@nimiplatform/nimi-darwin-x64',
    binaryPath: 'bin/nimi',
  },
  'linux:arm64': {
    packageName: '@nimiplatform/nimi-linux-arm64',
    binaryPath: 'bin/nimi',
  },
  'linux:x64': {
    packageName: '@nimiplatform/nimi-linux-x64',
    binaryPath: 'bin/nimi',
  },
  'win32:arm64': {
    packageName: '@nimiplatform/nimi-win32-arm64',
    binaryPath: 'bin/nimi.exe',
  },
  'win32:x64': {
    packageName: '@nimiplatform/nimi-win32-x64',
    binaryPath: 'bin/nimi.exe',
  },
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const target = targets[`${process.platform}:${process.arch}`];
if (!target) {
  fail(`Unsupported platform ${process.platform}/${process.arch}.`);
}

let packageJsonPath;
try {
  packageJsonPath = require.resolve(`${target.packageName}/package.json`);
} catch (_error) {
  fail(`Missing optional package ${target.packageName}. Reinstall @nimiplatform/nimi for ${process.platform}/${process.arch}.`);
}

const binaryPath = join(packageJsonPath, '..', target.binaryPath);
const child = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: true,
});

if (child.error) {
  fail(child.error.message);
}

if (typeof child.status === 'number') {
  process.exit(child.status);
}

fail(`nimi exited abnormally (${child.signal || 'unknown signal'}).`);
