import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiLocalAppConversationClient,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';
import {
  createCanonicalConversationMediaReader,
  materializeCanonicalConversationBundle,
  reduceCanonicalConversationEvent,
  seedCanonicalConversationProjection,
} from '../src/shell/renderer/features/chat/chat-agent-canonical-conversation-projection.js';
import type { AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { toConversationMessageViewModel } from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import { resolveAgentRefusedInput } from '../src/shell/renderer/features/chat/chat-agent-shell-presentation-status.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function snapshot(): NimiLocalAppConversationSnapshot {
  return {
    conversationAnchorId: 'anchor-1',
    state:{followUpEnabled:false,followUpPolicyRevision:'0',maxFollowUpTurns:8,pendingFollowUp:null,textTurnId:null},
    throughSequence: '4',
    truncatedBefore: true,
    turns: [{
      turnId: 'turn-1', origin:'user', requestId: null, retryOfTurnId: null, inputTurnId: null, canRegenerate: false, status: 'active', phase: 'started',
      terminalReason: null, reasonCode: null, message: null,
    }],
    messages: [{
      partial: false, messageId: 'message-user-1', turnId: 'turn-1', role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    }],
    actions: [{
      actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate',
      status: 'started', projectionMessageId: 'message-image-1', artifactId: null,
      reasonCode: null, message: null,
    }],
    voices: [{
      voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-voice-1',
      state: 'failed', artifactId: null, reasonCode: 'AI_ROUTE_UNAVAILABLE',
      message: 'Voice is unavailable.',
    }],
  };
}

function thread(): AgentLocalThreadRecord {
  return {
    id: 'agent-thread:anchor-1',
    title: 'Agent',
    createdAtMs: 1,
    updatedAtMs: 1,
    lastMessageAtMs: null,
    targetSnapshot: {
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'anchor-1',
      displayName: 'Agent',
      handle: '',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };
}

test('canonical projection uses snapshot sequence as a monotonic barrier', () => {
  const seeded = seedCanonicalConversationProjection(snapshot());
  const stale = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '4',
    turnId: 'turn-1', delta: 'stale',
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.projection, seeded);

  const gap = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '6',
    turnId: 'turn-1', delta: 'gap',
  });
  assert.equal(gap.status, 'gap');
  assert.equal(gap.projection.throughSequence, '4');

  const applied = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '5',
    turnId: 'turn-1', delta: 'live',
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.projection.throughSequence, '5');
  assert.equal(applied.projection.transientByTurn['turn-1']?.text, 'live');
});

test('canonical projection keeps stable turn, action, voice, and message identities', () => {
  let projection = seedCanonicalConversationProjection(snapshot());
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'action-failed', conversationAnchorId: 'anchor-1', sequence: '5', turnId: 'turn-1',
    action: {
      actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate',
      status: 'failed', projectionMessageId: 'message-image-1', artifactId: null,
      reasonCode: 'AI_PROVIDER_TIMEOUT', message: 'Timed out.',
    },
  }).projection;
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'message-committed', conversationAnchorId: 'anchor-1', sequence: '6', turnId: 'turn-1',
    message: {
      partial: false, messageId: 'message-assistant-1', turnId: 'turn-1', role: 'assistant',
      parts: [{ kind: 'text', text: 'final' }],
    },
  }).projection;
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'turn-completed', conversationAnchorId: 'anchor-1', sequence: '7', turnId: 'turn-1',
    terminalReason: 'stop', reasonCode: null, message: null,
  }).projection;

  assert.equal(projection.turns.length, 1);
  assert.equal(projection.turns[0]?.status, 'completed');
  assert.equal(projection.actions.length, 1);
  assert.equal(projection.actions[0]?.status, 'failed');
  assert.equal(projection.voices.length, 1);
  assert.equal(projection.messages.map((message) => message.messageId).join(','), 'message-user-1,message-assistant-1');
});

test('canonical materialization preserves snapshot recovery metadata and typed child terminals', async () => {
  const conversation = {
    readArtifact: async () => { throw new Error('not used'); },
  } as unknown as NimiLocalAppConversationClient;
  const bundle = await materializeCanonicalConversationBundle({
    thread: thread(),
    projection: seedCanonicalConversationProjection(snapshot()),
    nowMs: 100,
  });

  assert.equal(bundle.canonicalConversation?.throughSequence, '4');
  assert.equal(bundle.canonicalConversation?.truncatedBefore, true);
  assert.equal(bundle.canonicalConversation?.turns.length, 1);
  assert.equal(bundle.canonicalConversation?.actions.length, 1);
  assert.equal(bundle.canonicalConversation?.voices.length, 1);
  assert.equal(bundle.messages.find((message) => message.id === 'message-image-1')?.status, 'pending');
  const voice = bundle.messages.find((message) => message.id === 'canonical-voice:voice-1');
  assert.equal(voice, undefined, 'voice sidecars never create a duplicate playback message');
  for (const message of bundle.messages.map(toConversationMessageViewModel)) {
    assert.equal(message.createdAt, '', 'snapshot observation time is not message creation time');
    assert.equal(message.updatedAt, undefined);
  }
});

