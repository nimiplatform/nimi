// Relay proactive decision — adapted from local-chat proactive/decision.ts
// No mod SDK changes needed — pure logic

import type {
  LocalChatProactiveDecisionInput,
  LocalChatProactiveDecisionObject,
} from './types.js';

const PROACTIVE_MAX_CONTEXT_CHARS = 3200;
const PROACTIVE_MAX_MESSAGE_CHARS = 220;

function sanitizeProactiveMessage(input: string): string {
  return String(input || '')
    .replace(/^\s*["'`]+/, '')
    .replace(/["'`]+\s*$/, '')
    .replace(/[ \t]{3,}/g, ' ')
    .trim();
}

function joinLines(title: string, lines: string[]): string {
  const filtered = lines
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (filtered.length === 0) return '';
  return [`${title}:`, ...filtered.map((line) => `- ${line}`)].join('\n');
}

function summarizeContextPacket(input: LocalChatProactiveDecisionInput['contextPacket']): string {
  const chunks = [
    input.platformWarmStart
      ? [
        joinLines('Platform core warm-start', input.platformWarmStart.core),
        joinLines('Platform e2e warm-start', input.platformWarmStart.e2e),
      ].filter(Boolean).join('\n\n')
      : '',
    input.interactionSnapshot
      ? [
        joinLines('Relationship state', [input.interactionSnapshot.relationshipState]),
        joinLines('Assistant commitments', input.interactionSnapshot.assistantCommitments),
        joinLines('User preferences', input.interactionSnapshot.userPrefs),
        joinLines('Open loops', input.interactionSnapshot.openLoops),
        joinLines('Scene state', input.interactionSnapshot.activeScene),
      ].filter(Boolean).join('\n\n')
      : '',
    joinLines('Relation slots', (input.relationMemorySlots || []).map((entry) => `[${entry.slotType}] ${entry.key}: ${entry.value}`)),
    joinLines('Session recall', input.sessionRecall.map((entry) => entry.text)),
    joinLines('Recent exact turns', input.recentTurns.flatMap((turn) => [
      `${turn.role === 'assistant' ? 'Assistant' : 'User'} #${turn.seq}`,
      ...turn.lines,
    ])),
  ].filter(Boolean);
  return chunks.join('\n\n').slice(0, PROACTIVE_MAX_CONTEXT_CHARS) || '(empty)';
}

export async function generateLocalChatProactiveDecision(
  input: LocalChatProactiveDecisionInput,
): Promise<LocalChatProactiveDecisionObject> {
  const target = input.target;
  const prompt = [
    `You are ${target.displayName} (${target.handle}).`,
    'You are executing a proactive contact decision task.',
    'Output a strict JSON object with no extra text.',
    'Format:',
    '{"shouldContact": true|false, "message": "string", "reason": "string"}',
    'Rules:',
    '- When shouldContact=false, message must be empty string.',
    '- When shouldContact=true, message must be natural, no more than 2 sentences, do not explain rules.',
    '- reason only describes why triggered or not, no extra prefix.',
    '',
    'Current continuity context:',
    summarizeContextPacket(input.contextPacket),
  ].join('\n');

  const result = await input.aiClient.generateObject<LocalChatProactiveDecisionObject>({
    prompt,
    agentId: target.id,
  });

  const parsed = result.object;
  const shouldContact = Boolean(parsed.shouldContact);
  const message = sanitizeProactiveMessage(parsed.message).slice(0, PROACTIVE_MAX_MESSAGE_CHARS);
  const reason = String(parsed.reason || '').trim().slice(0, 240);
  return {
    shouldContact,
    message: shouldContact ? message : '',
    reason,
  };
}
