import {
  RouteAndSubmitOutcome,
  type BrainSessionEventEnvelope,
  type PendingAttentionRecord,
  type RouteAndSubmitInputRequest,
  type RouteAndSubmitInputResponse,
  type SessionRouteCandidate,
  type WorkSessionRecord,
} from '@nimiplatform/sdk/runtime/generated';

export type OmniTriggerKind = 'human' | 'partner' | 'session';

export type OmniTriggerMatch = Readonly<{
  kind: OmniTriggerKind;
  triggerStart: number;
  triggerEnd: number;
  query: string;
}>;

export type OmniPartnerMode = 'harness' | 'zhiyu';

export type OmniTargetSelection =
  | Readonly<{ kind: 'auto' }>
  | Readonly<{
      kind: 'human';
      contactId: string;
      displayName: string;
      handle?: string | null;
    }>
  | Readonly<{
      kind: 'partner';
      agentHandle: string;
      displayName: string;
      mode: OmniPartnerMode;
    }>
  | Readonly<{
      kind: 'session';
      workSessionRef: string;
      title: string;
      archived?: boolean;
      agentHandle?: string;
    }>;

export type OmniAttachmentState = Readonly<{
  /** Read-only reference files (default for drag-drop and "+ Attach reference file"). Never grants write access. */
  attachmentPaths: readonly string[];
  /** Explicitly authorized writable workspace root directory. */
  workspaceRoot: string | null;
  workspaceWritable: boolean;
}>;

export type OmniLightQaMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  text: string;
  seq: number;
  streaming?: boolean;
}>;

export type OmniLightQaCardState = Readonly<{
  workSessionRef: string;
  agentHandle: string;
  agentDisplayName: string;
  messages: readonly OmniLightQaMessage[];
  lastSeq: number;
  streaming: boolean;
  turnCount: number;
  promotedToSessionRef: string | null;
  promotedHandoffTurns: number;
  errorMessage: string | null;
}>;

export type OmniDisambiguationState = Readonly<{
  /** Preserved exact pre-session request_id so re-submitting after picking 1/2/3 is atomic & conflict-free (FT-02). */
  requestId: string;
  draftText: string;
  candidates: readonly SessionRouteCandidate[];
}>;

export const EMPTY_OMNI_ATTACHMENTS: OmniAttachmentState = Object.freeze({
  attachmentPaths: [],
  workspaceRoot: null,
  workspaceWritable: false,
});

const TRIGGER_CHAR_TO_KIND: Readonly<Record<string, OmniTriggerKind>> = {
  '@': 'human',
  '＠': 'human',
  '~': 'partner',
  '～': 'partner',
  '#': 'session',
  '＃': 'session',
};

const CODE_DIRECTIVE_PATTERN = /^#(?:include|define|ifdef|ifndef|endif|pragma|undef|elif|else|error|warning|line|region|endregion|import)\b/i;

/**
 * Strict v2.1 symbol trigger parser (02 §2.2).
 * - Only triggers when `@`/`＠`, `~`/`～`, `#`/`＃` sits at index 0 or immediately after whitespace.
 * - Never triggers inside emails (`a@b.com`), numeric ranges (`3~5天`), home paths (`~/docs`),
 *   URL fragments (`https://a.com#top`), or code directives (`#include`).
 */
export function parseOmniTriggerToken(text: string, caretIndex: number): OmniTriggerMatch | null {
  if (!text || caretIndex <= 0) return null;
  const clampedCaret = Math.min(caretIndex, text.length);
  const beforeCaret = text.slice(0, clampedCaret);

  // Walk backward from caret until whitespace or start of string.
  let tokenStart = clampedCaret;
  while (tokenStart > 0 && !/\s/u.test(beforeCaret[tokenStart - 1] ?? '')) {
    tokenStart -= 1;
  }
  const token = beforeCaret.slice(tokenStart, clampedCaret);
  if (!token) return null;

  const firstChar = token[0] ?? '';
  const kind = TRIGGER_CHAR_TO_KIND[firstChar];
  if (!kind) return null;

  // Guard: trigger symbol MUST be at start-of-string or preceded by whitespace (already guaranteed by tokenStart walk).
  // Guard: reject home directory path prefixes (`~/docs`, `~\docs`).
  if (kind === 'partner' && (token.startsWith('~/') || token.startsWith('~\\') || token.startsWith('～/'))) {
    return null;
  }

  // Guard: reject C/C++/C# preprocessor directives (`#include`, `#define`, etc.).
  if (kind === 'session' && CODE_DIRECTIVE_PATTERN.test(token)) {
    return null;
  }

  const query = token.slice(1);
  // Guard: reject if query contains path separators or protocol punctuation (e.g. accidental paste).
  if (query.includes('://')) return null;

  return {
    kind,
    triggerStart: tokenStart,
    triggerEnd: clampedCaret,
    query,
  };
}

export function stripOmniTriggerToken(text: string, match: OmniTriggerMatch): string {
  const before = text.slice(0, match.triggerStart);
  const after = text.slice(match.triggerEnd);
  return `${before}${after}`.replace(/^\s+/u, '');
}

