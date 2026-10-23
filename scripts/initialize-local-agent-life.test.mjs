import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalAgentLife } from './lib/initialize-local-agent-life.mjs';

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-life-cut-'));
  const dbPath = path.join(dir, 'memory.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE runtime_local_agent(local_agent_ref TEXT PRIMARY KEY,agent_json TEXT NOT NULL); CREATE TABLE runtime_local_agent_life(local_agent_ref TEXT PRIMARY KEY,life_json TEXT NOT NULL); CREATE TABLE protected_history(id TEXT PRIMARY KEY,raw BLOB);');
  for (const ref of ['agent-a', 'agent-b']) db.prepare('INSERT INTO runtime_local_agent VALUES(?,?)').run(ref, JSON.stringify({ localAgentRef: ref, ownerUserId: 'owner', runtimeSourceRef: 'source-' + ref, avatarUrl: 'https://example.invalid/retained.png', autonomy: { config: { mode: 'AGENT_AUTONOMY_MODE_OFF' }, revision: '1' } }));
  db.prepare('INSERT INTO protected_history VALUES(?,?)').run('chat-memory-source', Buffer.from([0, 255, 12, 9]));
  const protectedRows = () => ({ agents: db.prepare('SELECT * FROM runtime_local_agent ORDER BY local_agent_ref').all(), history: db.prepare('SELECT * FROM protected_history').all() });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dbPath, backupPath: path.join(dir, 'before.db'), protectedRows };
}

test('preview is read-only; explicit apply backs up and only inserts empty life; repetition is a no-op', t => {
  const f = fixture(t);
  f.db.prepare('UPDATE runtime_local_agent SET agent_json=json_set(agent_json,\'$.autonomy.revision\',\'25\',\'$.autonomy.usedTokensInWindow\',\'123\') WHERE local_agent_ref=?').run('agent-b');
  const before = f.protectedRows();
  const plan = initializeLocalAgentLife({ dbPath: f.dbPath });
  assert.equal(plan.status, 'planned');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM runtime_local_agent_life').get().n, 0);
  const result = initializeLocalAgentLife({ ...f, apply: true, runtimeStopped: true, expectedInputHash: plan.inputHash });
  assert.equal(result.insertedRows, 2);
  assert.deepEqual(f.protectedRows(), before);
  for (const row of f.db.prepare('SELECT life_json FROM runtime_local_agent_life').all()) assert.deepEqual(JSON.parse(row.life_json), { revision: 1 });
  const backup = new DatabaseSync(f.backupPath, { readOnly: true });
  assert.equal(backup.prepare('SELECT count(*) AS n FROM runtime_local_agent_life').get().n, 0);
  assert.deepEqual(backup.prepare('SELECT * FROM protected_history').all(), before.history);
  backup.close();
  const next = initializeLocalAgentLife({ dbPath: f.dbPath });
  assert.equal(initializeLocalAgentLife({ dbPath: f.dbPath, apply: true, runtimeStopped: true, expectedInputHash: next.inputHash, backupPath: f.backupPath + '.unused' }).status, 'unchanged');
  assert.equal(existsSync(f.backupPath + '.unused'), false);
});

test('stale preflight, partial coverage and active autonomy are rejected without overwriting history', t => {
  const f = fixture(t), plan = initializeLocalAgentLife({ dbPath: f.dbPath });
  f.db.prepare('UPDATE runtime_local_agent SET agent_json=json_set(agent_json,\'$.avatarUrl\',\'retained-new-avatar\') WHERE local_agent_ref=?').run('agent-a');
  assert.throws(() => initializeLocalAgentLife({ ...f, apply: true, runtimeStopped: true, expectedInputHash: plan.inputHash }), /changed since preflight/);
  assert.equal(existsSync(f.backupPath), false);
  f.db.prepare('INSERT INTO runtime_local_agent_life VALUES(?,?)').run('agent-a', '{"revision":9,"current":{"title":"existing history"}}');
  assert.throws(() => initializeLocalAgentLife({ dbPath: f.dbPath }), /Partial/);
  f.db.exec('DELETE FROM runtime_local_agent_life');
  f.db.prepare('UPDATE runtime_local_agent SET agent_json=json_set(agent_json,\'$.autonomy.config.mode\',\'AGENT_AUTONOMY_MODE_ON\') WHERE local_agent_ref=?').run('agent-a');
  assert.throws(() => initializeLocalAgentLife({ dbPath: f.dbPath }), /default-off/);
  f.db.prepare('UPDATE runtime_local_agent SET agent_json=json_set(agent_json,\'$.autonomy.config.mode\',\'AGENT_AUTONOMY_MODE_OFF\',\'$.ownerUserId\',7) WHERE local_agent_ref=?').run('agent-a');
  assert.throws(() => initializeLocalAgentLife({ dbPath: f.dbPath }), /Invalid existing Agent identity/);
});
