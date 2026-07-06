import type { ZhiyuEvidence } from './evidence';

export type ZhiyuDiagnosticItemKey =
  | 'runtime'
  | 'auth'
  | 'source'
  | 'inventory'
  | 'localAgent'
  | 'conversation'
  | 'route'
  | 'turn'
  | 'composer';

export type ZhiyuDiagnosticSeverity = 'ready' | 'pending' | 'blocked' | 'error';

export type ZhiyuDiagnosticItem = {
  readonly key: ZhiyuDiagnosticItemKey;
  readonly title: string;
  readonly ready: boolean;
  readonly severity: ZhiyuDiagnosticSeverity;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly traceId: string;
};

export type ZhiyuDiagnosticState = {
  readonly mode: 'ready' | 'probing' | 'blocked';
  readonly readyCount: number;
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly errorCount: number;
  readonly items: readonly ZhiyuDiagnosticItem[];
  readonly primaryBlocker: ZhiyuDiagnosticItem | null;
};

type EvidenceStatus = {
  readonly ready: boolean;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
};

export function projectZhiyuDiagnosticState(evidence: ZhiyuEvidence): ZhiyuDiagnosticState {
  const items: readonly ZhiyuDiagnosticItem[] = [
    diagnosticItem('runtime', 'Runtime', evidence.runtime),
    diagnosticItem('auth', '账户', evidence.auth),
    diagnosticItem('source', '来源投影', evidence.source),
    diagnosticItem('inventory', 'Agent 清单', evidence.inventory),
    diagnosticItem('localAgent', 'LocalAgent', evidence.localAgent),
    diagnosticItem('conversation', '会话锚点', evidence.conversation),
    diagnosticItem('route', '模型路由', evidence.route),
    diagnosticItem('turn', '回合通路', evidence.turn),
    diagnosticItem('composer', '输入状态', {
      ready: composerReady(evidence),
      reasonCode: evidence.composer.reasonCode,
      actionHint: evidence.composer.actionHint,
      source: evidence.composer.source,
      message: evidence.composer.message,
    }),
  ];
  const primaryBlocker = primaryBlockerFromItems(items);

  return {
    mode: diagnosticMode(items, primaryBlocker),
    readyCount: items.filter((item) => item.severity === 'ready').length,
    pendingCount: items.filter((item) => item.severity === 'pending').length,
    blockedCount: items.filter((item) => item.severity === 'blocked').length,
    errorCount: items.filter((item) => item.severity === 'error').length,
    items,
    primaryBlocker,
  };
}

function primaryBlockerFromItems(items: readonly ZhiyuDiagnosticItem[]): ZhiyuDiagnosticItem | null {
  const requiredBlocker = items.find((item) => item.key !== 'composer' && !item.ready);
  if (requiredBlocker) {
    return requiredBlocker;
  }
  const composer = items.find((item) => item.key === 'composer');
  return composer?.severity === 'error' ? composer : null;
}

function diagnosticItem(
  key: ZhiyuDiagnosticItemKey,
  title: string,
  status: EvidenceStatus,
): ZhiyuDiagnosticItem {
  const severity = diagnosticSeverity(status);
  return {
    key,
    title,
    ready: status.ready,
    severity,
    reasonCode: status.reasonCode,
    actionHint: status.actionHint,
    source: status.source,
    message: status.message,
    traceId: `zhiyu.diagnostics.${key}.${status.reasonCode}`,
  };
}

function diagnosticSeverity(status: EvidenceStatus): ZhiyuDiagnosticSeverity {
  if (status.ready) {
    return 'ready';
  }
  if (status.reasonCode === 'not-probed') {
    return 'pending';
  }
  if (isErrorReason(status.reasonCode)) {
    return 'error';
  }
  return 'blocked';
}

function diagnosticMode(
  items: readonly ZhiyuDiagnosticItem[],
  primaryBlocker: ZhiyuDiagnosticItem | null,
): ZhiyuDiagnosticState['mode'] {
  const requiredItems = items.filter((item) => item.key !== 'composer');
  if (requiredItems.every((item) => item.ready) && primaryBlocker?.key === 'composer') {
    return primaryBlocker.severity === 'error' ? 'blocked' : 'ready';
  }
  if (!primaryBlocker) {
    return 'ready';
  }
  return primaryBlocker.severity === 'pending' ? 'probing' : 'blocked';
}

function composerReady(evidence: ZhiyuEvidence): boolean {
  if (evidence.composer.submitState === 'failed' || evidence.composer.submitState === 'submitting') {
    return false;
  }
  return (
    evidence.conversation.ready
    && evidence.route.ready
    && (evidence.composer.submitState === 'ready' || evidence.composer.submitState === 'accepted')
  );
}

function isErrorReason(reasonCode: string): boolean {
  return [
    'unavailable',
    'denied',
    'forbidden',
    'failed',
    'invalid',
  ].some((token) => reasonCode.includes(token));
}
