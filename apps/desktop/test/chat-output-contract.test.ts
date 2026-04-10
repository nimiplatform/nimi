import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import { parseAgentResolvedBeatActionEnvelope } from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import {
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
  assert.match(section, new RegExp(`Set "schemaId" to "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"\\.`));
  assert.match(section, /Put all user-visible assistant text inside ordered "beats\[\*\]\.text" fields/);
  assert.match(section, /Every beat must include a unique "beatId" string/);
  assert.match(section, /Every beat must include "intent": one of "reply", "follow-up", "comfort", "checkin", "media-request", or "voice-request"/);
  assert.match(section, /The first visible reply beat must be "beatIndex": 0 and "deliveryPhase": "primary"/);
  assert.match(section, /Any delayed follow-up beat must stay in the same "beats" array, use "deliveryPhase": "tail", and include a positive "delayMs"/);
  assert.match(section, /Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length/);
  assert.match(section, /Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceBeatId", "sourceBeatIndex", and "deliveryCoupling"/);
  assert.match(section, /"deliveryCoupling" must be "after-source-beat".*or "with-source-beat"/);
  assert.match(section, /Use one shared action schema for all modalities: "modality" must be "image", "voice", or "video"/);
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
  assert.doesNotMatch(prompt, /fall back to plain text instead of partial Markdown/);
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

test('desktop AI host injects the shared output contract into simple-ai systemPrompt resolution', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');

  assert.match(source, /composeDesktopChatSystemPrompt/);
  assert.match(source, /resolveSystemPrompt:\s*\(turnInput\)\s*=>\s*composeDesktopChatSystemPrompt\(turnInput\.systemPrompt\)/);
});
