import type { HarnessToolCall, HarnessTranscriptEntry } from './harness-types.js';

export type AssistantStepItem =
  | { kind: 'thinking'; key: string; text: string; streaming?: boolean }
  | { kind: 'tool'; key: string; call: HarnessToolCall }
  | { kind: 'orphan-tool-result'; key: string; entry: HarnessTranscriptEntry }
  | { kind: 'text'; key: string; text: string; streaming?: boolean };

export type TranscriptRenderGroup =
  | { kind: 'user'; key: string; entry: HarnessTranscriptEntry; fromHome: boolean }
  | {
    kind: 'assistant-turn';
    key: string;
    fromHome: boolean;
    hasRedactedThinking: boolean;
    streaming: boolean;
    items: AssistantStepItem[];
  };

export type ParsedToolOutcome =
  | { kind: 'changes-requested'; feedback: string }
  | { kind: 'declined' }
  | { kind: 'readonly-blocked'; detail: string }
  | { kind: 'expired' }
  | { kind: 'default'; output?: string };

const CHANGES_REQUESTED_RE = /^(?:Tool call blocked:\s*)?The user declined this proposal and requested changes:\s*\r?\n?([\s\S]*)$/i;
const DECLINED_RE = /^(?:Tool call blocked:\s*)?The user declined this operation\.?\s*$/i;
const READONLY_BLOCKED_RE = /^(?:Tool call blocked:\s*)?Blocked by Plan Read-Only mode:\s*([\s\S]*)$/i;
const EXPIRED_RE = /^(?:Tool call blocked:\s*)?The decision expired before approval\.?\s*$/i;
const BLOCKED_PREFIX_RE = /^Tool call blocked:\s*/i;

export function parseToolCallOutcome(call: Pick<HarnessToolCall, 'status' | 'toolFailure' | 'output'>): ParsedToolOutcome {
  const raw = call.output?.trim();
  if (!raw) return { kind: 'default' };

  const changesMatch = raw.match(CHANGES_REQUESTED_RE);
  if (changesMatch) {
    return { kind: 'changes-requested', feedback: (changesMatch[1] ?? '').trim() };
  }
  if (DECLINED_RE.test(raw)) {
    return { kind: 'declined' };
  }
  const readonlyMatch = raw.match(READONLY_BLOCKED_RE);
  if (readonlyMatch) {
    return { kind: 'readonly-blocked', detail: (readonlyMatch[1] ?? '').trim() };
  }
  if (EXPIRED_RE.test(raw)) {
    return { kind: 'expired' };
  }
  if (call.toolFailure === 'blocked' && BLOCKED_PREFIX_RE.test(raw)) {
    return { kind: 'default', output: raw.replace(BLOCKED_PREFIX_RE, '').trim() };
  }
  return { kind: 'default', output: call.output };
}

export function groupTranscriptItems(
  entries: readonly HarnessTranscriptEntry[],
  livePartial?: string,
  livePartialThinking?: string,
): TranscriptRenderGroup[] {
  const pairedToolCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.role === 'assistant' && entry.toolCalls) {
      for (const tc of entry.toolCalls) pairedToolCallIds.add(tc.id);
    }
  }

  const visibleEntries = entries.filter(entry => {
    if (entry.role === 'toolResult' && entry.toolCallId && pairedToolCallIds.has(entry.toolCallId)) {
      return false;
    }
    return true;
  });

  const groups: TranscriptRenderGroup[] = [];

  for (let index = 0; index < visibleEntries.length; index++) {
    const entry = visibleEntries[index];
    const fromHome = Boolean(entry.fromHome);
    const entryKey = entry.id ?? `entry-${index}`;

    if (entry.role === 'user') {
      groups.push({ kind: 'user', key: entryKey, entry, fromHome });
      continue;
    }

    const last = groups[groups.length - 1];
    let turn: Extract<TranscriptRenderGroup, { kind: 'assistant-turn' }>;
    if (last && last.kind === 'assistant-turn' && last.fromHome === fromHome) {
      turn = last;
    } else {
      turn = {
        kind: 'assistant-turn',
        key: `turn-${entryKey}`,
        fromHome,
        hasRedactedThinking: false,
        streaming: false,
        items: [],
      };
      groups.push(turn);
    }

    if (entry.role === 'assistant') {
      if (entry.hasRedactedThinking) turn.hasRedactedThinking = true;
      if (entry.thinking?.trim()) {
        turn.items.push({ kind: 'thinking', key: `${entryKey}:thinking`, text: entry.thinking });
      }
      if (entry.toolCalls && entry.toolCalls.length > 0) {
        for (const call of entry.toolCalls) {
          turn.items.push({ kind: 'tool', key: `${entryKey}:tool:${call.id}`, call });
        }
      }
      if (entry.text?.trim()) {
        turn.items.push({ kind: 'text', key: `${entryKey}:text`, text: entry.text });
      }
    } else {
      turn.items.push({ kind: 'orphan-tool-result', key: `${entryKey}:result`, entry });
    }
  }

  if (livePartial || livePartialThinking) {
    const last = groups[groups.length - 1];
    let turn: Extract<TranscriptRenderGroup, { kind: 'assistant-turn' }>;
    if (last && last.kind === 'assistant-turn' && !last.fromHome) {
      turn = last;
    } else {
      turn = {
        kind: 'assistant-turn',
        key: 'turn-live',
        fromHome: false,
        hasRedactedThinking: false,
        streaming: true,
        items: [],
      };
      groups.push(turn);
    }
    turn.streaming = true;
    if (livePartialThinking) {
      turn.items.push({ kind: 'thinking', key: 'live:thinking', text: livePartialThinking, streaming: true });
    }
    if (livePartial) {
      turn.items.push({ kind: 'text', key: 'live:text', text: livePartial, streaming: true });
    }
  }

  return groups.filter(group =>
    group.kind === 'user' || group.items.length > 0 || group.streaming,
  );
}
