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

function buildDecisionMetadata(tool: string, args: Record<string, unknown>): {
  title: string;
  summary: string;
  diffPreview?: DecisionDiffPreview;
  isControlPlane: boolean;
  isFreeShell: boolean;
} {
  const path = typeof args.path === 'string' ? sanitizeBidi(args.path) : undefined;
  const controlPlane = path ? isControlPlanePath(path) : false;
  const freeShell = tool === 'bash' || tool === 'powershell';

  if (tool === 'write' && path && typeof args.content === 'string') {
    const clean = sanitizeBidi(args.content);
    const preview = textPreview(clean, 32768);
    return {
      title: controlPlane ? `Write control-plane file ${path}` : `Write ${path}`,
      summary: `Create or replace ${path} (${clean.length} chars)`,
      diffPreview: { kind: 'write', path, content: preview.text, truncated: preview.truncated },
      isControlPlane: controlPlane,
      isFreeShell: false,
    };
  }
  if (tool === 'edit' && path && Array.isArray(args.edits)) {
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
      title: controlPlane ? `Edit control-plane file ${path}` : `Edit ${path}`,
      summary: `Apply ${replacements.length} replacement${replacements.length === 1 ? '' : 's'} to ${path}`,
      ...(replacements.length ? { diffPreview: { kind: 'edit' as const, path, replacements, truncated } } : {}),
      isControlPlane: controlPlane,
      isFreeShell: false,
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
    };
  }
  if (tool === 'web_fetch' && typeof args.url === 'string') {
    return { title: 'Fetch web URL', summary: textPreview(sanitizeBidi(args.url), 200).text, isControlPlane: false, isFreeShell: false };
  }
  if ((tool === 'invoke_nimi_integration' || tool === 'read_nimi_integration') && typeof args.operation === 'string') {
    return { title: `Run integration: ${sanitizeBidi(args.operation)}`, summary: `Target ${sanitizeBidi(String(args.targetRef ?? ''))}`, isControlPlane: false, isFreeShell: false };
  }
  if (tool === 'transcribe_audio' && path) {
    return { title: 'Transcribe audio', summary: path, isControlPlane: false, isFreeShell: false };
  }
  if (tool === 'share_result_file' && typeof args.filename === 'string') {
    return { title: 'Share result file', summary: sanitizeBidi(args.filename), isControlPlane: false, isFreeShell: false };
  }
  return { title: `Allow ${sanitizeBidi(tool)}`, summary: sanitizeBidi(tool), isControlPlane: controlPlane, isFreeShell: freeShell };
}

// Gate 5: Trusted approval card directly derived from durable pi-durable toolCall payload.
// Remote approval requires <= 32 KiB, 100% untruncated diff, Bidi-cleaned, and non-high-risk.
export async function readPendingDecision(
  tx: Tx,
  sessionId: string,
  decisionSignal: string,
  options?: { recentAiEditedPaths?: readonly string[]; nowMs?: number; allowLargeLocal?: boolean },
): Promise<PendingDecision> {
  const live = await tx.doc(LiveDoc, ROOT_CONVERSATION_ID);
  const nowMs = options?.nowMs ?? Date.now();
  for (const slot of live.tools ?? []) {
    if (!slot.taskId || slot.status !== 'sleeping') continue;
    const task = await tx.task(slot.taskId);
    if (!task || task.kind !== ToolTask.definition.name || task.abortRequested || task.state.status !== 'sleeping'
      || !task.state.signals?.some(wait => wait.signal === decisionSignal && wait.key === 'decision')) continue;
    const input = task.input;
    if (!isJsonObject(input) || input.kind !== 'model' || typeof input.assistant !== 'number' || input.callId !== slot.callId) continue;
    const entry = await tx.entry(input.assistant as EntryId);
    const message = entry?.model?.[0];
    const call = message?.role === 'assistant' ? message.content.find(item => item.type === 'toolCall' && item.id === slot.callId) : undefined;
    if (call?.type !== 'toolCall') continue;
    const argumentsJson = sanitizeBidi(JSON.stringify(call.arguments));
    const exceedsRemoteCap = Buffer.byteLength(argumentsJson, 'utf8') > 32768;
    if (exceedsRemoteCap && !options?.allowLargeLocal) {
      return { state: 'open-on-pc', tool: call.name, reason: 'payload_exceeds_32kib' };
    }
    const revision = createHash('sha256').update(JSON.stringify([sessionId, task.id, call.id, call.name, argumentsJson])).digest('hex');
    const meta = buildDecisionMetadata(call.name, call.arguments as Record<string, unknown>);
    const createdAt = typeof message?.timestamp === 'number' && message.timestamp > 0
      ? message.timestamp
      : typeof (task as { createdAt?: number }).createdAt === 'number'
        ? (task as { createdAt?: number }).createdAt!
        : nowMs;
    const expiresAt = createdAt + DEFAULT_APPROVAL_TTL_MS;
    const allowSessionPermitted = !meta.isControlPlane && !meta.isFreeShell;
    const remoteApprovalAllowed = !exceedsRemoteCap && !meta.isControlPlane && !meta.isFreeShell && !meta.diffPreview?.truncated;
    const recentWarning = meta.isFreeShell && options?.recentAiEditedPaths?.length
      ? [...options.recentAiEditedPaths]
      : undefined;

    return {
      state: 'review',
      taskId: task.id,
      callId: call.id,
      tool: call.name,
      revision,
      title: meta.title,
      summary: meta.summary,
      argumentsJson,
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
