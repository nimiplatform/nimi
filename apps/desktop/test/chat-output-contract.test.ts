import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import { parseAgentResolvedBeatActionEnvelope, recoverPlainTextAsEnvelope } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import {
  buildDesktopChatEnvelopeSkeleton,
  buildDesktopChatOutputContractSection,
  composeDesktopChatSystemPrompt,
} from '../src/shell/renderer/features/chat/chat-output-contract.js';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('desktop chat output contract helper exposes beat-action envelope rules', () => {
  const section = buildDesktopChatOutputContractSection();

  assert.match(section, /^Output Contract:/m);
  assert.match(section, /Return exactly one JSON object that matches the Agent Beat-Action Envelope schema/);
  assert.match(section, /Do not output prose, Markdown, code fences, comments, XML, or any wrapper text before or after the JSON object/);
  assert.match(section, /The first character of your response must be "\{" and the final character must be "\}"/);
  assert.match(section, /Never wrap the JSON object in ```json, backticks, quotes, or any Markdown block/);
  assert.match(section, /The top-level object must contain "schemaId", "beats", and "actions"\. Do not rename or omit these keys/);
  assert.match(section, new RegExp(`Set "schemaId" to "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"\\.`));
  assert.match(section, new RegExp(`Begin your response with \\{"schemaId":"${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.match(section, /Put all user-visible assistant text inside ordered "beats\[\*\]\.text" fields/);
  assert.match(section, /Every beat must include a unique "beatId" string/);
  assert.match(section, /Every beat must include "intent": one of "reply", "follow-up", "comfort", "checkin", "media-request", or "voice-request"/);
  assert.match(section, /The first visible reply beat must be "beatIndex": 0 and "deliveryPhase": "primary"/);
  assert.match(section, /Any delayed follow-up beat must stay in the same "beats" array, use "deliveryPhase": "tail", and include a positive "delayMs"/);
  assert.match(section, /Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length/);
  assert.match(section, /Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceBeatId", "sourceBeatIndex", and "deliveryCoupling"/);
  assert.match(section, /"deliveryCoupling" must be "after-source-beat".*or "with-source-beat"/);
  assert.match(section, /Use one shared action schema for all modalities: "modality" must be "image", "voice", or "video"/);
  assert.match(section, /Phase 1 limits: emit at most one "image" action and at most one "voice" action in the entire "actions" array/);
  assert.match(section, /Never emit multiple "voice" actions for separate beats in the same turn/);
  assert.match(section, /Use typed prompt payloads only: image -> \{"kind":"image-prompt","promptText":"\.\.\."\}, voice -> \{"kind":"voice-prompt","promptText":"\.\.\."\}, video -> \{"kind":"video-prompt","promptText":"\.\.\."\}/);
  assert.match(section, /For voice actions, use "operation": "audio\.synthesize" for narrow playback, "voice_workflow\.tts_v2v" for clone workflow, or "voice_workflow\.tts_t2v" for design workflow/);
  assert.match(section, /If no modality action exists, return "actions": \[\]/);
  assert.doesNotMatch(section, /Only output the user-visible reply body/);
  assert.doesNotMatch(section, /fall back to plain text instead of partial Markdown/);
});

test('desktop chat output contract helper appends contract after existing system prompt', () => {
  const prompt = composeDesktopChatSystemPrompt('Be concise.');

  assert.match(prompt, /^Be concise\./);
  assert.match(prompt, /\n\nOutput Contract:\n/);
  assert.match(prompt, /Return exactly one JSON object that matches the Agent Beat-Action Envelope schema/);
  assert.match(prompt, /The first character of your response must be "\{" and the final character must be "\}"/);
  assert.match(prompt, /Response Skeleton:/);
  assert.match(prompt, new RegExp(`"schemaId": "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.doesNotMatch(prompt, /fall back to plain text instead of partial Markdown/);
});

test('desktop chat output contract helper exposes a minimal envelope skeleton', () => {
  const skeleton = buildDesktopChatEnvelopeSkeleton();

  assert.match(skeleton, /^\{/m);
  assert.match(skeleton, new RegExp(`"schemaId": "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.match(skeleton, /"beats": \[/);
  assert.match(skeleton, /"actions": \[\]/);
});

test('recoverPlainTextAsEnvelope wraps plain text in a minimal single-beat envelope', () => {
  const envelope = recoverPlainTextAsEnvelope('我无法提供照片，但我可以描述一个舞蹈场景。');
  assert.ok(envelope);
  assert.equal(envelope.schemaId, AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID);
  assert.equal(envelope.beats.length, 1);
  const beat = envelope.beats[0]!;
  assert.equal(beat.beatIndex, 0);
  assert.equal(beat.beatCount, 1);
  assert.equal(beat.intent, 'reply');
  assert.equal(beat.deliveryPhase, 'primary');
  assert.equal(beat.text, '我无法提供照片，但我可以描述一个舞蹈场景。');
  assert.deepEqual(envelope.actions, []);
});

test('recoverPlainTextAsEnvelope returns null for malformed JSON attempts', () => {
  assert.equal(recoverPlainTextAsEnvelope('{"schemaId": "broken'), null);
  assert.equal(recoverPlainTextAsEnvelope('[1, 2, 3]'), null);
  assert.equal(recoverPlainTextAsEnvelope('```json\n{}```'), null);
  assert.equal(recoverPlainTextAsEnvelope(''), null);
  assert.equal(recoverPlainTextAsEnvelope('   '), null);
});

test('agent beat-action envelope parser fails close on fenced JSON with a contract-specific error', () => {
  assert.throws(() => {
    parseAgentResolvedBeatActionEnvelope([
      '```json',
      '{',
      `  "schemaId": "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID}",`,
      '  "beats": [{',
      '    "beatId": "beat-0",',
      '    "beatIndex": 0,',
      '    "beatCount": 1,',
      '    "intent": "reply",',
      '    "deliveryPhase": "primary",',
      '    "text": "hello"',
      '  }],',
      '  "actions": []',
      '}',
      '```',
    ].join('\n'));
  }, /raw JSON object with no Markdown code fences or wrapper text/);
});

test('agent beat-action envelope parser fails close on multiple voice actions in phase 1', () => {
  assert.throws(() => {
    parseAgentResolvedBeatActionEnvelope(JSON.stringify({
      schemaId: AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID,
      beats: [
        {
          beatId: 'beat-0',
          beatIndex: 0,
          beatCount: 2,
          intent: 'checkin',
          deliveryPhase: 'primary',
          text: '你好呀。',
        },
        {
          beatId: 'beat-1',
          beatIndex: 1,
          beatCount: 2,
          intent: 'follow-up',
          deliveryPhase: 'tail',
          delayMs: 400,
          text: '今天过得怎么样？',
        },
      ],
      actions: [
        {
          actionId: 'voice-0',
          actionIndex: 0,
          actionCount: 2,
          modality: 'voice',
          operation: 'audio.synthesize',
          promptPayload: {
            kind: 'voice-prompt',
            promptText: '用轻柔语气读出第一句。',
          },
          sourceBeatId: 'beat-0',
          sourceBeatIndex: 0,
          deliveryCoupling: 'with-source-beat',
        },
        {
          actionId: 'voice-1',
          actionIndex: 1,
          actionCount: 2,
          modality: 'voice',
          operation: 'audio.synthesize',
          promptPayload: {
            kind: 'voice-prompt',
            promptText: '用轻柔语气读出第二句。',
          },
          sourceBeatId: 'beat-1',
          sourceBeatIndex: 1,
          deliveryCoupling: 'after-source-beat',
        },
      ],
    }));
  }, /agent-local-chat-v1 admits at most one voice action in phase 1/);
});

test('agent beat-action envelope parser normalizes redundant beatCount and actionCount mirrors', () => {
  const envelope = parseAgentResolvedBeatActionEnvelope(JSON.stringify({
    schemaId: AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID,
    beats: [
      {
        beatId: 'beat-0',
        beatIndex: 0,
        beatCount: 0,
        intent: 'reply',
        deliveryPhase: 'primary',
        text: 'hello',
      },
    ],
    actions: [
      {
        actionId: 'action-0',
        actionIndex: 0,
        actionCount: 0,
        modality: 'image',
        operation: 'images.generate',
        promptPayload: {
          kind: 'image-prompt',
          promptText: 'A warm portrait',
        },
        sourceBeatId: 'beat-0',
        sourceBeatIndex: 0,
        deliveryCoupling: 'after-source-beat',
      },
    ],
  }));

  assert.equal(envelope.beats[0]?.beatCount, 1);
  assert.equal(envelope.actions[0]?.actionCount, 1);
});

test('desktop AI host does NOT inject the beat-action output contract into simple-ai systemPrompt', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');

  // The simple-ai provider streams raw text-deltas directly and does not parse
  // beat-action envelopes. Injecting the output contract would cause the model
  // to return JSON that the simple-ai provider displays verbatim.
  assert.doesNotMatch(source, /composeDesktopChatSystemPrompt/);
});