test('a failed canonical image keeps Retry bound to its own plain user input', async () => {
  for (const source of ['user', 'app', 'another-turn', 'attachment', 'text-and-attachment'] as const) {
    const base = snapshot();
    const text = { kind: 'text', text: 'Original image prompt' } as const;
    const attachment = {
      kind: 'artifact-ref', artifactId: 'original-image', mediaKind: 'image', mimeType: 'image/png', displayName: null,
    } as const;
    const value: NimiLocalAppConversationSnapshot = {
      ...base,
      actions: [{ ...base.actions[0]!, status: 'failed', reasonCode: 'AI_PROVIDER_TIMEOUT', message: 'Timed out.' }],
      messages: [{
        ...base.messages[0]!,
        role: source === 'app' ? 'app' : 'user',
        turnId: source === 'another-turn' ? 'turn-elsewhere' : 'turn-1',
        parts: source === 'attachment' ? [attachment] : source === 'text-and-attachment' ? [text, attachment] : [text],
      }],
    };
    const bundle = await materializeCanonicalConversationBundle({
      thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 100,
    });
    const image = bundle.messages.find(message => message.id === 'message-image-1')!;
    assert.equal(image.status, 'error');
    assert.equal(image.metadataJson?.retryPrompt, source === 'user' ? 'Original image prompt' : undefined);
    assert.equal(image.metadataJson?.imageFailureReasonCode, 'AI_PROVIDER_TIMEOUT');
  }
});


test('App routine input is a source-labelled system row, never user or Agent speech', async () => {
  const bundle = await materializeCanonicalConversationBundle({
    thread: thread(), nowMs: 100,
    projection: seedCanonicalConversationProjection({ ...snapshot(), turns:[{...snapshot().turns[0]!,turnId:'routine-turn',origin:'app'}], actions: [], voices: [], messages: [{
      partial: false, messageId: 'app-input', turnId: 'routine-turn', role: 'app', parts: [{ kind: 'text', text: '[App: nimi.go · Routine: Brief]\nPrepare the brief' }],
    }] }),
  });
  assert.equal(bundle.messages[0]?.role, 'system');
  assert.equal(bundle.messages[0]?.metadataJson?.canonicalOrigin, 'app');
  const { resolveAgentCanonicalMessages } = await import('../src/shell/renderer/features/chat/chat-agent-shell-view-model.js');
  const projected = resolveAgentCanonicalMessages({ messages: bundle.messages.map(toConversationMessageViewModel), activeThreadId: null,
    activeConversationAnchorId: 'anchor-1', activeTargetId: null, character: { name: 'Agent', avatarUrl: 'https://example.com/avatar.png', handle: 'agent' } });
  assert.equal(projected[0]?.senderName, 'App');
  assert.equal(projected[0]?.senderKind, undefined);
  assert.equal(projected[0]?.senderAvatarUrl, undefined);
});

