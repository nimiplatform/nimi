import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDesktopElectronSupportLogsHost,
  resolveDesktopSupportLogsArchiveCommand,
} from '../src-electron/support-logs-host.js';

test('Electron support logs uses fixed native zip commands on macOS and Windows', () => {
  assert.deepEqual(
    resolveDesktopSupportLogsArchiveCommand(
      'darwin',
      '/private/tmp/nimi-logs',
      '/Users/example/Downloads/nimi-logs.zip',
    ),
    {
      executable: '/usr/bin/ditto',
      arguments: [
        '-c',
        '-k',
        '--norsrc',
        '--noextattr',
        '--noqtn',
        '--noacl',
        '/private/tmp/nimi-logs',
        '/Users/example/Downloads/nimi-logs.zip',
      ],
    },
  );
  assert.deepEqual(
    resolveDesktopSupportLogsArchiveCommand(
      'win32',
      'C:\\Users\\example\\AppData\\Local\\Temp\\nimi-logs',
      'C:\\Users\\example\\Downloads\\nimi-logs.zip',
      'C:\\Windows',
    ),
    {
      executable: 'C:\\Windows\\System32\\tar.exe',
      arguments: [
        '-a',
        '-c',
        '-f',
        'C:\\Users\\example\\Downloads\\nimi-logs.zip',
        '-C',
        'C:\\Users\\example\\AppData\\Local\\Temp\\nimi-logs',
        '.',
      ],
    },
  );
  assert.throws(
    () => resolveDesktopSupportLogsArchiveCommand(
      'win32',
      'C:\\Users\\example\\AppData\\Local\\Temp\\nimi-logs',
      'C:\\Users\\example\\Downloads\\nimi-logs.zip',
      'C:\\Users\\example\\writable-system-root',
    ),
    /desktop-logs-export-system-root-invalid/u,
  );
});

test('macOS Electron support logs exports real log files and excludes symlinks', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-support-logs-test-'));
  const dataRoot = path.join(root, 'data');
  const downloadsDirectory = path.join(root, 'downloads');
  const logsDirectory = path.join(dataRoot, 'logs');
  const nestedDirectory = path.join(logsDirectory, 'runtime');
  const outsidePath = path.join(root, 'outside-secret.txt');
  let revealedPath = '';

  try {
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(path.join(logsDirectory, 'desktop.log'), 'desktop line\n');
    await writeFile(path.join(nestedDirectory, 'runtime.log'), 'runtime line\n');
    await writeFile(outsidePath, 'must not export\n');
    await symlink(outsidePath, path.join(logsDirectory, 'outside.log'));

    const host = createDesktopElectronSupportLogsHost({
      resolveSelectedDataRoot: async () => dataRoot,
      downloadsDirectory,
      revealFile: (filePath) => {
        revealedPath = filePath;
      },
    });
    const result = await host.commandHandlers.desktop_logs_export({ payload: {} });

    assert.equal(result.fileCount, 2);
    assert.equal(result.byteSize, Buffer.byteLength('desktop line\nruntime line\n'));
    assert.equal(result.artifactPath, revealedPath);
    assert.equal((await readFile(result.artifactPath)).subarray(0, 2).toString('hex'), '504b');

    const archiveEntries = execFileSync('/usr/bin/unzip', ['-Z1', result.artifactPath], {
      encoding: 'utf8',
    })
      .split(/\r?\n/u)
      .map((entry) => entry.replace(/^\.\//u, '').trim())
      .filter(Boolean);
    assert.ok(archiveEntries.includes('desktop.log'));
    assert.ok(archiveEntries.includes('runtime/runtime.log'));
    assert.ok(!archiveEntries.some((entry) => entry.includes('outside.log')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS Electron support logs fails closed for an empty logs directory', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-support-logs-empty-test-'));
  const dataRoot = path.join(root, 'data');
  const downloadsDirectory = path.join(root, 'downloads');
  try {
    await mkdir(path.join(dataRoot, 'logs'), { recursive: true });
    const host = createDesktopElectronSupportLogsHost({
      resolveSelectedDataRoot: async () => dataRoot,
      downloadsDirectory,
      revealFile: () => undefined,
    });

    await assert.rejects(
      host.commandHandlers.desktop_logs_export({ payload: {} }),
      /desktop-logs-export-logs-directory-empty/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
