import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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

function buildMinimalAPML(text: string): string {
  return `<message id="message-0">${text}</message>`;
}

test('desktop chat output contract helper exposes APML rules', () => {
  const section = buildDesktopChatOutputContractSection();

  assert.match(section, /^Output Contract:/m);
  assert.match(section, /Return APML only/);
  assert.match(section, /first non-whitespace characters must be <message/);
  assert.match(section, /exactly one <message id="\.\.\.">/);
  assert.match(section, /<emotion>neutral\|joy\|focus\|calm\|playful\|concerned\|surprised<\/emotion>/);
  assert.match(section, /<activity>\.\.\.<\/activity>/);
  assert.match(section, /sibling <action> tags after <\/message>/);
  assert.match(section, /kind may be only "image" or "voice"/);
  assert.match(section, /Do not emit kind="video"/);
  assert.match(section, /<time-hook> with <delay-ms>/);
  assert.match(section, /<event-user-idle idle-for="600s"\/> or <event-chat-ended\/>/);
  assert.doesNotMatch(section, /Return exactly one JSON object/);
  assert.doesNotMatch(section, /schemaId/);
});

test('desktop chat output contract helper appends APML contract after existing system prompt', () => {
  const prompt = composeDesktopChatSystemPrompt('Be concise.');

  assert.match(prompt, /^Be concise\./);
  assert.match(prompt, /\n\nOutput Contract:\n/);
  assert.match(prompt, /Return APML only/);
  assert.match(prompt, /Response Skeleton:/);
  assert.match(prompt, /^<message id="message-0">/m);
  assert.doesNotMatch(prompt, /Return exactly one JSON object/);
});

test('desktop chat output contract helper exposes an APML skeleton', () => {
  const skeleton = buildDesktopChatEnvelopeSkeleton();

  assert.match(skeleton, /^<message id="message-0">/m);
  assert.match(skeleton, /<emotion>neutral<\/emotion>/);
  assert.match(skeleton, /<activity>responding<\/activity>/);
  assert.match(skeleton, /Assistant reply text here\./);
  assert.doesNotMatch(skeleton, /schemaId/);
});

test('resolveAgentModelOutputEnvelope accepts strict APML output', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: [
      '<message id="message-0">',
      '  <emotion>joy</emotion>',
      '  <activity>wave</activity>',
      '  Ready.',
      '</message>',
      '<action id="image-0" kind="image" source-message="message-0" coupling="after-message">',
      '  <prompt-payload kind="image"><prompt-text>A quiet rainy street.</prompt-text></prompt-payload>',
      '</action>',
    ].join('\n'),
    finishReason: 'stop',
    trace: {
      traceId: 'trace-apml',
      promptTraceId: 'prompt-apml',
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
    assert.fail('expected APML to resolve');
  }
  assert.equal(resolved.envelope.message.text, 'Ready.');
  assert.equal(resolved.envelope.statusCue?.mood, 'joy');
  assert.equal(resolved.envelope.statusCue?.actionCue, 'wave');
  assert.equal(resolved.envelope.actions[0]?.modality, 'image');
  assert.equal(resolved.diagnostics.classification, 'strict-apml');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
  assert.equal(resolved.diagnostics.suspectedTruncation, false);
  assert.equal(resolved.diagnostics.traceId, 'trace-apml');
  assert.equal(resolved.diagnostics.promptTraceId, 'prompt-apml');
  assert.equal(resolved.diagnostics.usage?.totalTokens, 22);
});

test('resolveAgentModelOutputEnvelope rejects JSON model output instead of recovering it', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: JSON.stringify({
      schemaId: 'nimi.agent.chat.message-action.v1',
      message: {
        messageId: 'message-0',
        text: 'JSON should not be accepted.',
      },
      actions: [],
    }),
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected JSON model output to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-apml');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
  assert.match(resolved.diagnostics.parseErrorDetail || '', /APML output must begin with <message>/);
});

test('resolveAgentModelOutputEnvelope rejects fenced APML output without recovery', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: `\`\`\`xml\n${buildMinimalAPML('No fenced APML.')}\n\`\`\``,
    finishReason: 'stop',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    assert.fail('expected fenced APML to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-apml');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
});

test('resolveAgentModelOutputEnvelope marks incomplete APML as partial and suspected truncation', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: '<message id="message-0"><emotion>calm</emotion>unfinished',
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
    assert.fail('expected partial APML to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'partial-apml');
  assert.equal(resolved.diagnostics.recoveryPath, 'none');
  assert.equal(resolved.diagnostics.suspectedTruncation, true);
  assert.equal(resolved.diagnostics.finishReason, 'length');
  assert.equal(resolved.diagnostics.maxOutputTokensRequested, 128);
  assert.equal(resolved.diagnostics.promptOverflow, true);
});

test('agent message-action APML parser fails closed on multiple voice actions', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope([
      buildMinimalAPML('你好呀。'),
      '<action id="voice-0" kind="voice" source-message="message-0" coupling="with-message">',
      '  <prompt-payload kind="voice"><prompt-text>用轻柔语气读出第一句。</prompt-text></prompt-payload>',
      '</action>',
      '<action id="voice-1" kind="voice" source-message="message-0" coupling="after-message">',
      '  <prompt-payload kind="voice"><prompt-text>用轻柔语气读出第二句。</prompt-text></prompt-payload>',
      '</action>',
    ].join('\n'));
  }, /at most one voice action/);
});

test('agent message-action APML parser fails closed on deferred video actions', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope([
      buildMinimalAPML('我不能接收视频生成动作。'),
      '<action id="video-0" kind="video" source-message="message-0" coupling="after-message">',
      '  <prompt-payload kind="video"><prompt-text>镜头缓慢推进的夜景。</prompt-text></prompt-payload>',
      '</action>',
    ].join('\n'));
  }, /video action is deferred/);
});

test('agent message-action APML parser fails closed on desktop hook tags', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope([
      buildMinimalAPML('我不能接收桌面延迟跟进动作。'),
      '<time-hook id="follow-up-0">',
      '  <delay-ms>400</delay-ms>',
      '  <effect kind="follow-up-turn"><prompt-text>稍后再说一句。</prompt-text></effect>',
      '</time-hook>',
    ].join('\n'));
  }, /runtime HookIntent-owned/);
});

test('agent message-action APML parser fails closed on unsupported attributes', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope('<message id="message-0" schema="legacy">你好。</message>');
  }, /APML message\.schema is not admitted/);

  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope([
      buildMinimalAPML('我不能接收额外属性。'),
      '<action id="image-0" kind="image" source-message="message-0" priority="hidden">',
      '  <prompt-payload kind="image"><prompt-text>一张安静的桌面。</prompt-text></prompt-payload>',
      '</action>',
    ].join('\n'));
  }, /APML action\.priority is not admitted/);
});

test('agent message-action APML parser fails closed on duplicate attributes', () => {
  assert.throws(() => {
    parseAgentResolvedMessageActionEnvelope('<message id="message-0" id="message-1">你好。</message>');
  }, /APML message\.id is duplicated/);
});

test('desktop AI host does NOT inject the APML output contract into simple-ai systemPrompt', () => {
  const source = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-shell-adapter.tsx');

  // The simple-ai provider streams raw text deltas directly and does not parse
  // message-action envelopes. Injecting APML would cause visible markup.
  assert.doesNotMatch(source, /composeDesktopChatSystemPrompt/);
});
