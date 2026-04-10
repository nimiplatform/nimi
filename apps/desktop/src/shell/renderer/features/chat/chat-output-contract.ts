import { AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID } from './chat-agent-behavior';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDesktopChatOutputContractLines(): string[] {
  return [
    'Return exactly one JSON object that matches the Agent Beat-Action Envelope schema.',
    'Do not output prose, Markdown, code fences, comments, XML, or any wrapper text before or after the JSON object.',
    'The first character of your response must be "{" and the final character must be "}".',
    'Never wrap the JSON object in ```json, backticks, quotes, or any Markdown block.',
    'The top-level object must contain "schemaId", "beats", and "actions". Do not rename or omit these keys.',
    `Set "schemaId" to "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID}".`,
    `Begin your response with {"schemaId":"${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID}"`,
    'Put all user-visible assistant text inside ordered "beats[*].text" fields.',
    'Every beat must include a unique "beatId" string (e.g. "beat-0", "beat-1").',
    'Every beat must include "intent": one of "reply", "follow-up", "comfort", "checkin", "media-request", or "voice-request".',
    'The first visible reply beat must be "beatIndex": 0 and "deliveryPhase": "primary".',
    'Any delayed follow-up beat must stay in the same "beats" array, use "deliveryPhase": "tail", and include a positive "delayMs".',
    'Keep "beatIndex" zero-based and contiguous; every beat must repeat the same "beatCount" equal to the beats array length.',
    'Keep "actionIndex" zero-based and contiguous; every action must repeat the same "actionCount" equal to the actions array length.',
    'Every action must include "actionId", "actionIndex", "actionCount", "modality", "operation", "promptPayload", "sourceBeatId", "sourceBeatIndex", and "deliveryCoupling".',
    '"deliveryCoupling" must be "after-source-beat" (deliver the action after the referenced beat) or "with-source-beat" (deliver alongside the referenced beat).',
    'Use one shared action schema for all modalities: "modality" must be "image", "voice", or "video".',
    'Use typed prompt payloads only: image -> {"kind":"image-prompt","promptText":"..."}, voice -> {"kind":"voice-prompt","promptText":"..."}, video -> {"kind":"video-prompt","promptText":"..."}.',
    'For voice actions, use "operation": "audio.synthesize" for narrow playback, "voice_workflow.tts_v2v" for clone workflow, or "voice_workflow.tts_t2v" for design workflow.',
    'If no modality action exists, return "actions": [].',
    'Keep internal planning private and never include chain-of-thought fields.',
  ];
}

export function buildDesktopChatEnvelopeSkeleton(): string {
  return [
    '{',
    `  "schemaId": "${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID}",`,
    '  "beats": [',
    '    {',
    '      "beatId": "beat-0",',
    '      "beatIndex": 0,',
    '      "beatCount": 1,',
    '      "intent": "reply",',
    '      "deliveryPhase": "primary",',
    '      "text": "<assistant reply>"',
    '    }',
    '  ],',
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
