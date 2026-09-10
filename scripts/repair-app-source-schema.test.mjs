import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { repairAppSourceSchema } from './repair-app-source-schema.mjs';

function oldDatabase(t, { legacyShellKind = false, sourceCurrent = false } = {}) {
  const tempRoot = path.resolve(os.tmpdir());
  const root = mkdtempSync(path.join(tempRoot, 'nimi-app-source-repair-'));
  assert.equal(path.dirname(root), tempRoot);
  assert.ok(path.basename(root).startsWith('nimi-app-source-repair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'local-app-kernel.db');
  const db = new DatabaseSync(dbPath);
  const registrationSource = readFileSync(new URL('../runtime/internal/localappkernel/sqlite.go', import.meta.url), 'utf8');
  const packageSource = readFileSync(new URL('../runtime/internal/localappkernel/package_lifecycle.go', import.meta.url), 'utf8');
  const registration = registrationSource.match(/const canonicalRegistrationCreateStatement = `([^`]+)`/)[1];
  const bindingStatements = registrationSource.match(/statements := \[\]string\{([\s\S]*?)\n\t\}/)[1];
  const packageStatements = packageSource.match(/var packageLifecycleSchemaStatements = \[\]string\{([\s\S]*?)\n\}/)[1];
  const oldSchema = (sql) => {
    const withoutQueue = sql.includes('CREATE TABLE IF NOT EXISTS app_package_job') ? sql
    .replace(/^\s*(queue_order|display_name|target_version|target_os|target_arch|previous_release_json|updated_unix_nano) [^\n]+\n/gm, '')
    .replaceAll("'downloading','paused','reading-local'", "'downloading','reading-local'")
    .replace(/^\s*OR \(phase = 'paused'[^\n]+\n/gm, '')
    .replaceAll("'paused','completed','failed','canceled'", "'completed','failed','canceled'") : sql;
    if (sourceCurrent) return withoutQueue;
    return withoutQueue
    .replaceAll("'verified','user_imported','local_development'", "'verified','local_development'")
    .replaceAll("source_class IN ('verified','user_imported') AND shell_kind", "source_class = 'verified' AND shell_kind")
    .replaceAll("'verified','user_imported'", "'verified'")
    .replaceAll("'downloading','reading-local','verifying'", "'downloading','verifying'");
  };
  const registrationSchema = legacyShellKind
    ? registration.replace('shell_kind INTEGER NOT NULL,', 'shell_kind INTEGER NOT NULL CHECK(shell_kind > 0),')
      .replace("\tCHECK((source_class IN ('verified','user_imported') AND shell_kind = 0) OR (source_class = 'local_development' AND shell_kind > 0)),\n", '')
    : oldSchema(registration);
  db.exec(registrationSchema);
  for (const match of `${bindingStatements}\n${packageStatements}`.matchAll(/`([^`]+)`/g)) db.exec(oldSchema(match[1]));
  db.exec(`
    INSERT INTO canonical_registration VALUES ('registration-1','subject-1','example.app','App','verified','release-1',${legacyShellKind ? 1 : 0},'{}','[]',1,2,'lineage-1','["proof-1"]',1,'profile-1','declaration-1','active',1788550546276172100,1788550546276172101,NULL);
    INSERT INTO current_host_binding VALUES ('host-1','os-user-1','registration-1','','root','manifest','host-digest','payload-digest',1,2);
    INSERT INTO app_package_job VALUES ('job-1','example.app','verified','install','target-1','completed','bytes',100,100,1,1,1,2,'installed','',0);
    INSERT INTO committed_app_release VALUES ('example.app','verified','1.0.0','release-1','registration-1','lineage-1','["proof-1"]',1,'profile-1','host-digest','payload-digest',2);
  `);
  db.close();
  return dbPath;
}

function snapshot(db) {
  return Object.fromEntries(['canonical_registration', 'current_host_binding', 'app_package_job', 'committed_app_release']
    .map((table) => {
      const statement = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`);
      statement.setReadBigInts(true);
      return [table, statement.all().map((row) => {
        if (table !== 'app_package_job') return row;
        return Object.fromEntries(Object.entries(row).filter(([key]) => !['queue_order', 'display_name', 'target_version', 'target_os', 'target_arch', 'previous_release_json', 'updated_unix_nano'].includes(key)));
      })];
    }));
}

test('explicit App source repair preserves real schema rows, owner bindings, triggers and backup', async (t) => {
  const dbPath = oldDatabase(t);
  const before = new DatabaseSync(dbPath, { readOnly: true });
  const records = snapshot(before);
  const schema = before.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const triggerNames = before.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
  before.close();

  const preview = await repairAppSourceSchema(dbPath);
  assert.equal(preview.applied, false);
  assert.equal(preview.tables.length, 3);
  const unchanged = new DatabaseSync(dbPath, { readOnly: true });
  assert.deepEqual(unchanged.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all(), schema);
  unchanged.close();

  const applied = await repairAppSourceSchema(dbPath, { apply: true });
  assert.equal(applied.applied, true);
  const saved = new DatabaseSync(applied.backupPath, { readOnly: true });
  assert.deepEqual(snapshot(saved), records);
  assert.deepEqual(saved.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all(), schema);
  saved.close();

  const repaired = new DatabaseSync(dbPath);
  assert.deepEqual(snapshot(repaired), records);
  assert.deepEqual({ ...repaired.prepare('SELECT queue_order, target_version, previous_release_json, updated_unix_nano FROM app_package_job').get() },
    { queue_order: 0, target_version: '', previous_release_json: '', updated_unix_nano: 1 });
  assert.deepEqual(repaired.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(), triggerNames);
  assert.deepEqual(repaired.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => repaired.exec("DELETE FROM canonical_registration WHERE registration_handle = 'registration-1'"), /permanently retained/);
  assert.throws(() => repaired.exec("UPDATE canonical_registration SET registered_app_subject = 'other'"), /immutable/);
  repaired.exec("INSERT INTO canonical_registration SELECT 'registration-import','subject-import',app_id,display_name,'user_imported','local-artifact',shell_kind,raw_declaration_json,activated_domains_json,source_generation,declaration_generation,immutable_lineage_id,provenance_attestation_refs_json,provenance_revision,execution_profile_ref,declaration_digest,state,created_unix_nano,updated_unix_nano,tombstoned_unix_nano FROM canonical_registration WHERE registration_handle = 'registration-1'");
  repaired.exec("INSERT INTO app_package_job SELECT 'job-import',app_id,'user_imported',kind,'local-target','reading-local',progress_basis,bytes_completed,bytes_total,steps_completed,steps_total,started_unix_nano,NULL,'','',1,0,'','','','','',started_unix_nano FROM app_package_job WHERE job_id = 'job-1'");
  repaired.exec("INSERT INTO committed_app_release SELECT app_id,'user_imported',version,release_ref,'registration-import',immutable_lineage_id,provenance_attestation_refs_json,provenance_revision,execution_profile_ref,host_executable_digest,payload_root_digest,committed_unix_nano FROM committed_app_release WHERE source_class = 'verified'");
  repaired.close();
  const repeat = await repairAppSourceSchema(dbPath, { apply: true });
  assert.deepEqual(repeat, { tables: [], applied: false, backupPath: null });
});

test('App source repair rolls back every table when a later rebuild fails', async (t) => {
  const dbPath = oldDatabase(t);
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE app_package_job_source_cutover (existing TEXT)');
  const records = snapshot(db);
  const schema = db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
  db.close();
  await assert.rejects(repairAppSourceSchema(dbPath, { apply: true }), /already exists/);
  const reopened = new DatabaseSync(dbPath, { readOnly: true });
  assert.deepEqual(snapshot(reopened), records);
  assert.deepEqual(reopened.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(), schema);
  reopened.close();
});

test('App source repair never overwrites an existing backup', async (t) => {
  const dbPath = oldDatabase(t);
  await assert.rejects(repairAppSourceSchema(dbPath, { apply: true, backupPath: dbPath }), /EEXIST/);
  const preview = await repairAppSourceSchema(dbPath);
  assert.equal(preview.tables.length, 3);
});

test('legacy installed shell repair preserves subjects and bindings while retaining development shell kinds', async (t) => {
  const dbPath = oldDatabase(t, { legacyShellKind: true });
  const db = new DatabaseSync(dbPath);
  for (const source of ['local_development', 'user_imported']) {
    db.exec(`INSERT INTO canonical_registration SELECT '${source}', '${source}', app_id, display_name, '${source}', source_ref, 1, raw_declaration_json, activated_domains_json, source_generation, declaration_generation, immutable_lineage_id, provenance_attestation_refs_json, provenance_revision, execution_profile_ref, declaration_digest, state, created_unix_nano, updated_unix_nano, tombstoned_unix_nano FROM canonical_registration WHERE registration_handle = 'registration-1'`);
  }
  const before = snapshot(db);
  db.close();
  await repairAppSourceSchema(dbPath);
  const applied = await repairAppSourceSchema(dbPath, { apply: true });
  const backupDb = new DatabaseSync(applied.backupPath, { readOnly: true });
  assert.deepEqual(snapshot(backupDb), before);
  backupDb.close();
  const repaired = new DatabaseSync(dbPath);
  const expected = before;
  for (const row of expected.canonical_registration) {
    if (row.source_class !== 'local_development') row.shell_kind = 0n;
  }
  assert.deepEqual(snapshot(repaired), expected);
  assert.deepEqual(repaired.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => repaired.exec("UPDATE canonical_registration SET shell_kind = 1 WHERE source_class = 'verified'"), /CHECK constraint/);
  assert.throws(() => repaired.exec("UPDATE canonical_registration SET shell_kind = 0 WHERE source_class = 'local_development'"), /CHECK constraint/);
  assert.throws(() => repaired.exec("UPDATE canonical_registration SET registered_app_subject = 'changed'"), /immutable/);
  repaired.close();
  assert.deepEqual(await repairAppSourceSchema(dbPath, { apply: true }), { tables: [], applied: false, backupPath: null });
});

test('current pre-queue schema changes only the job table and admits explicit paused reasons', async (t) => {
  const dbPath = oldDatabase(t, { sourceCurrent: true });
  const before = new DatabaseSync(dbPath, { readOnly: true });
  const records = snapshot(before);
  before.close();
  assert.deepEqual((await repairAppSourceSchema(dbPath)).tables, ['app_package_job']);
  await repairAppSourceSchema(dbPath, { apply: true });
  const db = new DatabaseSync(dbPath);
  assert.deepEqual(snapshot(db), records);
  assert.throws(() => db.exec("UPDATE app_package_job SET phase='paused', completed_unix_nano=NULL, terminal_result='', reason_code=''"), /CHECK constraint/);
  db.exec("UPDATE app_package_job SET phase='paused', completed_unix_nano=NULL, terminal_result='', reason_code='runtime-interrupted', cancelable=1");
  assert.equal(db.prepare('SELECT phase FROM app_package_job').get().phase, 'paused');
  db.close();
});

test('queue cutover refuses active old jobs instead of guessing their recovery intent', async (t) => {
  const dbPath = oldDatabase(t, { sourceCurrent: true });
  const db = new DatabaseSync(dbPath);
  db.exec("UPDATE app_package_job SET phase='downloading', completed_unix_nano=NULL, terminal_result='', reason_code='', cancelable=1");
  const before = snapshot(db);
  db.close();
  await assert.rejects(repairAppSourceSchema(dbPath), /Finish or cancel active App package jobs/);
  await assert.rejects(repairAppSourceSchema(dbPath, { apply: true }), /Finish or cancel active App package jobs/);
  const after = new DatabaseSync(dbPath, { readOnly: true });
  assert.deepEqual(snapshot(after), before);
  assert.equal(after.prepare('PRAGMA table_info(app_package_job)').all().some(({ name }) => name === 'queue_order'), false);
  after.close();
});
