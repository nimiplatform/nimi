import {
  characterSourceAmbiguousMessage,
  characterSourceMaterializationMessage,
  discoverCharacterSourceLocalAgents,
  materializeCharacterSourceLocalAgent,
  resolveCharacterSourceRefV3,
} from '../explore/character-source-materialization';
import { isSameCharacter, readPartnerDirectoryForSource } from '../agents/partner-directory-model.js';
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

export class CharacterSourceConfirmationPendingError extends Error {
  constructor(message: string, readonly localAgentRef: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CharacterSourceConfirmationPendingError';
  }
}

/** Re-read a committed partner without issuing another materialization request. */
export async function confirmCharacterSourceMaterialized(
  source: CharacterSourceMaterializationInput,
  ownerUserIdInput: string | null | undefined,
  t: TFunction,
  sdk: DesktopRendererSdkPort,
  isCurrent: () => boolean,
  expectedLocalAgentRef: string,
): Promise<void> {
  if (!isCurrent()) throw new Error('Source action expired');
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef) throw new Error(characterSourceMaterializationMessage(t));
  const committed = await discoverCharacterSourceLocalAgents({ sourceRef }, ownerUserId, sdk);
  if (!isCurrent()) throw new Error('Source action expired');
  if (!committed.some(agent => agent.localAgentRef === expectedLocalAgentRef)) {
    throw new Error(t('Explore.characterSourceRefreshPending', {
      defaultValue: 'Your partner was created, but the partner list couldn\'t be updated. Select Refresh partner to check—this won\'t create a duplicate.',
    }));
  }
}

/**
 * Ensures one Runtime-owned LocalAgent exists for a canonical Realm source.
 * Returns the confirmed local reference for Home's partner management position.
 * It does not resolve an App handle or create a Conversation.
 */
export async function ensureCharacterSourceMaterialized(
  source: CharacterSourceMaterializationInput,
  ownerUserIdInput: string | null | undefined,
  t: TFunction,
  sdk: DesktopRendererSdkPort,
  isCurrent: () => boolean,
): Promise<string> {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Source action expired'); };
  assertCurrent();
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef) {
    throw new Error('character source materialization requires hash-bearing sourceRef');
  }
  const inventory = await readPartnerDirectoryForSource(sdk, ownerUserId);
  const existing = inventory.filter(partner => isSameCharacter(partner.sourceRef, sourceRef));
  assertCurrent();
  if (existing.length > 1) {
    throw new Error(characterSourceAmbiguousMessage(t));
  }
  if (existing.length === 1) return existing[0]!.localAgentRef;
  if (inventory.some(partner => !partner.sourceRef)) throw new Error(characterSourceMaterializationMessage(t));

  const created = await materializeCharacterSourceLocalAgent({ sourceRef }, t, sdk);
  assertCurrent();
  try {
    await confirmCharacterSourceMaterialized(source, ownerUserId, t, sdk, isCurrent, created.localAgentRef);
  } catch (error) {
    assertCurrent();
    throw new CharacterSourceConfirmationPendingError(t('Explore.characterSourceRefreshPending', {
      defaultValue: 'Your partner was created, but the partner list couldn\'t be updated. Select Refresh partner to check—this won\'t create a duplicate.',
    }), created.localAgentRef, error);
  }
  return created.localAgentRef;
}
