import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { PartnerDirectoryItem } from './partner-directory-model.js';

export type PartnerGalleryFilter = 'all' | 'world' | 'recent' | 'created';
export type PartnerGallerySort = 'newest' | 'oldest' | 'name';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function selectGalleryPartners(input: {
  partners: readonly PartnerDirectoryItem[];
  accountId: string;
  filter: PartnerGalleryFilter;
  sort: PartnerGallerySort;
  lastChats: ReadonlyMap<string, number | null>;
}) {
  return input.partners.filter(partner => {
    if (input.filter === 'world') return partner.sourceRef?.kind === 'worldCharacter';
    if (input.filter === 'created') return partner.sourceRef?.kind === 'personaCharacter' && partner.sourceRef.ownerAccountId === input.accountId;
    if (input.filter === 'recent') return input.lastChats.get(partner.localAgentRef) != null;
    return true;
  }).sort((left, right) => {
    if (input.filter === 'recent') return (input.lastChats.get(right.localAgentRef) ?? 0) - (input.lastChats.get(left.localAgentRef) ?? 0);
    if (input.sort === 'name') return left.displayName.localeCompare(right.displayName);
    // Unknown dates stay at the end in both directions.
    if (!left.createdAt) return right.createdAt ? 1 : 0;
    if (!right.createdAt) return -1;
    const order = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return input.sort === 'oldest' ? -order : order;
  });
}

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
