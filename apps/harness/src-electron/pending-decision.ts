import { createHash } from 'node:crypto';
import { LiveDoc, ROOT_CONVERSATION_ID, ToolTask, type EntryId, type Tx } from '@earendil-works/pi-durable';
import { isJsonObject } from '@nimiplatform/sdk/types';
import { isControlPlanePath, sanitizeBidi } from './security-policy.js';
import { textPreview } from './text-preview.js';

export const DEFAULT_APPROVAL_TTL_MS = 48 * 60 * 60 * 1000; // 48h within v2.1 24-72h TTL policy

export type DecisionDiffPreview = {
  kind: 'write' | 'edit' | 'command';
  path?: string;
  content?: string;
  command?: string;
  replacements?: { oldText: string; newText: string }[];
  truncated?: boolean;
};

type Review = {
  state: 'review';
  taskId: number;
  callId: string;
  revision: string;
  tool: string;
  title?: string;
  summary?: string;
  argumentsJson: string;
  diffPreview?: DecisionDiffPreview;
  allowSessionPermitted: boolean;
  isControlPlane: boolean;
  isFreeShell: boolean;
  remoteApprovalAllowed: boolean;
  expiresAt: number;
  recentAiEditedWarning?: string[];
};
export type PendingDecision = { state: 'none' } | { state: 'open-on-pc'; tool: string; reason?: string } | Review;

const PC_ONLY_OUTBOUND_TOOLS = new Set([
  'invoke_nimi_integration',
  'share_result_file',
  'web_fetch',
]);

function buildDecisionMetadata(
  tool: string,
  args: Record<string, unknown>,
  workspaceRoot?: string,
): {
  title: string;
  summary: string;
  diffPreview?: DecisionDiffPreview;
  isControlPlane: boolean;
  isFreeShell: boolean;
  isPcOnlyOutbound: boolean;
} {
  const rawPath = typeof args.path === 'string' ? args.path : undefined;
  const displayPath = rawPath ? sanitizeBidi(rawPath) : undefined;
  const controlPlane = rawPath ? isControlPlanePath(rawPath, workspaceRoot) : false;
  const freeShell = tool === 'bash' || tool === 'powershell';
  const isPcOnlyOutbound = PC_ONLY_OUTBOUND_TOOLS.has(tool);

  if (tool === 'write' && displayPath && typeof args.content === 'string') {
    const clean = sanitizeBidi(args.content);
    const preview = textPreview(clean, 32768);
    return {
      title: controlPlane ? `Write control-plane file ${displayPath}` : `Write ${displayPath}`,
      summary: `Create or replace ${displayPath} (${clean.length} chars)`,
      diffPreview: { kind: 'write', path: displayPath, content: preview.text, truncated: preview.truncated },
      isControlPlane: controlPlane,
      isFreeShell: false,
      isPcOnlyOutbound: false,
    };
  }
  if (tool === 'edit' && displayPath && Array.isArray(args.edits)) {
    let truncated = args.edits.length > 20;
    const replacements = args.edits
      .filter((item): item is { oldText: string; newText: string } =>
        isJsonObject(item) && typeof item.oldText === 'string' && typeof item.newText === 'string')
      .slice(0, 20)
      .map(item => {
        const oldP = textPreview(sanitizeBidi(item.oldText), 8192);
        const newP = textPreview(sanitizeBidi(item.newText), 8192);
        if (oldP.truncated || newP.truncated) truncated = true;
        return { oldText: oldP.text, newText: newP.text };
      });
    return {
      title: controlPlane ? `Edit control-plane file ${displayPath}` : `Edit ${displayPath}`,
      summary: `Apply ${replacements.length} replacement${replacements.length === 1 ? '' : 's'} to ${displayPath}`,
      ...(replacements.length ? { diffPreview: { kind: 'edit' as const, path: displayPath, replacements, truncated } } : {}),
      isControlPlane: controlPlane,
      isFreeShell: false,
      isPcOnlyOutbound: false,
    };
  }
  if (freeShell && typeof args.command === 'string') {
    const cleanCmd = sanitizeBidi(args.command);
    const firstLine = cleanCmd.trim().split(/\r?\n/)[0] ?? '';
    const cmdPreview = textPreview(cleanCmd, 16384);
    return {
      title: tool === 'powershell' ? 'Run PowerShell command (allow once)' : 'Run shell command (allow once)',
      summary: textPreview(firstLine, 160).text,
      diffPreview: { kind: 'command', command: cmdPreview.text, truncated: cmdPreview.truncated },
      isControlPlane: false,
      isFreeShell: true,
      isPcOnlyOutbound: false,
    };
  }
  if (tool === 'web_fetch' && typeof args.url === 'string') {
    return { title: 'Fetch web URL', summary: textPreview(sanitizeBidi(args.url), 200).text, isControlPlane: false, isFreeShell: false, isPcOnlyOutbound: true };
  }
  if ((tool === 'invoke_nimi_integration' || tool === 'read_nimi_integration') && typeof args.operation === 'string') {
    return { title: `Run integration: ${sanitizeBidi(args.operation)}`, summary: `Target ${sanitizeBidi(String(args.targetRef ?? ''))}`, isControlPlane: false, isFreeShell: false, isPcOnlyOutbound };
  }
  if (tool === 'transcribe_audio' && displayPath) {
    return { title: 'Transcribe audio', summary: displayPath, isControlPlane: false, isFreeShell: false, isPcOnlyOutbound: false };
  }
  if (tool === 'share_result_file' && typeof args.filename === 'string') {
    return { title: 'Share result file', summary: sanitizeBidi(args.filename), isControlPlane: false, isFreeShell: false, isPcOnlyOutbound: true };
  }
  return { title: `Allow ${sanitizeBidi(tool)}`, summary: sanitizeBidi(tool), isControlPlane: controlPlane, isFreeShell: freeShell, isPcOnlyOutbound };
}

