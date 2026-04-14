import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID } from '../src/shell/renderer/features/chat/chat-agent-behavior.js';
import {
  parseAgentResolvedMessageActionEnvelope,
  resolveAgentModelOutputEnvelope,
} from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver.js';
import {
  buildDesktopChatEnvelopeSkeleton,
  buildDesktopChatOutputContractSection,
  composeDesktopChatSystemPrompt,
} from '../src/shell/renderer/features/chat/chat-output-contract.js';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function buildMinimalEnvelopeText(
  text: string,
  schemaId: string = AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
): string {
  return JSON.stringify({
    schemaId,
    message: {
      messageId: 'message-0',
      text,
    },
    actions: [],
  });
}

test('desktop chat output contract helper exposes message-action envelope rules', () => {
  const section = buildDesktopChatOutputContractSection();

  assert.match(section, /^Output Contract:/m);
  assert.match(section, /Return exactly one JSON object that matches the Agent Message-Action Envelope schema/);
  assert.match(section, /Do not output prose, Markdown, code fences, comments, XML, or any wrapper text before or after the JSON object/);
  assert.match(section, /The first character of your response must be "\{" and the final character must be "\}"/);
  assert.match(section, /Never wrap the JSON object in ```json, backticks, quotes, or any Markdown block/);
  assert.match(section, /The top-level object must contain "schemaId", "message", and "actions"\. Do not rename or omit these keys/);
  assert.match(section, new RegExp(`Set "schemaId" to "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"\\.`));
  assert.match(section, new RegExp(`Begin your response with \\{"schemaId":"${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.match(section, /Put all user-visible assistant text inside exactly one "message\.text" field/);
  assert.match(section, /The "message" object must include "messageId" and "text"/);
  assert.match(section, /Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length/);
  assert.match(section, /Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceMessageId", and "deliveryCoupling"/);
  assert.match(section, /"deliveryCoupling" must be "after-message".*or "with-message"/);
  assert.match(section, /Use one shared action schema for all modalities: "modality" must be "image", "voice", "video", or "follow-up-turn"/);
  assert.match(section, /Phase 1 limits: emit at most one "image" action and at most one "voice" action in the entire "actions" array/);
  assert.match(section, /At most one "follow-up-turn" action may appear in the entire "actions" array/);
  assert.match(section, /A follow-up-turn may appear again in later auto follow-up turns, but each single turn still admits at most one follow-up-turn action/);
  assert.match(section, /The full auto follow-up chain is capped at 8 assistant turns total/);
  assert.match(section, /A user reply in the same thread cancels any pending follow-up-turn delay/);
  assert.match(section, /Never emit multiple "voice" actions in the same turn/);
  assert.match(section, /Use typed prompt payloads only: image -> \{"kind":"image-prompt","promptText":"\.\.\."\}, voice -> \{"kind":"voice-prompt","promptText":"\.\.\."\}, video -> \{"kind":"video-prompt","promptText":"\.\.\."\}, follow-up-turn -> \{"kind":"follow-up-turn","promptText":"\.\.\.","delayMs":400\}/);
  assert.match(section, /For voice actions, use "operation": "audio\.synthesize" for narrow playback, "voice_workflow\.tts_v2v" for clone workflow, or "voice_workflow\.tts_t2v" for design workflow/);
  assert.match(section, /For follow-up-turn actions, use "operation": "assistant\.turn\.schedule".*may return its own actions array/);
  assert.match(section, /If no modality action exists, return "actions": \[\]/);
  assert.doesNotMatch(section, /Only output the user-visible reply body/);
  assert.doesNotMatch(section, /fall back to plain text instead of partial Markdown/);
});

test('desktop chat output contract helper appends contract after existing system prompt', () => {
  const prompt = composeDesktopChatSystemPrompt('Be concise.');

  assert.match(prompt, /^Be concise\./);
  assert.match(prompt, /\n\nOutput Contract:\n/);
  assert.match(prompt, /Return exactly one JSON object that matches the Agent Message-Action Envelope schema/);
  assert.match(prompt, /The first character of your response must be "\{" and the final character must be "\}"/);
  assert.match(prompt, /Response Skeleton:/);
  assert.match(prompt, new RegExp(`"schemaId": "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.doesNotMatch(prompt, /fall back to plain text instead of partial Markdown/);
});

test('desktop chat output contract helper exposes a minimal envelope skeleton', () => {
  const skeleton = buildDesktopChatEnvelopeSkeleton();

  assert.match(skeleton, /^\{/m);
  assert.match(skeleton, new RegExp(`"schemaId": "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID.replaceAll('.', '\\.')}"`));
  assert.match(skeleton, /"message": \{/);
  assert.match(skeleton, /"actions": \[\]/);
});

test('resolveAgentModelOutputEnvelope recovers fenced JSON output', () => {
  const modelOutput = `\uFEFF\`\`\`json\r\n${buildMinimalEnvelopeText('Recovered fenced output.')}\r\n\`\`\``;
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput,
    finishReason: 'stop',
    trace: {
      traceId: 'trace-fenced',
      promptTraceId: 'prompt-fenced',
    },
    usage: {
      inputTokens: 10,
      outputTokens: 12,
      totalTokens: 22,
    },
    contextWindowSource: 'route-profile',
    maxOutputTokensRequested: 256,
    promptOverflow: false,
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    assert.fail('expected fenced JSON to recover');
  }
  assert.equal(resolved.envelope.message.text, 'Recovered fenced output.');
  assert.equal(resolved.diagnostics.classification, 'json-fenced');
  assert.equal(resolved.diagnostics.recoveryPath, 'strip-fence');
  assert.equal(resolved.diagnostics.suspectedTruncation, false);
  assert.equal(resolved.diagnostics.finishReason, 'stop');
  assert.equal(resolved.diagnostics.traceId, 'trace-fenced');
  assert.equal(resolved.diagnostics.promptTraceId, 'prompt-fenced');
  assert.equal(resolved.diagnostics.usage?.totalTokens, 22);
});

test('resolveAgentModelOutputEnvelope recovers wrapper text around a single JSON object', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: `Here is the envelope:\n${buildMinimalEnvelopeText('Recovered wrapper output.')}\nThanks.`,
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    assert.fail('expected wrapped JSON to recover');
  }
  assert.equal(resolved.envelope.message.text, 'Recovered wrapper output.');
  assert.equal(resolved.diagnostics.classification, 'json-wrapper');
  assert.equal(resolved.diagnostics.recoveryPath, 'extract-json-object');
});

test('resolveAgentModelOutputEnvelope recovers the envelope when wrapper text contains other braces', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: [
      'Status note: {model added commentary before the contract output}',
      buildMinimalEnvelopeText('Recovered after noisy wrapper braces.'),
      'Tail note: {postscript}',
    ].join('\n'),
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    assert.fail('expected wrapped JSON with stray braces to recover');
  }
  assert.equal(resolved.envelope.message.text, 'Recovered after noisy wrapper braces.');
  assert.equal(resolved.diagnostics.classification, 'json-wrapper');
  assert.equal(resolved.diagnostics.recoveryPath, 'extract-json-object');
});