export function hasOmniFileContext(attachments: OmniAttachmentState): boolean {
  return attachments.attachmentPaths.length > 0 || Boolean(attachments.workspaceRoot);
}

/**
 * Enforces v2.1 §2.1 rule: when files or a workspace are attached, partner mode is locked to
 * `harness` (work) and cannot toggle back to `zhiyu` (pure companion).
 */
export function resolveEffectivePartnerMode(
  mode: OmniPartnerMode,
  attachments: OmniAttachmentState,
): OmniPartnerMode {
  return hasOmniFileContext(attachments) ? 'harness' : mode;
}

export function toggleOmniPartnerMode(
  target: OmniTargetSelection,
  attachments: OmniAttachmentState,
): OmniTargetSelection {
  if (target.kind !== 'partner') return target;
  if (hasOmniFileContext(attachments)) {
    return target.mode === 'harness' ? target : { ...target, mode: 'harness' };
  }
  return {
    ...target,
    mode: target.mode === 'harness' ? 'zhiyu' : 'harness',
  };
}

export function addReadOnlyAttachmentPaths(
  current: OmniAttachmentState,
  paths: readonly string[],
): OmniAttachmentState {
  const seen = new Set(current.attachmentPaths);
  const merged = [...current.attachmentPaths];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return {
    ...current,
    attachmentPaths: merged,
  };
}

export function removeReadOnlyAttachmentPath(
  current: OmniAttachmentState,
  pathToRemove: string,
): OmniAttachmentState {
  return {
    ...current,
    attachmentPaths: current.attachmentPaths.filter((item) => item !== pathToRemove),
  };
}

export function bindWritableWorkspaceRoot(
  current: OmniAttachmentState,
  workspaceRoot: string,
): OmniAttachmentState {
  const trimmed = workspaceRoot.trim();
  if (!trimmed) return current;
  return {
    ...current,
    workspaceRoot: trimmed,
    workspaceWritable: true,
  };
}

export function clearWritableWorkspaceRoot(current: OmniAttachmentState): OmniAttachmentState {
  return {
    ...current,
    workspaceRoot: null,
    workspaceWritable: false,
  };
}

const PINNED_PARTNER_STORAGE_PREFIX = 'nimi.home.omni.pinnedPartner:';