export function sanitizeDecisionArgsForDisplay(args: Record<string, unknown>): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeBidi(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[sanitizeBidi(k)] = visit(v);
      }
      return out;
    }
    return value;
  };
  return visit(args) as Record<string, unknown>;
}

// Gate 5: Trusted approval card directly derived from durable pi-durable toolCall payload.
// Revision hash & 32 KiB cap are computed strictly on RAW canonical argumentsJson BEFORE Bidi stripping;
// remote approval requires <= 32 KiB, 100% untruncated diff, zero hidden Bidi/zero-width chars,
// non-control-plane, non-shell, and non-outbound.
export async function readPendingDecision(
  tx: Tx,
  sessionId: string,
  decisionSignal: string,
  options?: {
    taskId?: number;
    recentAiEditedPaths?: readonly string[];
    nowMs?: number;
    allowLargeLocal?: boolean;
    workspaceRoot?: string;
  },
): Promise<PendingDecision> {
  const live = await tx.doc(LiveDoc, ROOT_CONVERSATION_ID);
  const nowMs = options?.nowMs ?? Date.now();
  for (const slot of live.tools ?? []) {
    if (!slot.taskId || slot.status !== 'sleeping') continue;
    if (options?.taskId !== undefined && slot.taskId !== options.taskId) continue;
    const task = await tx.task(slot.taskId);
    if (!task || task.kind !== ToolTask.definition.name || task.abortRequested || task.state.status !== 'sleeping'
      || !task.state.signals?.some(wait => wait.signal === decisionSignal && wait.key === 'decision')) continue;
    const input = task.input;
    if (!isJsonObject(input) || input.kind !== 'model' || typeof input.assistant !== 'number' || input.callId !== slot.callId) continue;
    const entry = await tx.entry(input.assistant as EntryId);
    const message = entry?.model?.[0];
    const call = message?.role === 'assistant' ? message.content.find(item => item.type === 'toolCall' && item.id === slot.callId) : undefined;
    if (call?.type !== 'toolCall') continue;
    const rawArgumentsJson = JSON.stringify(call.arguments ?? {});
    const exceedsRemoteCap = Buffer.byteLength(rawArgumentsJson, 'utf8') > 32768;
    if (exceedsRemoteCap && !options?.allowLargeLocal) {
      return { state: 'open-on-pc', tool: call.name, reason: 'payload_exceeds_32kib' };
    }
    // Bind revision CAS strictly to RAW canonical arguments bytes (never post-sanitization!).
    const revision = createHash('sha256').update(JSON.stringify([sessionId, task.id, call.id, call.name, rawArgumentsJson])).digest('hex');
    const displayArgumentsJson = sanitizeBidi(rawArgumentsJson);
    const hasHiddenBidi = displayArgumentsJson !== rawArgumentsJson || sanitizeBidi(call.name) !== call.name;
    const meta = buildDecisionMetadata(call.name, (call.arguments ?? {}) as Record<string, unknown>, options?.workspaceRoot);
    const createdAt = typeof message?.timestamp === 'number' && message.timestamp > 0
      ? message.timestamp
      : typeof (task as { createdAt?: number }).createdAt === 'number'
        ? (task as { createdAt?: number }).createdAt!
        : nowMs;
    const expiresAt = createdAt + DEFAULT_APPROVAL_TTL_MS;
    const allowSessionPermitted = !meta.isControlPlane && !meta.isFreeShell;
    const remoteApprovalAllowed = !exceedsRemoteCap
      && !hasHiddenBidi
      && !meta.isControlPlane
      && !meta.isFreeShell
      && !meta.isPcOnlyOutbound
      && !meta.diffPreview?.truncated;
    const recentWarning = meta.isFreeShell && options?.recentAiEditedPaths?.length
      ? [...options.recentAiEditedPaths]
      : undefined;

    return {
      state: 'review',
      taskId: task.id,
      callId: call.id,
      tool: sanitizeBidi(call.name),
      revision,
      title: meta.title,
      summary: meta.summary,
      argumentsJson: displayArgumentsJson,
      allowSessionPermitted,
      isControlPlane: meta.isControlPlane,
      isFreeShell: meta.isFreeShell,
      remoteApprovalAllowed,
      expiresAt,
      ...(recentWarning ? { recentAiEditedWarning: recentWarning } : {}),
      ...(meta.diffPreview ? { diffPreview: meta.diffPreview } : {}),
    };
  }
  return { state: 'none' };
}
