// Explicit pre-release maintenance only. Never imported by Runtime startup.
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, lstatSync, openSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// The current Runtime decoder starts with newAgentLifeState(). No start time,
// frame, intention, interaction, or past experience is inferred by this cut.
const initialLife = JSON.stringify({ revision: 1 });

function inspect(db) {
  const agents = db.prepare('SELECT local_agent_ref,agent_json FROM runtime_local_agent ORDER BY local_agent_ref').all();
  const life = db.prepare('SELECT local_agent_ref,life_json FROM runtime_local_agent_life ORDER BY local_agent_ref').all();
  const refs = new Set(agents.map(row => row.local_agent_ref));
  if (life.some(row => !refs.has(row.local_agent_ref))) throw new Error('Orphan life state requires separate review.');
  const present = new Set(life.map(row => row.local_agent_ref));
  const missing = agents.filter(row => !present.has(row.local_agent_ref));
  if (missing.length && life.length) throw new Error('Partial life-state coverage requires separate review; no rows changed.');
  for (const row of missing) {
    const agent = JSON.parse(row.agent_json);
    if (typeof row.local_agent_ref !== 'string' || !row.local_agent_ref.trim() ||
        agent.localAgentRef !== row.local_agent_ref ||
        typeof agent.ownerUserId !== 'string' || !agent.ownerUserId.trim() ||
        typeof agent.runtimeSourceRef !== 'string' || !agent.runtimeSourceRef.trim())
      throw new Error('Invalid existing Agent identity: ' + row.local_agent_ref);
    const revision = String(agent.autonomy?.revision ?? '');
    if (!/^[1-9][0-9]*$/.test(revision) || BigInt(revision) > 18446744073709551615n ||
        agent.autonomy.config?.mode !== 'AGENT_AUTONOMY_MODE_OFF' ||
        Object.keys(agent.autonomy.config).length !== 1)
      throw new Error('Expected the known pre-life, default-off autonomy format: ' + row.local_agent_ref);
  }
  return {
    agents: agents.length,
    existingLifeRows: life.length,
    initializeRefs: missing.map(row => row.local_agent_ref),
    inputHash: createHash('sha256').update(JSON.stringify({ agents, life })).digest('hex'),
  };
}

export function initializeLocalAgentLife({ dbPath, apply = false, runtimeStopped = false, backupPath, expectedInputHash }) {
  if (!dbPath || !path.isAbsolute(dbPath) || !existsSync(dbPath) || !lstatSync(dbPath).isFile() || lstatSync(dbPath).isSymbolicLink())
    throw new Error('An existing absolute regular --db file is required.');
  if (apply && (!runtimeStopped || !backupPath || !path.isAbsolute(backupPath) || existsSync(backupPath) || !expectedInputHash))
    throw new Error('Apply requires --confirm-runtime-stopped, a new absolute --backup file, and the reviewed --expected-input-hash.');
  const db = new DatabaseSync(dbPath, { readOnly: !apply });
  try {
    const plan = inspect(db);
    if (expectedInputHash && plan.inputHash !== expectedInputHash) throw new Error('Database changed since preflight; no rows changed.');
    if (!apply || !plan.initializeRefs.length) return { status: apply ? 'unchanged' : 'planned', ...plan, applied: false };
    // Reserve a private empty file atomically; VACUUM INTO accepts an empty file.
    closeSync(openSync(backupPath, 'wx', 0o600));
    db.prepare('VACUUM INTO ?').run(backupPath);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (inspect(db).inputHash !== plan.inputHash) throw new Error('Database changed after backup; no rows changed.');
      const insert = db.prepare('INSERT INTO runtime_local_agent_life(local_agent_ref,life_json) VALUES(?,?)');
      for (const ref of plan.initializeRefs) insert.run(ref, initialLife);
      if (inspect(db).initializeRefs.length) throw new Error('Life-state coverage verification failed.');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { status: 'applied', ...plan, applied: true, insertedRows: plan.initializeRefs.length, backupPath };
  } finally {
    db.close();
  }
}
