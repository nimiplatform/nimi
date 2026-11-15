import type { RuntimeTypedClient } from '../../core-generated/runtime-typed-client.js';
import type { NimiRuntimeAgentSourceRef } from '../../runtime/runtime-agent-context-projections.js';
import { toRuntimeCharacterSourceRefV3, strictMaterializationRequestId } from '../../runtime/runtime-materialization-input.js';
import type { CharacterSourceRefV3 } from '../../core-generated/runtime-protobuf/runtime/v1/agent_source_materialization.js';
import { createNimiLocalAppAgentReferencesClient, type NimiLocalAppAgentReference } from './local-app-runtime-platform-agent-references.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiAppCharacterSourceRef = NimiRuntimeAgentSourceRef;
export type NimiAppCharacterSource = Readonly<{
  sourceRef: NimiAppCharacterSourceRef; displayName: string; summary: string; worldName: string;
  avatarUrl: string | null; disposition: string; traits: readonly string[]; topics: readonly string[];
  connectable: boolean; existingPartner: NimiLocalAppAgentReference | null;
}>;
export type NimiAppCharacterQuery = { query?: string; cursor?: string; pageSize?: number };
export type NimiAppCharacterConnectInput = { sourceRef: NimiAppCharacterSourceRef; requestId: string };
export type NimiAppCharacterDiscoveryShell = {
  listCharacters(input: NimiAppCharacterQuery): Promise<unknown>;
  connectCharacter(input: NimiAppCharacterConnectInput): Promise<unknown>;
};
export type NimiAppCharacterDiscoveryClient = {
  listCharacters(input?: NimiAppCharacterQuery): Promise<{ items: readonly NimiAppCharacterSource[]; nextCursor: string }>;
  connectCharacter(input: NimiAppCharacterConnectInput): Promise<{ partner: NimiLocalAppAgentReference; created: boolean }>;
};

export function validateNimiAppCharacterQuery(input: NimiAppCharacterQuery): void {
  assertExactKeys(input, ['query', 'cursor', 'pageSize'], 'character query');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 256)
    || input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 4096)
    || input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50)) throw new Error('Invalid character query.');
}
export function validateNimiAppCharacterConnect(input: NimiAppCharacterConnectInput): void {
  assertExactKeys(input, ['sourceRef', 'requestId'], 'character acquisition');
  toRuntimeCharacterSourceRefV3(input.sourceRef);
  if (strictMaterializationRequestId(input.requestId).length > 128) throw new Error('Invalid request identity.');
}
const reference = async (value: unknown) => (await createNimiLocalAppAgentReferencesClient({ listReferences: async () => [value] }).listReferences())[0]!;

// @nimi-authority: rule.nimi.sdks.feature-clients.character-discovery
export function createNimiAppCharacterDiscoveryClient(shell: NimiAppCharacterDiscoveryShell): NimiAppCharacterDiscoveryClient {
  return Object.freeze({
    async listCharacters(input: NimiAppCharacterQuery = {}) {
      validateNimiAppCharacterQuery(input);
      const page = asRecord(await shell.listCharacters(input));
      assertExactProjectionKeys(page, ['items', 'nextCursor'], 'character catalog');
      if (!Array.isArray(page.items) || page.items.length > (input.pageSize ?? 20) || typeof page.nextCursor !== 'string' || page.nextCursor.length > 4096) localAppProjectionError('character catalog');
      const items = await Promise.all(page.items.map(async raw => {
        const item = asRecord(raw);
        assertExactProjectionKeys(item, ['sourceRef', 'displayName', 'summary', 'worldName', 'avatarUrl', 'disposition', 'traits', 'topics', 'connectable', 'existingPartner'], 'character source');
        toRuntimeCharacterSourceRefV3(item.sourceRef);
        for (const key of ['displayName', 'summary', 'worldName', 'disposition']) if (typeof item[key] !== 'string' || (item[key] as string).length > 16384) localAppProjectionError('character text');
        for (const key of ['traits', 'topics']) if (!Array.isArray(item[key]) || (item[key] as unknown[]).length > 64 || (item[key] as unknown[]).some(v => typeof v !== 'string' || v.length > 1024)) localAppProjectionError('character topics');
        if (typeof item.connectable !== 'boolean' || item.avatarUrl !== null && (typeof item.avatarUrl !== 'string' || !item.avatarUrl.startsWith('https://'))) localAppProjectionError('character source');
        return Object.freeze({ ...item, existingPartner: item.existingPartner === null ? null : await reference(item.existingPartner) }) as NimiAppCharacterSource;
      }));
      return { items: Object.freeze(items), nextCursor: page.nextCursor };
    },
    async connectCharacter(input: NimiAppCharacterConnectInput) {
      validateNimiAppCharacterConnect(input);
      const result = asRecord(await shell.connectCharacter(input));
      assertExactProjectionKeys(result, ['partner', 'created'], 'character acquisition');
      if (typeof result.created !== 'boolean') localAppProjectionError('character acquisition');
      return { partner: await reference(result.partner), created: result.created };
    },
  });
}

export function createNimiAppCharacterDiscoveryRuntimeClient(runtime: Pick<RuntimeTypedClient, 'listLocalAppCharacterSources' | 'connectLocalAppCharacterSource'>): NimiAppCharacterDiscoveryClient {
  const projectPartner = (value: NonNullable<Awaited<ReturnType<typeof runtime.connectLocalAppCharacterSource>>['partner']>) => ({ ...value, avatarUrl: value.avatarUrl ?? null });
  return createNimiAppCharacterDiscoveryClient({
    async listCharacters(input) {
      const page = await runtime.listLocalAppCharacterSources({ query: input.query ?? '', cursor: input.cursor ?? '', pageSize: input.pageSize ?? 20 });
      return { items: page.items.map(item => ({ ...item, sourceRef: publicSourceRef(item.sourceRef), avatarUrl: item.avatarUrl ?? null, existingPartner: item.existingPartner ? projectPartner(item.existingPartner) : null })), nextCursor: page.nextCursor };
    },
    async connectCharacter(input) {
      const result = await runtime.connectLocalAppCharacterSource({ sourceRef: toRuntimeCharacterSourceRefV3(input.sourceRef), requestId: input.requestId });
      if (!result.partner) localAppProjectionError('acquired partner');
      return { partner: projectPartner(result.partner), created: result.created };
    },
  });
}

function publicSourceRef(value: CharacterSourceRefV3 | undefined): NimiAppCharacterSourceRef {
  const source = value?.source;
  if (source?.oneofKind === 'worldCharacter') {
    const ref = source.worldCharacter;
    if (!ref.worldEntityRef) return localAppProjectionError('character source');
    return { kind: 'worldCharacter', id: ref.id, worldId: ref.worldId, sourceHash: ref.sourceHash, worldEntityRef: { kind: 'worldEntity', worldId: ref.worldEntityRef.worldId, entityId: ref.worldEntityRef.entityId } };
  }
  if (source?.oneofKind === 'personaCharacter') {
    const ref = source.personaCharacter;
    return { kind: 'personaCharacter', id: ref.id, worldId: ref.worldId, sourceHash: ref.sourceHash, ownerAccountId: ref.ownerAccountId };
  }
  return localAppProjectionError('character source');
}