test('repeated model action IDs preserve both turns and their Retry prompts across hydration and live completion', async () => {
  const base = snapshot();
  const actions = ['turn-1', 'turn-2'].map(turnId => ({ ...base.actions[0]!, turnId, actionId: 'action-0',
    projectionMessageId: null, status: 'failed' as const, reasonCode: 'AI_CONTENT_FILTER_BLOCKED', message: 'Content check blocked the image.' }));
  const value: NimiLocalAppConversationSnapshot = { ...base, voices: [],
    turns: ['turn-1', 'turn-2'].map(turnId => ({ ...base.turns[0]!, turnId, status: 'completed' as const })),
    messages: ['turn-1', 'turn-2'].map(turnId => ({ ...base.messages[0]!, turnId, messageId: `user-${turnId}`, parts: [{ kind: 'text' as const, text: `Image for ${turnId}` }] })), actions };
  const conversation = { readArtifact: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }) } as unknown as NimiLocalAppConversationClient;
  const materialize = (projection: ReturnType<typeof seedCanonicalConversationProjection>) => materializeCanonicalConversationBundle({ thread: thread(), projection, nowMs: 100 });
  const hydrated = await materialize(seedCanonicalConversationProjection({ ...value, throughSequence: '5' }));
  let live = reduceCanonicalConversationEvent(seedCanonicalConversationProjection({ ...value, actions: actions.slice(0, 1) }), {
    type: 'action-failed', conversationAnchorId: 'anchor-1', sequence: '5', turnId: 'turn-2', action: actions[1]!,
  }).projection;
  assert.deepEqual(live.actions, actions);
  const images = (bundle: Awaited<ReturnType<typeof materialize>>) => bundle.messages.filter(message => message.kind === 'image');
  assert.equal(images(hydrated).length, 2);
  assert.notEqual(images(hydrated)[0]!.id, images(hydrated)[1]!.id);
  assert.deepEqual(images(await materialize(live)), images(hydrated));
  assert.deepEqual(images(hydrated).map(message => message.metadataJson?.retryPrompt), ['Image for turn-1', 'Image for turn-2']);
  live = reduceCanonicalConversationEvent(live, { type: 'artifact-ready', conversationAnchorId: 'anchor-1', sequence: '6', turnId: 'turn-2',
    actionId: 'action-0', capabilityContract: 'image.generate', projectionMessageId: 'image-turn-2', artifactId: 'artifact-turn-2' }).projection;
  assert.equal(live.actions[0]?.status, 'failed');
  assert.equal(live.actions[1]?.status, 'completed');
  assert.equal(live.actions[1]?.projectionMessageId, 'image-turn-2');
  assert.deepEqual(images(await materialize(live)).map(message => message.status), ['error', 'complete']);
  for (const [index, turnId] of ['turn-1', 'turn-2'].entries()) {
    live = reduceCanonicalConversationEvent(live, { type: 'live-action', conversationAnchorId: 'anchor-1', sequence: String(7 + index), turnId,
      action: { actionId: 'action-0', turnId, name: 'image.generate', lifecycle: 'started', progress: null, result: null, reasonCode: null } }).projection;
  }
  assert.equal(live.liveActions.length, 2);
});

test('refusal recovery binds the failed canonical turn rather than a later successful user message', async () => {
  const base = snapshot();
  const value: NimiLocalAppConversationSnapshot = { ...base, voices: [],
    turns: ['turn-1', 'turn-2'].map(turnId => ({ ...base.turns[0]!, turnId, status: 'completed' as const })),
    messages: [base.messages[0]!, { ...base.messages[0]!, messageId: 'later-user', turnId: 'turn-2', parts: [{ kind: 'text', text: 'Later successful request' }] },
      { ...base.messages[0]!, messageId: 'later-answer', turnId: 'turn-2', role: 'assistant', parts: [{ kind: 'text', text: 'Later successful answer' }] }],
    actions: [{ ...base.actions[0]!, status: 'failed', reasonCode: 'AI_CONTENT_FILTER_BLOCKED' }] };
  const bundle = await materializeCanonicalConversationBundle({
    thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 100 });
  assert.equal(resolveAgentRefusedInput(bundle.messages), null, 'an old media refusal does not replace a later successful exchange');
  const refusedMessages = bundle.messages.filter(message => message.metadataJson?.canonicalTurnId === 'turn-1');
  assert.equal(resolveAgentRefusedInput(refusedMessages), 'hello');
  assert.equal(resolveAgentRefusedInput(refusedMessages.filter(message => message.id !== base.messages[0]!.messageId)), null, 'a missing original input cannot fall back to another turn');
  assert.equal(resolveAgentRefusedInput(refusedMessages.map(message => message.id === base.messages[0]!.messageId ? { ...message, role: 'system' as const } : message)), null, 'App input cannot become a user draft');
  const latestUser = bundle.messages.find(message => message.id === 'later-user')!;
  assert.equal(resolveAgentRefusedInput([latestUser, { ...refusedMessages.at(-1)!, metadataJson: null }]), 'Later successful request', 'current optimistic failure keeps its immediate draft recovery');
});


