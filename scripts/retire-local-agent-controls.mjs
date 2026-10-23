// One-time pre-release data cleanup. Never imported by the product.
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { retireLocalAgentTurnSidecars, retireDisabledFollowUpPreferences } from './lib/retire-local-agent-turn-sidecars.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Add --retire-turn-sidecars only for the known retired last/completed turn display projection. Canonical chat text, media and follow-up records stay unchanged; the full backup retains original metadata.');
  console.log('Add --retire-disabled-follow-up-preferences only for obsolete per-anchor OFF controls. Agent contact permission is not changed; active/unknown old preferences are refused.');
  console.log('Optional explicit retirement: --retire-redacted-intentions <ref,ref>. Only named unfinished historical Activity placeholders qualify; current frames still require review. No automatic eviction or Memory deletion.');
  console.log('One-time cut for the known pre-release life-frame control format.\nPreview: pnpm runtime:retire-local-agent-controls --db <absolute memory.db>\nApply after reviewing the listed objects: add --apply --confirm-runtime-stopped --backup <new absolute backup.db>\nAdd --include-historical-contact only to reclassify the retired origin metadata. Chat text, Memory and established history are preserved.\nThis tool does not initialize older databases that have no life-frame storage.');
  process.exit(0);
}
const option = name => { const i=args.indexOf(name); return i<0?null:args[i+1]; };
const requestedRedacted = new Set((option('--retire-redacted-intentions') ?? '').split(',').filter(Boolean));
const foundRedacted = new Set();
const file=option('--db'), apply=args.includes('--apply');
if (!file || !path.isAbsolute(file) || !existsSync(file)) throw new Error('An existing absolute --db path is required.');
const backup=option('--backup');
if (apply && (!args.includes('--confirm-runtime-stopped') || !backup || !path.isAbsolute(backup) || existsSync(backup))) throw new Error('Apply requires a stopped Runtime and a new absolute --backup file.');
const db=new DatabaseSync(file,{readOnly:!apply});
const changes=[];
for (const row of db.prepare('SELECT local_agent_ref,life_json FROM runtime_local_agent_life').all()) {
  const life=JSON.parse(row.life_json), original=JSON.stringify(life);
  const commitments=Object.values(life.commitments??{}).map(c=>({id:c.id,state:c.state}));
  const controlled=[];
  for (const activity of Object.values(life.activities??{})) {
    const retireRedacted = requestedRedacted.has(activity.ref);
    if (retireRedacted) {
      if (!activity.redactedNameKey || activity.title !== 'Activity' || ['completed','canceled'].includes(activity.phase)) throw new Error('Explicit redacted target is not an unfinished historical placeholder: '+activity.ref);
      foundRedacted.add(activity.ref);
    }
    if (activity.userPaused || activity.independentControlSource || retireRedacted) {
      controlled.push({id:activity.ref,title:activity.title,phase:activity.phase});
      if (!['completed','canceled'].includes(activity.phase)) activity.phase='canceled';
    }
    delete activity.userPaused;
    delete activity.independentControlSource;
    delete activity.independentTitle;
  }
  const retired=new Set(controlled.map(a=>a.id));
  const future=(life.future??[]).filter(f=>retired.has(f.activityRef)).map(f=>f.id);
  if (life.future) life.future=life.future.filter(f=>!retired.has(f.activityRef));
  const current=life.current && retired.has(life.current.activityRef)?life.current.id:null;
  if (current) life.current=null;
  if (life.intents) life.intents=life.intents.filter(i=>i.source!=='commitment'&&!retired.has(i.activityRef));
  for (const intent of life.intents??[]) { delete intent.commitmentId;delete intent.commitmentRevision;delete intent.occurrence; }
  delete life.commitments;
  if (JSON.stringify(life)!==original) changes.push({table:'runtime_local_agent_life',key:row.local_agent_ref,before:row.life_json,after:JSON.stringify(life),summary:{agent:row.local_agent_ref,commitments,controlledActivities:controlled,unoccurredFuture:future,current}});
}
for (const ref of requestedRedacted) if (!foundRedacted.has(ref)) throw new Error('Explicit redacted target was not found: '+ref);
for (const row of db.prepare('SELECT anchor_id,turn_id,recovery_json FROM runtime_conversation_recovery').all()) {
  const recovery=JSON.parse(row.recovery_json);
  if (!Object.hasOwn(recovery,'controlOutcome')) continue;
  delete recovery.controlOutcome;
  changes.push({table:'runtime_conversation_recovery',key:[row.anchor_id,row.turn_id],before:row.recovery_json,after:JSON.stringify(recovery),summary:{anchor:row.anchor_id,turn:row.turn_id,remove:'retired controlOutcome only'}});
}
if (args.includes('--include-historical-contact')) {
  for (const row of db.prepare('SELECT anchor_id,sequence,turn_json FROM runtime_conversation_turn').all()) {
    const turn=JSON.parse(row.turn_json);
    if (turn.origin!=='commitment') continue;
    turn.origin='contact';
    changes.push({table:'runtime_conversation_turn',key:[row.anchor_id,row.sequence],before:row.turn_json,after:JSON.stringify(turn),summary:{anchor:row.anchor_id,turn:turn.turnId,sequence:row.sequence,change:'retired commitment origin → historical Runtime contact; every message field preserved'}});
  }
}
if (args.includes('--retire-turn-sidecars') || args.includes('--retire-disabled-follow-up-preferences')) {
  for (const row of db.prepare('SELECT anchor_id,anchor_json FROM runtime_conversation_anchor WHERE anchor_json IS NOT NULL').all()) {
    const result = args.includes('--retire-turn-sidecars') ? retireLocalAgentTurnSidecars(row.anchor_json) : { removed: 0, after: row.anchor_json };
    const preferences = args.includes('--retire-disabled-follow-up-preferences') ? retireDisabledFollowUpPreferences(result.after) : { removed: false, after: result.after };
    if (result.removed || preferences.removed) changes.push({ table: 'runtime_conversation_anchor', key: row.anchor_id, before: row.anchor_json, after: preferences.after, summary: { anchor: row.anchor_id, retiredTurnSidecars: result.removed, retiredDisabledFollowUpPreference: preferences.removed } });
  }
}
console.log(JSON.stringify({database:file,mode:apply?'apply':'read-only',changes:changes.map(c=>c.summary),preserved:'Agent identity, established history, Conversation text and Memory/provenance'},null,2));
if (apply && changes.length) {
  if (changes.some(change => change.summary.current)) throw new Error('A retired activity still owns a current frame. Review its established interval before applying this cut.');
  closeSync(openSync(backup, 'wx', 0o600));
  db.prepare('VACUUM INTO ?').run(backup);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const change of changes) {
      const result=change.table==='runtime_local_agent_life'
        ? db.prepare('UPDATE runtime_local_agent_life SET life_json=? WHERE local_agent_ref=? AND life_json=?').run(change.after,change.key,change.before)
        : change.table==='runtime_conversation_turn'
          ? db.prepare('UPDATE runtime_conversation_turn SET turn_json=? WHERE anchor_id=? AND sequence=? AND turn_json=?').run(change.after,...change.key,change.before)
          : change.table==='runtime_conversation_anchor'
            ? db.prepare('UPDATE runtime_conversation_anchor SET anchor_json=? WHERE anchor_id=? AND anchor_json=?').run(change.after,change.key,change.before)
            : db.prepare('UPDATE runtime_conversation_recovery SET recovery_json=? WHERE anchor_id=? AND turn_id=? AND recovery_json=?').run(change.after,...change.key,change.before);
      if (result.changes!==1) throw new Error('The reviewed object changed; no cleanup committed.');
    }
    db.exec('COMMIT');console.log('Cleanup committed; full database backup: '+backup);
  } catch(error) { db.exec('ROLLBACK');throw error; }
}
db.close();
