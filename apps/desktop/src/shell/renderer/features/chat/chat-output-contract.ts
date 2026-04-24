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
    'You may optionally include one top-level "statusCue" object for the current turn. If you do not need it, omit it or set it to null.',
    `Set "schemaId" to "${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}".`,
    `Begin your response with {"schemaId":"${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}"`,
    'Put all user-visible assistant text inside exactly one "message.text" field.',
    'The "message" object must include "messageId" and "text". Do not emit a second text message in the same turn.',
    'If "statusCue" is present, it must include "sourceMessageId" equal to "message.messageId".',
    'If "statusCue" is present, it may include only "sourceMessageId", "mood", "label", "intensity", and "actionCue". Do not add extra keys.',
    'If "statusCue.mood" is present, it must be one of "neutral", "joy", "focus", "calm", "playful", "concerned", or "surprised".',
    'If "statusCue.intensity" is present, it must be a number between 0 and 1.',
    'Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length.',
    'Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceMessageId", and "deliveryCoupling".',
    '"deliveryCoupling" must be "after-message" (deliver the action after the source message) or "with-message" (deliver alongside the source message).',
    'Use one shared action schema for admitted modalities: "modality" must be "image" or "voice". Do not emit "video"; video-generation product admission is deferred. Do not emit "follow-up-turn"; deferred continuation belongs to runtime HookIntent.',
    'Phase 1 limits: emit at most one "image" action and at most one "voice" action in the entire "actions" array.',
    'Never emit multiple "voice" actions in the same turn. If unsure, prefer "actions": [].',
    'Use typed prompt payloads only: image -> {"kind":"image-prompt","promptText":"..."}, voice -> {"kind":"voice-prompt","promptText":"..."}.',
    'For voice actions, use "operation": "audio.synthesize" for narrow playback, "voice_workflow.tts_v2v" for clone workflow, or "voice_workflow.tts_t2v" for design workflow.',
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
    '  "statusCue": null,',
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
