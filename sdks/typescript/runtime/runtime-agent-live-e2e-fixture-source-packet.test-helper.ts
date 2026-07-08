import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { NimiRealmSourceMaterializationPacket } from '../realm/social';
import {
  OWNER_USER_ID,
  SOURCE_PACKET_HMAC_SECRET,
  SOURCE_REF,
  normalizeText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

export function createFixtureSourceMaterializationPacket(
  sourceRef: Record<string, unknown>,
  audience: string,
): NimiRealmSourceMaterializationPacket {
  const kind = normalizeText(sourceRef.kind) || SOURCE_REF.kind;
  const worldId = normalizeText(sourceRef.worldId) || SOURCE_REF.worldId;
  const sourceId = normalizeText(sourceRef.sourceId) || SOURCE_REF.sourceId;
  const sourceContentHash = normalizeText(sourceRef.sourceContentHash) || SOURCE_REF.sourceContentHash;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const nonce = randomUUID();
  const runtimeSourceRef = `runtime-source:${kind}:${worldId}:${sourceId}:${sourceContentHash}`;
  const payloadSchema = kind === 'realmPersona'
    ? 'realm.persona/v1'
    : 'realm.world-character-core/v1';

  const unsigned = {
    packetSchemaVersion: 'realm.source-materialization-packet/v1',
    packetId: `packet-${nonce}`,
    sourceKind: kind,
    sourceId,
    sourceWorldId: worldId,
    sourceContentRevision: 7,
    sourceContentHash,
    issuedAt,
    expiresAt,
    nonce,
    intendedRuntimeAudience: audience,
    runtimeSourceRef,
    sourceDisplayMetadata: {
      worldName: 'Runtime Live World',
      identity: {
        name: 'Runtime Live Source',
      },
    },
    payload: {
      sourceRef: {
        kind,
        worldId,
        sourceId,
        sourceContentHash,
      },
      schemaVersion: payloadSchema,
      contentRevision: 7,
      contentHash: sourceContentHash,
      core: {
        identity: {
          name: 'Runtime Live Source',
        },
      },
    },
  };

  const packetHash = hashCanonicalJSON(unsigned);
  const packetProof = signPacketProof(packetHash, OWNER_USER_ID, nonce, audience);
  return {
    ...unsigned,
    packetHash,
    packetProof,
  } as NimiRealmSourceMaterializationPacket;
}

function signPacketProof(
  packetHash: string,
  ownerId: string,
  nonce: string,
  intendedRuntimeAudience: string,
): string {
  const proofPayloadHash = hashCanonicalJSON({
    packetHash,
    ownerId,
    nonce,
    intendedRuntimeAudience,
  });
  return `hmac-sha256:${createHmac('sha256', SOURCE_PACKET_HMAC_SECRET).update(proofPayloadHash).digest('hex')}`;
}

function hashCanonicalJSON(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex');
}

function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonical JSON received a non-finite number');
    }
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJSON(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJSON(record[key])}`
    ).join(',')}}`;
  }
  throw new Error(`canonical JSON received non-JSON value ${typeof value}`);
}