test('resolveAgentModelOutputEnvelope rejects pure plain text outputs', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: '我可以先帮你整理下一步计划。',
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected plain text to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-json');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
  assert.equal(resolved.diagnostics.suspectedTruncation, false);
});

test('resolveAgentModelOutputEnvelope marks incomplete JSON as partial and suspected truncation', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: `{"schemaId":"${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}","message":{"messageId":"message-0"`,
    finishReason: 'length',
    trace: {
      traceId: 'trace-partial',
      promptTraceId: 'prompt-partial',
    },
    usage: {
      inputTokens: 15,
      outputTokens: 16,
    },
    contextWindowSource: 'route-profile',
    maxOutputTokensRequested: 128,
    promptOverflow: true,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected partial JSON to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'partial-json');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
  assert.equal(resolved.diagnostics.suspectedTruncation, true);
  assert.equal(resolved.diagnostics.finishReason, 'length');
  assert.equal(resolved.diagnostics.maxOutputTokensRequested, 128);
  assert.equal(resolved.diagnostics.promptOverflow, true);
});

test('resolveAgentModelOutputEnvelope does not recover malformed JSON attempts with actions', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: [
      '{',
      `  "schemaId": "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}",`,
      '  "beats": [{',
      '    "beatId": "beat-0",',
      '    "beatIndex": 0,',
      '    "beatCount": 1,',
      '    "intent": "reply",',
      '    "deliveryPhase": "primary",',
      '    "text": "hello"',
      '  }],',
      '  "actions": [{',
      '    "actionId": "action-0",',
      '    "actionIndex": 0,',
      '    "actionCount": 1,',
      '    "modality": "image",',
      '    "operation": "images.generate"',
      '  }]',
      '}',
    ].join('\n'),
    finishReason: 'stop',
    contextWindowSource: 'route-profile',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected malformed JSON attempt to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-json');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
});

test('resolveAgentModelOutputEnvelope fails close on schema-invalid JSON', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: buildMinimalEnvelopeText('Wrong schema.', 'agent.schema.invalid'),
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected schema-invalid JSON to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-json');
  assert.equal(resolved.diagnostics.suspectedTruncation, false);
});

test('agent message-action envelope parser fails close on fenced JSON with a contract-specific error', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope([
      '```json',
      '{',
      `  "schemaId": "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}",`,
      '  "message": {',
      '    "messageId": "message-0",',
      '    "text": "hello"',
      '  },',
      '  "actions": []',
      '}',
      '```',
    ].join('\n'));
  }, /raw JSON object with no Markdown code fences or wrapper text/);
});

test('agent message-action envelope parser fails close on multiple voice actions in phase 1', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope(JSON.stringify({
      schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
      message: {
        messageId: 'message-0',
        text: '你好呀。',
      },
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
          sourceMessageId: 'message-0',
          deliveryCoupling: 'with-message',
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
          sourceMessageId: 'message-0',
          deliveryCoupling: 'after-message',
        },
      ],
    }));
  }, /agent-local-chat-v1 admits at most one voice action in phase 1/);
});

test('agent message-action envelope parser normalizes redundant actionCount mirrors', () => {
  const envelope = parseAgentResolvedMessageActionEnvelope(JSON.stringify({
    schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message: {
      messageId: 'message-0',
      text: 'hello',
    },
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
        sourceMessageId: 'message-0',
        deliveryCoupling: 'after-message',
      },
    ],
  }));

  assert.equal(envelope.message.messageId, 'message-0');
  assert.equal(envelope.actions[0]?.actionCount, 1);
});

test('desktop AI host does NOT inject the message-action output contract into simple-ai systemPrompt', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');

  // The simple-ai provider streams raw text-deltas directly and does not parse
  // message-action envelopes. Injecting the output contract would cause the model
  // to return JSON that the simple-ai provider displays verbatim.
  assert.doesNotMatch(source, /composeDesktopChatSystemPrompt/);
});
