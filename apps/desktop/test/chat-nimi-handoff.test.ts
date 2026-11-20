import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatAiMessageRecord, ChatAiThreadBundle } from '../src/shell/shared/chat-ai-store-types.js';
import { homeChatHandoff } from '../src/shell/shared/chat-ai-handoff.js';

const thread = { id: 'source', title: 'Schedule', createdAtMs: 1, updatedAtMs: 2, lastMessageAtMs: 2 };
function message(id: string, role: 'user' | 'assistant', text: string): ChatAiMessageRecord {
  return { id, threadId: thread.id, role, status: 'complete', contentText: text,
    content: { parts: [{type:'text', text}], attachments: [], toolCalls: [], metadata: {} },
    parentMessageId: role === 'assistant' ? 'first' : null, traceId: null, error: null, createdAtMs: 1, updatedAtMs: 2 };
}
const first = message('first', 'user', 'Departure?');
const reply = message('second', 'assistant', 'Friday at 17:10.');
const bundle: ChatAiThreadBundle = {thread, messages:[first, reply], draft:{threadId:thread.id, text:'Old draft', attachments:[], updatedAtMs:1}};

test('export uses the selected ordered dialogue and current unsent text', () => {
  assert.deepEqual(homeChatHandoff(bundle, 'New draft'), {format:'nimi.home-chat.v1', threadId:'source', title:'Schedule',
    messages:[{role:'user',text:'Departure?'},{role:'assistant',text:'Friday at 17:10.'}], draft:'New draft'});
  assert.equal(homeChatHandoff(bundle, '')?.draft, '');
  assert.equal(bundle.draft?.text, 'Old draft');
});

test('export refuses an incomplete or non-text thread instead of dropping its contents', () => {
  assert.equal(homeChatHandoff({...bundle, messages:[first, {...reply,status:'streaming'}]}, ''), null);
  const attachment = { attachmentId:'file', name:'note', mimeType:'text/plain', sizeBytes:1 };
  assert.equal(homeChatHandoff({...bundle, draft:{threadId:'source', text:'', attachments:[attachment], updatedAtMs:2}}, ''), null);
});