export function readPinnedPartnerHandle(accountKey: string | null): string | null {
  if (!accountKey || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(`${PINNED_PARTNER_STORAGE_PREFIX}${accountKey}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writePinnedPartnerHandle(accountKey: string | null, agentHandle: string | null): void {
  if (!accountKey || typeof window === 'undefined') return;
  try {
    const key = `${PINNED_PARTNER_STORAGE_PREFIX}${accountKey}`;
    if (!agentHandle || !agentHandle.trim()) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, agentHandle.trim());
    }
  } catch {
    // Ignore storage quota/privacy failures.
  }
}

export function buildRouteAndSubmitRequest(input: {
  readonly requestId: string;
  readonly text: string;
  readonly agentHandle: string;
  readonly target: OmniTargetSelection;
  readonly attachments: OmniAttachmentState;
  readonly activeLightQa: OmniLightQaCardState | null;
  readonly selectedCandidateRef?: string;
}): RouteAndSubmitInputRequest {
  const explicitWorkSessionRef = input.target.kind === 'session'
    ? input.target.workSessionRef
    : '';
  const cardSourceSessionRef = input.activeLightQa && !explicitWorkSessionRef && !input.selectedCandidateRef
    ? input.activeLightQa.workSessionRef
    : '';
  const cardSourceMaxSeq = cardSourceSessionRef && input.activeLightQa
    ? String(input.activeLightQa.lastSeq)
    : '0';

  return {
    agentHandle: input.agentHandle,
    requestId: input.requestId,
    text: input.text,
    explicitWorkSessionRef,
    entrySurface: 'home_omni',
    workspaceRoot: input.attachments.workspaceRoot ?? '',
    workspaceWritable: input.attachments.workspaceWritable,
    attachmentPaths: [...input.attachments.attachmentPaths],
    cardSourceSessionRef,
    cardSourceMaxSeq,
    handoffBriefText: '',
    replyToMessageRef: '',
    delegationObjectId: '',
    selectedCandidateRef: input.selectedCandidateRef ?? '',
    trustTierHint: 'trusted',
  };
}

export function isAmbiguousRouteOutcome(response: RouteAndSubmitInputResponse): boolean {
  return response.outcome === RouteAndSubmitOutcome.AMBIGUOUS_CANDIDATES;
}

export function isLightQaRouteResponse(response: RouteAndSubmitInputResponse): boolean {
  return (
    response.outcome === RouteAndSubmitOutcome.ACCEPTED
    && (response.sessionKind === 'general_inbox' || response.ownerBodyKind === 'brain_inline')
  );
}

export function isPcWorkRouteResponse(response: RouteAndSubmitInputResponse): boolean {
  return (
    response.outcome === RouteAndSubmitOutcome.DEFERRED_BODY_OFFLINE
    || response.sessionKind === 'pc_work'
    || response.ownerBodyKind === 'pc_harness'
  );
}

export type ParsedBrainSessionEvent =
  | Readonly<{ kind: 'assistant_delta'; text: string; seq: number }>
  | Readonly<{ kind: 'assistant_done'; text: string; seq: number }>
  | Readonly<{ kind: 'error'; message: string; seq: number }>
  | Readonly<{ kind: 'other'; seq: number }>;

export function parseBrainSessionEvent(envelope: BrainSessionEventEnvelope): ParsedBrainSessionEvent {
  const seq = Number(envelope.seq || 0);
  let payload: Record<string, unknown> = {};
  if (envelope.payloadJson) {
    try {
      const parsed = JSON.parse(envelope.payloadJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
  }
  const eventType = String(envelope.eventType || '').toLowerCase();
  if (eventType.includes('delta') || eventType === 'assistant_chunk' || eventType === 'text_delta') {
    const text = typeof payload.delta === 'string'
      ? payload.delta
      : typeof payload.text === 'string'
        ? payload.text
        : '';
    return { kind: 'assistant_delta', text, seq };
  }
  if (eventType === 'assistant_message' || eventType === 'turn_completed' || eventType === 'completed') {
    const text = typeof payload.text === 'string'
      ? payload.text
      : typeof payload.content === 'string'
        ? payload.content
        : '';
    return { kind: 'assistant_done', text, seq };
  }
  if (eventType.includes('error') || eventType.includes('failed')) {
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : 'Request failed';
    return { kind: 'error', message, seq };
  }
  return { kind: 'other', seq };
}

export type ProjectedSessionAttention = Readonly<{
  id: string;
  workSessionRef: string;
  kind: 'pending_approval' | 'body_offline' | 'alarm' | 'interrupted';
  tone: 'warning' | 'danger' | 'info';
  title: string;
  remainingLabel: string | null;
}>;

export function formatRemainingApprovalTtl(expiresAtIso: string, nowMs: number): string | null {
  if (!expiresAtIso) return null;
  const expiresMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresMs)) return null;
  const diffMs = expiresMs - nowMs;
  if (diffMs <= 0) return null;
  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.max(1, Math.ceil(diffMs / 60_000));
  return `${minutes}m`;
}

/**
 * Projects reader-authorized Runtime WatchSessionOverview records into Home attention entries.
 * Expired approvals are automatically hidden (anti-entropy, 02 §2.3).
 * Home NEVER duplicates PC approval submit buttons — every item routes to focus `apps/harness`.
 */
export function projectSessionOverviewAttention(input: {
  readonly attentionItems: readonly PendingAttentionRecord[];
  readonly sessions: readonly WorkSessionRecord[];
  readonly carrierOnline: boolean;
  readonly nowMs?: number;
}): ProjectedSessionAttention[] {
  const nowMs = input.nowMs ?? Date.now();
  const sessionsByRef = new Map(input.sessions.map((item) => [item.workSessionRef, item]));
  const result: ProjectedSessionAttention[] = [];

  for (const item of input.attentionItems) {
    // Drop expired approvals automatically (02 §2.3 anti-entropy).
    if (item.expiresAt) {
      const expiresMs = Date.parse(item.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        continue;
      }
    }
    let summaryText = '';
    if (item.summaryJson) {
      try {
        const parsed = JSON.parse(item.summaryJson) as Record<string, unknown>;
        if (typeof parsed.title === 'string' && parsed.title.trim()) {
          summaryText = parsed.title.trim();
        } else if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summaryText = parsed.summary.trim();
        }
      } catch {
        summaryText = '';
      }
    }
    const session = sessionsByRef.get(item.workSessionRef);
    const title = summaryText || session?.title || item.workSessionRef;
    const kindRaw = String(item.attentionKind || '').toLowerCase();
    const isAlarm = kindRaw.includes('alarm') || kindRaw.includes('reminder');
    const isInterrupted = kindRaw.includes('interrupt') || kindRaw.includes('uncertain');
    result.push({
      id: `session-attention:${item.attentionId}`,
      workSessionRef: item.workSessionRef,
      kind: isAlarm ? 'alarm' : isInterrupted ? 'interrupted' : 'pending_approval',
      tone: isInterrupted ? 'danger' : isAlarm ? 'info' : 'warning',
      title,
      remainingLabel: formatRemainingApprovalTtl(item.expiresAt, nowMs),
    });
  }

  if (!input.carrierOnline) {
    for (const session of input.sessions) {
      if (session.ownerBodyKind === 'pc_harness' && session.status === 'queued_body_offline') {
        result.push({
          id: `session-offline:${session.workSessionRef}`,
          workSessionRef: session.workSessionRef,
          kind: 'body_offline',
          tone: 'info',
          title: session.title || session.workSessionRef,
          remainingLabel: null,
        });
      }
    }
  }

  return result;
}
