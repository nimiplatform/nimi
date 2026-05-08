import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { migrateRuntimeLocalState } from '../lib/runtime-local-state-migrate.mjs';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL('../migrate-runtime-local-state-v1-to-v2.mjs', import.meta.url));

function v1Snapshot() {
  return {
    schemaVersion: 1,
    savedAt: '2026-05-07T00:00:00.000Z',
    models: [
      {
        localModelId: 'local-model-1',
        modelId: 'model-1',
        capabilities: ['voice_workflow.voice_design'],
      },
    ],
    artifacts: [],
    services: [],
    transfers: [],
    audits: [],
  };
}

async function writeSnapshot(dir, snapshot = v1Snapshot()) {
  const statePath = path.join(dir, 'local-state.json');
  await fs.writeFile(statePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return statePath;
}

test('runtime local-state migration defaults to dry-run without mutating state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-local-state-migrate-'));
  const statePath = await writeSnapshot(dir);
  const before = await fs.readFile(statePath, 'utf8');

  const result = await migrateRuntimeLocalState({ targetPath: statePath });

  assert.equal(result.migrated, true);
  assert.equal(result.write, false);
  assert.equal(result.backupPath, null);
  assert.equal(result.snapshot.schemaVersion, 2);
  assert.equal(await fs.readFile(statePath, 'utf8'), before);
  await assert.rejects(fs.stat(`${statePath}.v1.bak`));
});

test('runtime local-state migration refuses writes without consent attribution', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-local-state-migrate-'));
  const statePath = await writeSnapshot(dir);
  const before = await fs.readFile(statePath, 'utf8');

  await assert.rejects(
    migrateRuntimeLocalState({ targetPath: statePath, write: true }),
    /writes require --consent-ref/,
  );
  assert.equal(await fs.readFile(statePath, 'utf8'), before);
  await assert.rejects(fs.stat(`${statePath}.v1.bak`));
});

test('runtime local-state migration writes only with consent attribution', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-local-state-migrate-'));
  const statePath = await writeSnapshot(dir);

  const result = await migrateRuntimeLocalState({
    targetPath: statePath,
    write: true,
    consentRef: 'topic-wave-platform-local-state-migration-consent-gate',
  });
  const migrated = JSON.parse(await fs.readFile(statePath, 'utf8'));

  assert.equal(result.migrated, true);
  assert.equal(result.write, true);
  assert.equal(result.consentRef, 'topic-wave-platform-local-state-migration-consent-gate');
  assert.equal(result.backupPath, `${statePath}.v1.bak`);
  assert.equal(migrated.schemaVersion, 2);
  await assert.doesNotReject(fs.stat(`${statePath}.v1.bak`));
});

test('migration CLI dry-run flag does not use the flag as a target path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-local-state-migrate-'));
  const statePath = await writeSnapshot(dir);
  const before = await fs.readFile(statePath, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--dry-run', statePath]);

  assert.match(stdout, /dry run: local runtime state would migrate to schemaVersion=2:/);
  assert.equal(await fs.readFile(statePath, 'utf8'), before);
  await assert.rejects(fs.stat(`${statePath}.v1.bak`));
});

test('migration CLI refuses --write without consent attribution', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-local-state-migrate-'));
  const statePath = await writeSnapshot(dir);
  const before = await fs.readFile(statePath, 'utf8');

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, '--write', statePath]),
    /writes require --consent-ref/,
  );
  assert.equal(await fs.readFile(statePath, 'utf8'), before);
  await assert.rejects(fs.stat(`${statePath}.v1.bak`));
});
