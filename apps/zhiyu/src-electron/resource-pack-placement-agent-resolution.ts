import type { RegisteredNimiElectronAppBridge } from '@nimiplatform/kit/shell/electron/main';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-041a
export async function resolveZhiyuResourcePackPlacementAgentHandle(
  localAppHost: RegisteredNimiElectronAppBridge['localAppHost'],
  conversationAnchorId: string,
): Promise<Readonly<
  | { status: 'ready'; agentHandle: string }
  | { status: 'failed'; reasonCode: 'destination-session-failed' | 'agent-resolution-failed' }
>> {
  let references: Awaited<ReturnType<typeof localAppHost.agentReferenceList>>;
  try {
    references = await localAppHost.agentReferenceList();
  } catch {
    return { status: 'failed', reasonCode: 'destination-session-failed' };
  }
  const probes = await Promise.allSettled(references.map(async (reference) => {
    const agentHandle = exactHostText(reference.agentHandle, 'agent-handle');
    try {
      const snapshot = await localAppHost.conversationSnapshot({ agentHandle, conversationAnchorId });
      return snapshot.conversationAnchorId === conversationAnchorId ? agentHandle : null;
    } catch (error) {
      if (isAgentSelectorMismatch(error)) return null;
      throw error;
    }
  }));
  const failed = probes.find((probe): probe is PromiseRejectedResult => probe.status === 'rejected');
  if (failed) return { status: 'failed', reasonCode: 'destination-session-failed' };
  const matches = probes
    .filter((probe): probe is PromiseFulfilledResult<string | null> => probe.status === 'fulfilled')
    .map((probe) => probe.value)
    .filter((handle): handle is string => handle !== null);
  if (matches.length !== 1) return { status: 'failed', reasonCode: 'agent-resolution-failed' };
  return { status: 'ready', agentHandle: matches[0]! };
}

function isAgentSelectorMismatch(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reason = String(record.reasonCode ?? record.code ?? '');
  return reason === 'LOCAL_APP_ACCESS_DENIED'
    || reason === 'SDK_LOCAL_APP_AGENT_SELECTOR_MISMATCH'
    || reason === 'local-app-agent-selector-mismatch';
}

function exactHostText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== value || text.length > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`zhiyu-resource-pack-placement-${field}-invalid`);
  }
  return text;
}
