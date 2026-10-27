import { decodeNimiRuntimeAgentSourceContextStatus, isRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';
import { AgentLifecycleStatus, type LocalAgentRecord } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type PartnerDirectoryItem = Readonly<{
  localAgentRef: string;
  displayName: string;
  lifecycle: AgentLifecycleStatus;
  createdAt: string | null;
  sourceRef: CharacterSourceRefV3 | null;
  sourceReady: boolean;
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function projectPartnerRecord(record: LocalAgentRecord, accountId: string): PartnerDirectoryItem | null {
  if (record.ownerUserId !== accountId || !isRuntimeLocalAgentRef(record.localAgentRef)) throw new Error('Partner inventory identity is invalid.');
  if (record.lifecycleStatus === AgentLifecycleStatus.TERMINATED) return null;
  let sourceRef: CharacterSourceRefV3 | null = null;
  let sourceReady = false;
  if (record.sourceContextStatus) {
    try {
      const source = decodeNimiRuntimeAgentSourceContextStatus(record.sourceContextStatus);
      if (source.localAgentRef === record.localAgentRef) {
        sourceRef = source.sourceRef;
        sourceReady = source.ready;
      }
    } catch { /* Invalid optional provenance must not hide an owner inventory row. */ }
  }
  const createdAtMs = record.createdAt ? Number(record.createdAt.seconds) * 1000 + record.createdAt.nanos / 1e6 : NaN;
  return { localAgentRef: record.localAgentRef, displayName: record.displayName,
    lifecycle: record.lifecycleStatus, createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : null,
    sourceRef, sourceReady };
}

export const partnerDirectoryQueryKey = (accountId: string, realm: string) => ['home-partners', accountId, realm] as const;

export async function readPartnerDirectoryPage(sdk: DesktopRendererSdkPort, accountId: string, pageToken = '') {
  const page = await sdk.withRuntimeProtectedScopes(['runtime.agent.read'], options => sdk.accountProduct().agents.listAgents({
    lifecycleFilter: AgentLifecycleStatus.UNSPECIFIED, pageSize: 50, pageToken,
  }, options));
  if (page.nextPageToken && page.nextPageToken === pageToken) throw new Error('Partner inventory cursor did not advance.');
  return { items: page.agents.flatMap(record => {
    const item = projectPartnerRecord(record, accountId);
    return item ? [item] : [];
  }), nextPageToken: page.nextPageToken };
}

export async function readPartnerDirectoryForSource(sdk: DesktopRendererSdkPort, accountId: string) {
  const items: PartnerDirectoryItem[] = [];
  const seen = new Set<string>();
  let token = '';
  for (let page = 0; page < 50; page++) {
    const next = await readPartnerDirectoryPage(sdk, accountId, token);
    items.push(...next.items);
    if (!next.nextPageToken) return items;
    if (seen.has(next.nextPageToken)) throw new Error('Partner inventory cursor repeated.');
    seen.add(next.nextPageToken); token = next.nextPageToken;
  }
  throw new Error('Partner inventory is incomplete. Open My partners to continue.');
}

/** Stable association is display-only. Every action revalidates the selected LocalAgent. */
export function isSameCharacter(left: CharacterSourceRefV3 | null, right: CharacterSourceRefV3 | null): boolean {
  if (!left || !right || left.kind !== right.kind || left.id !== right.id || left.worldId !== right.worldId) return false;
  return left.kind === 'personaCharacter' && right.kind === 'personaCharacter'
    ? left.ownerAccountId === right.ownerAccountId
    : left.kind === 'worldCharacter' && right.kind === 'worldCharacter' && left.worldEntityRef.entityId === right.worldEntityRef.entityId;
}
