import { AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID } from './chat-agent-behavior';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDesktopChatOutputContractLines(): string[] {
  return [
    'Return exactly one JSON object that matches the Agent Message-Action Envelope schema.',
    'Do not output prose, Markdown, code fences, comments, XML, or any wrapper text before or after the JSON object.',
    'The first character of your response must be "{" and the final character must be "}".',
    'Never wrap the JSON object in ```json, backticks, quotes, or any Markdown block.',
    'The top-level object must contain "schemaId", "message", and "actions". Do not rename or omit these keys.',
    `Set "schemaId" to "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}".`,
    `Begin your response with {"schemaId":"${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}"`,
    'Put all user-visible assistant text inside exactly one "message.text" field.',
    'The "message" object must include "messageId" and "text". Do not emit a second text message in the same turn.',
    'Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length.',
    'Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceMessageId", and "deliveryCoupling".',
    '"deliveryCoupling" must be "after-message" (deliver the action after the source message) or "with-message" (deliver alongside the source message).',
    'Use one shared action schema for all modalities: "modality" must be "image", "voice", "video", or "follow-up-turn".',
    'Phase 1 limits: emit at most one "image" action and at most one "voice" action in the entire "actions" array.',
    'At most one "follow-up-turn" action may appear in the entire "actions" array. If unsure, prefer omitting it.',
    'Never emit multiple "voice" actions in the same turn. If unsure, prefer "actions": [].',
    'Use typed prompt payloads only: image -> {"kind":"image-prompt","promptText":"..."}, voice -> {"kind":"voice-prompt","promptText":"..."}, video -> {"kind":"video-prompt","promptText":"..."}, follow-up-turn -> {"kind":"follow-up-turn","promptText":"...","delayMs":400}.',
    'For voice actions, use "operation": "audio.synthesize" for narrow playback, "voice_workflow.tts_v2v" for clone workflow, or "voice_workflow.tts_t2v" for design workflow.',
    'For follow-up-turn actions, use "operation": "assistant.turn.schedule". This must create a new assistant turn, not a second text message in the current turn.',
    'If no modality action exists, return "actions": [].',
    'Keep internal planning private and never include chain-of-thought fields.',
  ];
}

export function buildDesktopChatEnvelopeSkeleton(): string {
  return [
    '{',
    `  "schemaId": "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}",`,
    '  "message": {',
    '    "messageId": "message-0",',
    '    "text": "<assistant reply>"',
    '  },',
    '  "actions": []',
    '}',
  ].join('\n');
}

export function buildDesktopChatOutputContractSection(): string {
  return [
    'Output Contract:',
    ...buildDesktopChatOutputContractLines().map((line) => `- ${line}`),
  ].join('\n');
}

export function composeDesktopChatSystemPrompt(basePrompt?: string | null): string {
  const base = normalizeText(basePrompt);
  const sections = [
    base || null,
    buildDesktopChatOutputContractSection(),
    `Response Skeleton:\n${buildDesktopChatEnvelopeSkeleton()}`,
  ].filter(Boolean);
  return sections.join('\n\n');
}
