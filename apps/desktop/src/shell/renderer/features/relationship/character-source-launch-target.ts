import {
  characterSourceAmbiguousMessage,
  discoverCharacterSourceLocalAgents,
  materializeCharacterSourceLocalAgent,
  resolveCharacterSourceRefV3,
} from '../explore/character-source-materialization';
import type { TFunction } from 'i18next';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type CharacterSourceMaterializationInput = {
  id: string;
  displayName?: string;
  name?: string;
  handle: string;
  avatarUrl?: string | null;
  bio: string | null;
  worldId?: string | null;
  worldName?: string | null;
  sourceWorldId?: string | null;
  sourceKind?: CharacterSourceRefV3['kind'] | null;
  sourceId?: string | null;
  sourceHash?: string | null;
  sourceRef?: CharacterSourceRefV3 | null;
};

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`character source materialization requires ${field}`);
  }
  return normalized;
}

/**
 * Ensures one Runtime-owned LocalAgent exists for a canonical Realm source.
 * Raw Runtime identity remains inside the materialization/discovery adapters;
 * this product seam returns no identity and callers refresh the canonical
 * LocalApp Agent reference list before the user selects a Conversation.
 */
export async function ensureCharacterSourceMaterialized(
  source: CharacterSourceMaterializationInput,
  ownerUserIdInput: string | null | undefined,
  t: TFunction,
  sdk: DesktopRendererSdkPort,
): Promise<void> {
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef) {
    throw new Error('character source materialization requires hash-bearing sourceRef');
  }
  const existing = await discoverCharacterSourceLocalAgents({ sourceRef }, ownerUserId, sdk);
  if (existing.length > 1) {
    throw new Error(characterSourceAmbiguousMessage(t));
  }
  if (existing.length === 1) return;

  await materializeCharacterSourceLocalAgent({ sourceRef }, t, sdk);
  const committed = await discoverCharacterSourceLocalAgents({ sourceRef }, ownerUserId, sdk);
  if (committed.length > 1) {
    throw new Error(characterSourceAmbiguousMessage(t));
  }
  if (committed.length !== 1) {
    throw new Error('Runtime materialization committed without one discoverable LocalAgent projection.');
  }
}
