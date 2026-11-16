import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { PartnerDirectoryItem } from './partner-directory-model.js';

/** Read conversation summaries only. Visiting/filtering the gallery never opens a chat. */
export async function readPartnerLastChat(sdk: DesktopRendererSdkPort, accountId: string, partner: PartnerDirectoryItem): Promise<number | null> {
  const consume = createNimiRuntimeAgentConsumeClient({ runtimeAppId: sdk.appId(), runtime: { agents: sdk.accountProduct().agents } });
  const seen = new Set<string>();
  let pageToken = '';
  do {
    const page = await sdk.withRuntimeProtectedScopes(['runtime.agent.read'], options => consume.anchors.listSummaries({
      ownerUserId: accountId, runtimeSourceRef: partner.runtimeSourceRef, localAgentRef: partner.localAgentRef,
      statusFilter: ['active'], pageSize: 50, pageToken,
    }, options));
    // Runtime returns summaries by recency. Empty, merely opened anchors are not chats.
    const latest = page.summaries.find(summary => summary.transcriptMessageCount > 0 && summary.updatedAt);
    if (latest?.updatedAt) return Number(latest.updatedAt.seconds) * 1000 + latest.updatedAt.nanos / 1e6;
    pageToken = page.nextPageToken ?? '';
    if (pageToken && seen.has(pageToken)) throw new Error('Partner conversation cursor did not advance.');
    seen.add(pageToken);
  } while (pageToken);
  return null;
}
