import { ReasonCode } from '@nimiplatform/sdk/types';

const RELAY_REASON_CODE_MISSING_AGENT_ID = ReasonCode.AI_INPUT_INVALID;

export const RELAY_AGENT_SCOPED_CHANNELS = [
  'relay:ai:generate',
  'relay:ai:stream:open',
  'relay:media:tts:synthesize',
  'relay:media:video:generate',
] as const;

export function requireAgentId(input: unknown): void {
  const agentId = input && typeof input === 'object' && 'agentId' in input
    ? (input as { agentId?: unknown }).agentId
    : undefined;
  if (!agentId || typeof agentId !== 'string') {
    throw Object.assign(new Error('agentId is required for agent-scoped IPC calls'), {
      reasonCode: RELAY_REASON_CODE_MISSING_AGENT_ID,
      actionHint: 'Select an agent before using this feature',
    });
  }
}
