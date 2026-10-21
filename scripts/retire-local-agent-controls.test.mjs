import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const testRoot=fileURLToPath(new URL('../.nimi/local/retire-local-agent-controls-tests/',import.meta.url));
mkdirSync(testRoot,{recursive:true});

test('redacted retirement requires exact eligible refs and preserves other intentions and history',()=>{
  const root=mkdtempSync(path.join(testRoot,'redacted-test-'));
  const file=path.join(root,'source.db'),backup=path.join(root,'backup.db');
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE runtime_local_agent_life(local_agent_ref TEXT,life_json TEXT);CREATE TABLE runtime_conversation_recovery(anchor_id TEXT,turn_id TEXT,recovery_json TEXT);');
  const recent=[{id:'established',activityRef:'old',title:'Established past'}];
  db.prepare('INSERT INTO runtime_local_agent_life VALUES(?,?)').run('agent',JSON.stringify({activities:{old:{ref:'old',title:'Activity',phase:'paused',redactedNameKey:'redacted-old'},other:{ref:'other',title:'Activity',phase:'paused',redactedNameKey:'redacted-other'},own:{ref:'own',title:'Own intention',phase:'paused'}},recent,future:[],intents:[]}));
  db.close();
  const tool=fileURLToPath(new URL('./retire-local-agent-controls.mjs',import.meta.url));
  assert.equal(JSON.parse(execFileSync(process.execPath,[tool,'--db',file],{encoding:'utf8'})).changes.length,0);
  const invalid=spawnSync(process.execPath,[tool,'--db',file,'--retire-redacted-intentions','own'],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  const preview=JSON.parse(execFileSync(process.execPath,[tool,'--db',file,'--retire-redacted-intentions','old'],{encoding:'utf8'}));
  assert.deepEqual(preview.changes[0].controlledActivities.map(a=>a.id),['old']);
  execFileSync(process.execPath,[tool,'--db',file,'--retire-redacted-intentions','old','--apply','--confirm-runtime-stopped','--backup',backup]);
  const after=new DatabaseSync(file,{readOnly:true});
  const life=JSON.parse(after.prepare('SELECT life_json FROM runtime_local_agent_life').get().life_json);
  assert.equal(life.activities.old.phase,'canceled');
  assert.equal(life.activities.other.phase,'paused');assert.equal(life.activities.own.phase,'paused');
  assert.deepEqual(life.recent,recent);after.close();
});

test('one-time cut preserves transcript, Memory, established frames and unrelated future',()=>{
  const root=mkdtempSync(path.join(testRoot,'cleanup-test-'));
  const file=path.join(root,'source.db'),backup=path.join(root,'backup.db');
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE runtime_local_agent_life(local_agent_ref TEXT PRIMARY KEY,life_json TEXT);CREATE TABLE runtime_conversation_recovery(anchor_id TEXT,turn_id TEXT,recovery_json TEXT);CREATE TABLE memories(content TEXT);CREATE TABLE runtime_conversation_turn(turn_json TEXT);');
  const past={id:'past',activityRef:'old',title:'Known past'};
  db.prepare('INSERT INTO runtime_local_agent_life VALUES(?,?)').run('agent',JSON.stringify({revision:1,activities:{old:{ref:'old',title:'Old controlled work',phase:'paused',userPaused:true},own:{ref:'own',title:'Own direction',phase:'planned'}},recent:[past],future:[{id:'old-future',activityRef:'old'},{id:'own-future',activityRef:'own'}],commitments:{c:{id:'c'}},intents:[{source:'commitment'},{source:'contact',id:'contact'}]}));
  db.prepare('INSERT INTO runtime_conversation_recovery VALUES(?,?,?)').run('anchor','turn',JSON.stringify({input:{text:'User input'},controlOutcome:{committed:true}}));
  db.exec("INSERT INTO memories VALUES('Memory with agent_control provenance');INSERT INTO runtime_conversation_turn VALUES('Conversation text');");db.close();
  const tool=fileURLToPath(new URL('./retire-local-agent-controls.mjs',import.meta.url));
  const preview=JSON.parse(execFileSync(process.execPath,[tool,'--db',file],{encoding:'utf8'}));assert.equal(preview.changes.length,2);
  execFileSync(process.execPath,[tool,'--db',file,'--apply','--confirm-runtime-stopped','--backup',backup]);
  const after=new DatabaseSync(file,{readOnly:true}),saved=JSON.parse(after.prepare('SELECT life_json FROM runtime_local_agent_life').get().life_json);
  assert.deepEqual(saved.recent,[past]);assert.deepEqual(saved.future,[{id:'own-future',activityRef:'own'}]);assert.equal(saved.activities.old.phase,'canceled');assert.equal(saved.activities.own.phase,'planned');assert.equal(saved.commitments,undefined);assert.equal(saved.intents[0].id,'contact');
  assert.equal(after.prepare('SELECT content FROM memories').get().content,'Memory with agent_control provenance');assert.equal(after.prepare('SELECT turn_json FROM runtime_conversation_turn').get().turn_json,'Conversation text');after.close();
  const original=new DatabaseSync(backup,{readOnly:true});assert.ok(JSON.parse(original.prepare('SELECT life_json FROM runtime_local_agent_life').get().life_json).commitments.c);original.close();
  assert.equal(JSON.parse(execFileSync(process.execPath,[tool,'--db',file],{encoding:'utf8'})).changes.length,0);
});

test('historical contact normalization changes only the retired origin marker',()=>{
  const root=mkdtempSync(path.join(testRoot,'cleanup-origin-test-'));
  const file=path.join(root,'source.db'),backup=path.join(root,'backup.db'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE runtime_local_agent_life(local_agent_ref TEXT,life_json TEXT);CREATE TABLE runtime_conversation_recovery(anchor_id TEXT,turn_id TEXT,recovery_json TEXT);CREATE TABLE runtime_conversation_turn(anchor_id TEXT,sequence INTEGER,turn_json TEXT);');
  const turn={turnId:'already-sent',origin:'commitment',inputText:'Original instruction',assistantText:'Original message',committedAt:'2026-10-19T00:00:00Z'};
  db.prepare('INSERT INTO runtime_conversation_turn VALUES(?,?,?)').run('anchor',0,JSON.stringify(turn));db.close();
  execFileSync(process.execPath,[fileURLToPath(new URL('./retire-local-agent-controls.mjs',import.meta.url)),'--db',file,'--include-historical-contact','--apply','--confirm-runtime-stopped','--backup',backup]);
  const after=new DatabaseSync(file,{readOnly:true});assert.deepEqual(JSON.parse(after.prepare('SELECT turn_json FROM runtime_conversation_turn').get().turn_json),{...turn,origin:'contact'});after.close();
});

test('a current retired activity is reviewable but cannot be silently erased',()=>{
  const root=mkdtempSync(path.join(testRoot,'cleanup-current-test-'));
  const file=path.join(root,'source.db'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE runtime_local_agent_life(local_agent_ref TEXT,life_json TEXT);CREATE TABLE runtime_conversation_recovery(anchor_id TEXT,turn_id TEXT,recovery_json TEXT);');
  const original=JSON.stringify({activities:{old:{ref:'old',phase:'active',userPaused:true}},current:{id:'current',activityRef:'old',startsAt:'2026-10-19T00:00:00Z'}});
  db.prepare('INSERT INTO runtime_local_agent_life VALUES(?,?)').run('agent',original);db.close();
  const tool=fileURLToPath(new URL('./retire-local-agent-controls.mjs',import.meta.url));
  assert.equal(JSON.parse(execFileSync(process.execPath,[tool,'--db',file],{encoding:'utf8'})).changes[0].current,'current');
  const result=spawnSync(process.execPath,[tool,'--db',file,'--apply','--confirm-runtime-stopped','--backup',path.join(root,'backup.db')],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/still owns a current frame/);
  const after=new DatabaseSync(file,{readOnly:true});assert.equal(after.prepare('SELECT life_json FROM runtime_local_agent_life').get().life_json,original);after.close();
});
