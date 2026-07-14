import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { publishPreparedElectronRuntime } from '../scripts/lib/atomic-electron-runtime.mjs';

const ROLE_EXECUTABLE = 'Nimi Desktop Runtime.exe';

test('Electron runtime publication exposes only a complete initial candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-publish-initial-'));
  try {
    const stagingRoot = path.join(root, 'candidate.staging');
    const candidateRoot = path.join(root, 'candidate');
    seed(stagingRoot, 'signed-initial', 'resource-initial');

    const executable = publishPreparedElectronRuntime({ stagingRoot, candidateRoot, roleExecutableName: ROLE_EXECUTABLE });

    assert.equal(fs.existsSync(stagingRoot), false);
    assert.equal(fs.readFileSync(executable, 'utf8'), 'signed-initial');
    assert.equal(fs.readFileSync(path.join(candidateRoot, 'resources', 'app.txt'), 'utf8'), 'resource-initial');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Electron runtime replacement keeps the published executable until the prepared replacement is valid', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-publish-replace-'));
  try {
    const candidateRoot = path.join(root, 'candidate');
    seed(candidateRoot, 'signed-current', 'resource-current');
    const invalidStagingRoot = path.join(root, 'invalid.staging');
    fs.mkdirSync(invalidStagingRoot, { recursive: true });

    assert.throws(
      () => publishPreparedElectronRuntime({
        stagingRoot: invalidStagingRoot,
        candidateRoot,
        roleExecutableName: ROLE_EXECUTABLE,
      }),
      /staged role executable is missing/,
    );
    assert.equal(fs.readFileSync(path.join(candidateRoot, ROLE_EXECUTABLE), 'utf8'), 'signed-current');

    const validStagingRoot = path.join(root, 'valid.staging');
    seed(validStagingRoot, 'signed-replacement', 'resource-replacement');
    fs.writeFileSync(path.join(validStagingRoot, 'new-resource.txt'), 'new-resource');
    publishPreparedElectronRuntime({
      stagingRoot: validStagingRoot,
      candidateRoot,
      roleExecutableName: ROLE_EXECUTABLE,
    });

    assert.equal(fs.readFileSync(path.join(candidateRoot, ROLE_EXECUTABLE), 'utf8'), 'signed-replacement');
    assert.equal(fs.readFileSync(path.join(candidateRoot, 'resources', 'app.txt'), 'utf8'), 'resource-current');
    assert.equal(fs.readFileSync(path.join(candidateRoot, 'new-resource.txt'), 'utf8'), 'new-resource');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function seed(root: string, executable: string, resource: string): void {
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, ROLE_EXECUTABLE), executable);
  fs.writeFileSync(path.join(root, 'resources', 'app.txt'), resource);
}
