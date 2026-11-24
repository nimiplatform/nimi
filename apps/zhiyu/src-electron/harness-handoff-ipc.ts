// Shared strict IPC handler for Zhiyu -> Harness controlled handoff briefs.
// Registered in BOTH standalone apps/zhiyu/src-electron/main.ts and Desktop's
// bundled-zhiyu-host.ts so both carriers enforce identical sender, DTO, and
// honest outcome contracts.
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.harness-brief-handoff
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { NimiLocalAppAgentSessionClient } from '@nimiplatform/sdk/app';

export const ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL = 'nimi:zhiyu:harness-handoff:submit';

const ZHIYU_HANDOFF_ALLOWED_KEYS = new Set(['agentHandle', 'requestId', 'text', 'handoffBriefText']);
const DISALLOWED_TEXT_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;

export type ZhiyuHarnessHandoffOutcome =
  | 'ACCEPTED'
  | 'AMBIGUOUS_CANDIDATES'
  | 'DEFERRED_BODY_OFFLINE'
  | 'UNSPECIFIED';

export interface ZhiyuHarnessHandoffIpcResult {
  readonly outcome: ZhiyuHarnessHandoffOutcome;
  readonly resolvedWorkSessionRef: string;
  readonly sessionKind: string;
  readonly ownerBodyKind: string;
  readonly routeReason: string;
  readonly deduplicated: boolean;
}

function normalizeRouteOutcome(raw: unknown): ZhiyuHarnessHandoffOutcome {
  if (raw === 1 || raw === 'ROUTE_AND_SUBMIT_OUTCOME_ACCEPTED' || raw === 'ACCEPTED') {
    return 'ACCEPTED';
  }
  if (raw === 2 || raw === 'ROUTE_AND_SUBMIT_OUTCOME_AMBIGUOUS_CANDIDATES' || raw === 'AMBIGUOUS_CANDIDATES') {
    return 'AMBIGUOUS_CANDIDATES';
  }
  if (raw === 3 || raw === 'ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE' || raw === 'DEFERRED_BODY_OFFLINE') {
    return 'DEFERRED_BODY_OFFLINE';
  }
  return 'UNSPECIFIED';
}

export function validateZhiyuHandoffBriefPayload(rawPayload: unknown): {
  readonly agentHandle: string;
  readonly requestId: string;
  readonly text: string;
  readonly handoffBriefText: string;
} {
  const record = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload as Record<string, unknown>
    : null;
  const keys = record ? Object.keys(record) : [];
  if (
    !record
    || keys.length !== ZHIYU_HANDOFF_ALLOWED_KEYS.size
    || keys.some((key) => !ZHIYU_HANDOFF_ALLOWED_KEYS.has(key))
    || typeof record.agentHandle !== 'string'
    || typeof record.requestId !== 'string'
    || typeof record.text !== 'string'
    || typeof record.handoffBriefText !== 'string'
  ) {
    throw new Error('zhiyu-handoff-invalid-brief');
  }
  const agentHandle = record.agentHandle.trim();
  const requestId = record.requestId.trim();
  const text = record.text.trim();
  const handoffBriefText = record.handoffBriefText.trim();
  if (
    !agentHandle || agentHandle.length > 256 || /[\x00-\x1f\x7f]/u.test(agentHandle)
    || !requestId || requestId.length > 128 || /[\x00-\x1f\x7f]/u.test(requestId)
    || text.length > 2000 || DISALLOWED_TEXT_CONTROL_RE.test(text)
    || !handoffBriefText || handoffBriefText.length > 4000 || DISALLOWED_TEXT_CONTROL_RE.test(handoffBriefText)
  ) {
    throw new Error('zhiyu-handoff-invalid-brief');
  }
  return { agentHandle, requestId, text, handoffBriefText };
}

export function registerZhiyuHarnessHandoffIpc(input: {
  readonly ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly authorizeSender: (event: IpcMainInvokeEvent) => boolean;
  readonly getAgentSessionClient: () => NimiLocalAppAgentSessionClient | undefined;
}): { dispose(): void } {
  input.ipcMain.handle(ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL, async (event, rawPayload: unknown): Promise<ZhiyuHarnessHandoffIpcResult> => {
    if (!input.authorizeSender(event)) {
      throw new Error('zhiyu-handoff-sender-unauthorized');
    }
    const client = input.getAgentSessionClient();
    if (!client) {
      throw new Error('zhiyu-host-not-ready');
    }
    const brief = validateZhiyuHandoffBriefPayload(rawPayload);
    const res = await client.routeAndSubmitInput({
      agentHandle: brief.agentHandle,
      requestId: brief.requestId,
      text: brief.text || brief.handoffBriefText.slice(0, 200),
      explicitWorkSessionRef: '',
      entrySurface: 'zhiyu_handoff',
      workspaceRoot: '',
      workspaceWritable: false,
      attachmentPaths: [],
      cardSourceSessionRef: '',
      cardSourceMaxSeq: '0',
      handoffBriefText: brief.handoffBriefText,
      replyToMessageRef: '',
      delegationObjectId: '',
      selectedCandidateRef: '',
      trustTierHint: 'trusted',
    });
    return {
      outcome: normalizeRouteOutcome(res.outcome),
      resolvedWorkSessionRef: res.resolvedWorkSessionRef,
      sessionKind: res.sessionKind,
      ownerBodyKind: res.ownerBodyKind,
      routeReason: res.routeReason,
      deduplicated: res.deduplicated,
    };
  });

  return {
    dispose() {
      input.ipcMain.removeHandler(ZHIYU_HARNESS_HANDOFF_SUBMIT_CHANNEL);
    },
  };
}