test('pending and failed media reads never block text or repeat on every event', async () => {
  let finish: (value: { bytes: Uint8Array; mimeType: string }) => void = () => {};
  let calls = 0;
  let updates = 0;
  const pending = new Promise<{ bytes: Uint8Array; mimeType: string }>((resolve) => { finish = resolve; });
  const media = createCanonicalConversationMediaReader({
    conversation: { readArtifact: () => { calls++; return pending; } } as unknown as NimiLocalAppConversationClient,
    thread: thread(), conversationAnchorId: 'anchor-1', onChange: () => updates++,
  });
  const state = snapshot();
  const projection = seedCanonicalConversationProjection({ ...state, actions: [], voices: [], messages: [
    ...state.messages,
    { partial: false, messageId: 'old-image', turnId: 'old-turn', role: 'assistant', parts: [{ kind: 'artifact-ref', artifactId: 'old-artifact', mediaKind: 'image', mimeType: 'image/png', displayName: null }] },
  ] });
  const project = () => materializeCanonicalConversationBundle({ media, thread: thread(), projection, nowMs: 100 });
  const initial = project();
  assert.equal(initial.messages.find(message => message.id === state.messages[0]?.messageId)?.contentText, 'hello');
  assert.equal(initial.messages.find(message => message.id === 'old-image')?.mediaUrl, null);
  project();
  assert.equal(calls, 1);
  finish({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates, 1);
  assert.match(project().messages.find(message => message.id === 'old-image')?.mediaUrl || '', /^data:image\/png;base64,/);
  assert.equal(calls, 1);
  media.close();

  let failedCalls = 0;
  const failed = createCanonicalConversationMediaReader({
    conversation: { readArtifact: async () => { failedCalls++; throw new Error('unavailable'); } } as unknown as NimiLocalAppConversationClient,
    thread: thread(), conversationAnchorId: 'anchor-1', onChange: () => {},
  });
  failed.get('old-artifact');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failed.get('old-artifact'), { mediaUrl: null, mimeType: null });
  assert.equal(failedCalls, 1);
  failed.close();
});

