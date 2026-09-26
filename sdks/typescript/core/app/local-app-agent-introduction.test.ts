import test from 'node:test';
import assert from 'node:assert/strict';
import { createNimiLocalAppAgentIntroductionClient, createNimiLocalAppAgentIntroductionRuntimeClient } from './local-app-agent-introduction.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

const agentHandle = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const value = { worldName: '清代', era: 'qing', role: '学者', greeting: '你好', referenceImageUrl: 'https://cdn.example.test/full.png', voiceSampleUrl: null, voiceSampleDurationSec: null, questionTopics: [{kind: 'work', text: '潜研堂集'}] };

test('Agent introduction uses the exact handle and preserves optional display facts', async () => {
 const client = createNimiLocalAppAgentIntroductionClient({ getIntroduction: async input => { assert.deepEqual(input, {agentHandle}); return value; } });
 assert.deepEqual(await client.getIntroduction({agentHandle}), value);
 await assert.rejects(() => client.getIntroduction({agentHandle, sourceRef:'private'} as never));
 await assert.rejects(() => client.getIntroduction({agentHandle:'raw-local-agent' as NimiLocalAppAgentHandle}));
});

test('Agent introduction rejects identity leakage, unsafe media and invalid topics or duration', async () => {
 for (const invalid of [ {...value, worldId:'private'}, {...value, referenceImageUrl:'https://cdn.example.test/full?token=secret'}, {...value, voiceSampleUrl:'file:///private/audio'}, {...value, voiceSampleDurationSec:3}, {...value, greeting:'x'.repeat(4097)}, {...value, questionTopics:[{kind:'prompt',text:'private'}]}, {...value, questionTopics:[{kind:'topic',text:'ok', sourceId:'private'}]} ]) {
  const client = createNimiLocalAppAgentIntroductionClient({getIntroduction: async () => invalid});
  await assert.rejects(() => client.getIntroduction({agentHandle}));
 }
});

test('Runtime introduction adapter maps only the closed display response', async () => {
 const client = createNimiLocalAppAgentIntroductionRuntimeClient({getLocalAppAgentIntroduction: async input => {
  assert.deepEqual(input,{agentHandle});
  return {introduction: {worldName:'World', questionTopics:[{kind:2,text:'Collected works'}]}};
 }});
 const result = await client.getIntroduction({agentHandle});
 assert.equal(result.greeting,null);
 assert.deepEqual(result.questionTopics,[{kind:'work',text:'Collected works'}]);
});

test('Introduction rejects coerced topic kinds and browser-normalized unsafe media', async () => {
 for (const kind of [['role'], {kind:'role'}, 1, true]) {
  const client=createNimiLocalAppAgentIntroductionClient({getIntroduction:async()=>({...value,questionTopics:[{kind,text:'Scholar'}]})});
  await assert.rejects(()=>client.getIntroduction({agentHandle}));
 }
 for (const url of ['https://localhost./image.png','https://private.internal./audio.mp3','https://127.1/image.png','https://2130706433/image.png','https://0x7f000001/image.png','https://127。0。0。1/image.png','https://cdn.example.test/im\nage.png','https://cdn.example.test/im\u0085age.png',`https://cdn.example.test/${'汉'.repeat(900)}`]) {
  for (const field of ['referenceImageUrl','voiceSampleUrl']) {
   const client=createNimiLocalAppAgentIntroductionClient({getIntroduction:async()=>({...value,[field]:url})});
   await assert.rejects(()=>client.getIntroduction({agentHandle}));
  }
 }
});