test('retired media hydration cannot update the next account or target', async () => {
  let finish: (value: { bytes: Uint8Array; mimeType: string }) => void = () => {};
  const pending = new Promise<{ bytes: Uint8Array; mimeType: string }>((resolve) => { finish = resolve; });
  let updates = 0;
  const media = createCanonicalConversationMediaReader({
    conversation: { readArtifact: () => pending } as unknown as NimiLocalAppConversationClient,
    thread: thread(), conversationAnchorId: 'anchor-1', onChange: () => updates++,
  });
  media.get('old-artifact');
  media.close();
  finish({ bytes: new Uint8Array([1]), mimeType: 'image/png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates, 0);
  assert.deepEqual(media.get('old-artifact'), { mediaUrl: null, mimeType: null });
});


test('late media failures remain beside their original reply when newer text exists', () => {
  const source = snapshot();
  const value: NimiLocalAppConversationSnapshot = { ...source, messages: [...source.messages, {
    messageId: 'new-user', turnId: 'turn-2', role: 'user', partial: false, parts: [{ kind: 'text', text: 'new question' }],
  }], actions: source.actions.map(action => ({ ...action, status: 'failed', reasonCode: 'AI_PROVIDER_TIMEOUT' })) };
  const result = materializeCanonicalConversationBundle({ thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 1 });
  const oldImage = result.messages.findIndex(message => message.kind === 'image');
  const oldVoice = result.messages.findIndex(message => message.kind === 'voice');
  const newUser = result.messages.findIndex(message => message.id === 'new-user');
  assert.ok(oldImage > 0 && oldImage < newUser);
  assert.equal(oldVoice, -1);
});


test('empty failed attempts precede the successful regeneration of their original input', () => {
  const base = snapshot();
  const original = { ...base.turns[0]!, status: 'failed' as const, inputTurnId: 'turn-1', canRegenerate: false };
  const value: NimiLocalAppConversationSnapshot = {
    ...base, actions: [], voices: [],
    turns: [original, { ...original, turnId: 'turn-2', retryOfTurnId: 'turn-1' },
      { ...original, turnId: 'turn-3', retryOfTurnId: 'turn-2', status: 'completed' }],
    messages: [...base.messages, {
      messageId: 'successful-answer', turnId: 'turn-3', role: 'assistant', partial: false,
      parts: [{ kind: 'text', text: 'The original picture is blue and green.' }],
    }],
  };
  const bundle = materializeCanonicalConversationBundle({ thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 1 });
  assert.deepEqual(bundle.messages.map(message => message.id), ['message-user-1', 'canonical-turn:turn-1', 'canonical-turn:turn-2', 'successful-answer']);
  assert.equal(bundle.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(bundle.messages.at(-1)?.status, 'complete');
});

test('an invalid image result does not falsely claim that the admitted operation was never executed', () => {
  const base = snapshot();
  const value: NimiLocalAppConversationSnapshot = {
    ...base, voices: [],
    turns: [{ ...base.turns[0]!, status: 'completed', phase: null, reasonCode: 'AI_OUTPUT_INVALID' }],
    messages: [...base.messages, { messageId: 'answer', turnId: 'turn-1', role: 'assistant', partial: false, parts: [{ kind: 'text', text: 'The text is saved.' }] }],
    actions: [{ ...base.actions[0]!, status: 'failed', reasonCode: 'AI_OUTPUT_INVALID' }],
  };
  const build = (source: NimiLocalAppConversationSnapshot) => materializeCanonicalConversationBundle({ thread: thread(), projection: seedCanonicalConversationProjection(source), nowMs: 1 });
  assert.equal(build(value).messages.find(message => message.id === 'answer')?.metadataJson?.canonicalControlRejected, false);
  assert.equal(build({ ...value, actions: [] }).messages.find(message => message.id === 'answer')?.metadataJson?.canonicalControlRejected, true);
});

test('late committed images stay with the original reply both live and after reload', () => {
  const base = snapshot();
  const value: NimiLocalAppConversationSnapshot = { ...base, voices: [], messages: [...base.messages,
    { messageId: 'original-answer', turnId: 'turn-1', role: 'assistant', partial: false, parts: [{ kind: 'text', text: 'Drawing the boat.' }] },
    { messageId: 'new-user', turnId: 'turn-2', role: 'user', partial: false, parts: [{ kind: 'text', text: 'Only describe the wind.' }] },
    { messageId: 'new-answer', turnId: 'turn-2', role: 'assistant', partial: false, parts: [{ kind: 'text', text: 'The wind is light.' }] },
  ] };
  const image = { messageId: 'message-image-1', turnId: 'turn-1', role: 'assistant' as const, partial: false,
    parts: [{ kind: 'artifact-ref' as const, artifactId: 'image-artifact', mediaKind: 'image' as const, mimeType: 'image/png', displayName: null }] };
  const live = reduceCanonicalConversationEvent(seedCanonicalConversationProjection(value), {
    type: 'message-committed', sequence: '5', conversationAnchorId: 'anchor-1', turnId: 'turn-1', message: image,
  }).projection;
  const restored = seedCanonicalConversationProjection({ ...value, throughSequence: '5', messages: [...value.messages, image] });
  for (const projection of [live, restored]) {
    const bundle = materializeCanonicalConversationBundle({ thread: thread(), projection, nowMs: 1 });
    assert.deepEqual(bundle.messages.map(message => message.id), ['message-user-1', 'original-answer', 'message-image-1', 'new-user', 'new-answer']);
    assert.equal(bundle.messages[2]?.artifactId, 'image-artifact');
  }
});


test('voice failure and recovery share the original reply without a second player or eager audio read', () => {
  const initial = snapshot();
  const base: NimiLocalAppConversationSnapshot = {...initial,messages:[...initial.messages, {messageId:'message-voice-1',turnId:'turn-1',role:'assistant',partial:false,parts:[{kind:'text',text:'Original saved reply'}]}]};
  let reads = 0;
  const materialize = (value: NimiLocalAppConversationSnapshot) => materializeCanonicalConversationBundle({thread:thread(),projection:seedCanonicalConversationProjection(value),nowMs:1,media:{get(){reads++;return {mediaUrl:null,mimeType:null};}}});
  const failed = materialize(base).messages.find(message => message.id === 'message-voice-1')!;
  assert.equal(failed.metadataJson?.canonicalVoiceState, 'failed');
  assert.equal(failed.status, 'complete');
  const ready = materialize({...base,actions:[],voices:[{...base.voices[0]!,state:'ready',artifactId:'audio-1',reasonCode:null,message:null}]}).messages;
  assert.equal(ready.filter(message => message.kind === 'voice').length,0);
  assert.equal(ready.find(message=>message.id==='message-voice-1')?.metadataJson?.canonicalVoiceArtifactId,'audio-1');
  assert.equal(reads,0);
});

test('user Stop keeps partial or empty reply and does not invent a stream fault', () => {
  for (const hasText of [true, false]) {
    const base = snapshot();
    const value: NimiLocalAppConversationSnapshot = {
      ...base, actions: [], voices: [],
      turns: [{ ...base.turns[0]!, status: 'interrupted', terminalReason: 'user_cancel', inputTurnId: 'turn-1', canRegenerate: true }],
      messages: [...base.messages, ...(hasText ? [{messageId:'partial', turnId:'turn-1', role:'assistant' as const, partial:true, parts:[{kind:'text' as const,text:'Already received'}]}] : [])],
    };
    const bundle = materializeCanonicalConversationBundle({thread:thread(),projection:seedCanonicalConversationProjection(value),nowMs:1});
    const reply=bundle.messages.find(message=>message.role==='assistant')!;
    assert.equal(reply.error, null);
    assert.equal(reply.metadataJson?.canonicalTerminalReason, 'user_cancel');
    assert.equal(reply.contentText, hasText ? 'Already received' : '');
  }
});
