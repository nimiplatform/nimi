import fs from 'node:fs';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';

const PACKET_DOMAIN = 'nimi.realm.source-materialization-packet/v3\0';
const PROOF_DOMAIN = 'nimi.realm.source-materialization-proof/v3\0';
const SEGMENT_MANIFEST_DOMAIN = 'nimi.realm.materialization-segment-manifest/v3\0';
const COMPONENT_SET_DOMAIN = 'nimi.realm.materialization-component-set/v3\0';
const CLOSURE_SET_MANIFEST_DOMAIN = 'nimi.realm.materialization-closure-set-manifest/v3\0';
const AUTHORIZATION_DECISION_DOMAIN = 'nimi.realm.materialization-authorization-decision/v3\0';
const MATERIALIZATION_KEY_ID = 'desktop-realm-v3-fixture-rs256';
const ACCESS_POLICY_VERSION_DIGEST = '7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa';
const MATERIALIZATION_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048 });
const MATERIALIZATION_PUBLIC_JWK = MATERIALIZATION_KEYS.publicKey.export({ format: 'jwk' });

const worldReference = readReferencePacket('world-character');
const personaReference = readReferencePacket('persona-character');

export let FIXTURE_REALM_ISSUER = 'https://realm.desktop-v3-fixture.test';

export const FIXTURE_SOURCE_MATERIALIZATION_JWKS = Object.freeze({
  keys: [Object.freeze({
    kty: 'RSA',
    kid: MATERIALIZATION_KEY_ID,
    use: 'sig',
    alg: 'RS256',
    key_ops: ['verify'],
    n: MATERIALIZATION_PUBLIC_JWK.n,
    e: MATERIALIZATION_PUBLIC_JWK.e,
    purpose: 'realm-source-materialization',
  })],
});

export const FIXTURE_SOURCE_REF = Object.freeze(structuredClone(worldReference.sourceRef));
export const FIXTURE_PERSONA_SOURCE_REF = Object.freeze(structuredClone(personaReference.sourceRef));
export const FIXTURE_WORLD_CHARACTER = Object.freeze(structuredClone(worldReference.semanticPayload.canonicalSource));
export const FIXTURE_PERSONA_CHARACTER = Object.freeze(structuredClone(personaReference.semanticPayload.canonicalSource));
export const FIXTURE_WORLD_CORE = Object.freeze(structuredClone(
  worldReference.semanticPayload.materializationContext.owningWorld,
));
export const FIXTURE_BOUND_ENTITY = Object.freeze(structuredClone(
  worldReference.semanticPayload.materializationContext.dependencyClosure.boundEntity,
));

export function configureFixtureRealmIssuer(issuer) {
  const normalized = String(issuer || '').trim();
  if (!/^https?:\/\//u.test(normalized)) {
    throw new Error('fixture Realm issuer must be an absolute HTTP(S) origin');
  }
  FIXTURE_REALM_ISSUER = new URL(normalized).origin;
}

export function createFixtureSourceMaterializationTruthProjection() {
  const worldPacket = worldReference;
  const personaPacket = personaReference;
  return structuredClone({
    schemaVersion: 'nimi.local-agent-source-materialization-truth-projection/v2',
    world: {
      id: worldPacket.semanticPayload.materializationContext.owningWorld.id,
      core: worldPacket.semanticPayload.materializationContext.owningWorld.core,
    },
    worldCharacter: {
      id: worldPacket.semanticPayload.canonicalSource.id,
      worldId: worldPacket.semanticPayload.canonicalSource.worldId,
      profile: worldPacket.semanticPayload.canonicalSource.profile,
    },
    personaCharacter: {
      id: personaPacket.semanticPayload.canonicalSource.id,
      worldId: personaPacket.semanticPayload.canonicalSource.worldId,
      profile: personaPacket.semanticPayload.canonicalSource.profile,
    },
  });
}

export function createFixtureRealmCoreSeed(identitySuffix) {
  const suffix = String(identitySuffix || '').trim().replace(/[^a-zA-Z0-9-]/gu, '-').slice(-40);
  if (!suffix) throw new Error('fixture Realm core seed requires an identity suffix');

  const canonicalWorld = structuredClone(worldReference.semanticPayload.materializationContext.owningWorld);
  const canonicalEntity = structuredClone(
    worldReference.semanticPayload.materializationContext.dependencyClosure.boundEntity,
  );
  const canonicalCharacter = structuredClone(worldReference.semanticPayload.canonicalSource);
  const canonicalPersona = structuredClone(personaReference.semanticPayload.canonicalSource);
  const ids = {
    world: `world-local-agent-${suffix}`,
    entity: `entity-local-agent-${suffix}`,
    character: `character-local-agent-${suffix}`,
    persona: `persona-local-agent-${suffix}`,
  };
  const replacements = new Map([
    [canonicalWorld.id, ids.world],
    [canonicalEntity.id, ids.entity],
    [canonicalCharacter.id, ids.character],
    [canonicalPersona.id, ids.persona],
  ]);
  const replace = (value) => {
    if (typeof value === 'string') return replacements.get(value) || value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replace(nested)]));
    }
    return value;
  };
  const sanitizeProfile = (profile) => {
    const copy = replace(structuredClone(profile));
    copy.relationships = [];
    copy.assets = { ...copy.assets, resourceRefs: [], externalRefs: [] };
    delete copy.presentation.avatarResourceRef;
    delete copy.presentation.profileCoverResourceRef;
    return copy;
  };
  const worldCore = replace(canonicalWorld.core);
  worldCore.assets = { ...worldCore.assets, resourceRefs: [], externalRefs: [] };
  delete worldCore.presentation.iconResourceRef;
  delete worldCore.presentation.bannerResourceRef;
  worldCore.identity.name = `LocalAgent Product ${suffix}`;
  worldCore.presentation.title = `LocalAgent Product ${suffix}`;
  return {
    displayName: worldCore.identity.name,
    world: { id: ids.world, visibility: 'public', origin: canonicalWorld.origin, core: worldCore },
    entity: {
      id: ids.entity,
      kind: canonicalEntity.kind,
      origin: canonicalEntity.origin,
      core: replace(canonicalEntity.core),
    },
    character: {
      id: ids.character,
      visibility: 'public',
      origin: canonicalCharacter.origin,
      worldEntityRef: { kind: 'worldEntity', worldId: ids.world, entityId: ids.entity },
      profile: sanitizeProfile(canonicalCharacter.profile),
    },
    persona: {
      id: ids.persona,
      worldId: ids.world,
      visibility: 'public',
      origin: canonicalPersona.origin,
      profile: sanitizeProfile(canonicalPersona.profile),
    },
  };
}

export function createFixtureSourceMaterializationPacket(request) {
  assertFixtureRequest(request);
  const reference = request.sourceRef.kind === 'personaCharacter' ? personaReference : worldReference;
  const packetId = `packet-${randomUUID()}`;
  const issuedAt = new Date();
  const challengeExpiry = new Date(request.challengeExpiresAt);
  if (!Number.isFinite(challengeExpiry.getTime()) || challengeExpiry.getTime() <= issuedAt.getTime()) {
    throw new Error('Runtime source materialization challenge expiry is invalid');
  }

  const transport = rebuildTransport(reference, packetId, request.challengeDigest, request.publishedLimits);
  const unsignedEnvelope = {
    packetSchemaVersion: 'realm.source-materialization-packet/v3',
    packetId,
    issuer: FIXTURE_REALM_ISSUER,
    keyId: MATERIALIZATION_KEY_ID,
    algorithm: 'RS256',
    keyUse: 'sig',
    issuedAt: issuedAt.toISOString(),
    expiresAt: challengeExpiry.toISOString(),
    nonce: randomBytes(32).toString('base64url'),
    intendedRuntimeAudience: request.intendedRuntimeAudience,
    challengeId: request.challengeId,
    challengeDigest: request.challengeDigest,
    publishedLimits: request.publishedLimits,
    materializerAccountId: request.materializerAccountId,
    sourceRef: request.sourceRef,
    authorizationDecisionDigest: hashDomain(AUTHORIZATION_DECISION_DOMAIN, {
      decisionSchemaVersion: 'realm.materialization-authorization-decision/v3',
      sourceRef: request.sourceRef,
      materializerAccountId: request.materializerAccountId,
      authenticatedAccountId: request.materializerAccountId,
      scope: 'materialize',
      decidedAt: issuedAt.toISOString(),
      accessPolicyVersionDigest: ACCESS_POLICY_VERSION_DIGEST,
      visibilityDecision: 'allow',
      readinessDecision: 'allow',
      grant: 'allow',
    }),
    accessPolicyVersionDigest: ACCESS_POLICY_VERSION_DIGEST,
    materializationContextHash: reference.materializationContextHash,
    payloadHash: reference.payloadHash,
    closureSetManifestHash: transport.closureSetManifestHash,
  };
  const packetHash = hashDomain(PACKET_DOMAIN, unsignedEnvelope);
  return {
    ...unsignedEnvelope,
    packetHash,
    packetProof: signDetachedPacketHash(packetHash),
    semanticPayload: structuredClone(reference.semanticPayload),
    closureSetManifest: transport.closureSetManifest,
    orderedSegments: transport.orderedSegments,
  };
}

function readReferencePacket(name) {
  const file = new URL(
    `../../../../../packages/nimi-forge/conformance/source-materialization-v3/${name}.json`,
    import.meta.url,
  );
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== 'realm.reference-packet-v3-vector/v1'
      || parsed?.packet?.packetSchemaVersion !== 'realm.source-materialization-packet/v3') {
    throw new Error(`invalid current Realm v3 fixture vector: ${name}`);
  }
  return parsed.packet;
}

function rebuildTransport(reference, packetId, challengeDigest, limits) {
  const prepared = reference.orderedSegments.flatMap((segment) => segment.orderedComponents).map(
    (component, globalComponentOrdinal) => prepareComponent(component, globalComponentOrdinal, limits),
  );
  const partitions = [];
  let current = [];
  let currentBytes = 0;
  let currentChunks = 0;
  for (const component of prepared) {
    if (component.metadata.canonicalByteLength > limits.maxSegmentBytes
        || component.chunks.length > limits.maxSegmentChunks) {
      throw new Error(`fixture component exceeds published segment limits: ${component.metadata.componentId}`);
    }
    const overLimit = current.length > 0 && (
      current.length + 1 > limits.maxSegmentComponentCount
      || currentBytes + component.metadata.canonicalByteLength > limits.maxSegmentBytes
      || currentChunks + component.chunks.length > limits.maxSegmentChunks
    );
    if (overLimit) {
      partitions.push(current);
      current = [];
      currentBytes = 0;
      currentChunks = 0;
    }
    current.push(component);
    currentBytes += component.metadata.canonicalByteLength;
    currentChunks += component.chunks.length;
  }
  if (current.length > 0) partitions.push(current);

  let globalChunkOrdinal = 0;
  const segmentLimits = {
    maxSegmentBytes: limits.maxSegmentBytes,
    maxSegmentComponentCount: limits.maxSegmentComponentCount,
    maxChunkBytes: limits.maxChunkBytes,
    maxSegmentChunks: limits.maxSegmentChunks,
  };
  const orderedSegments = partitions.map((components, segmentOrdinal) => {
    const chunks = [];
    for (const component of components) {
      for (const chunk of component.chunks) {
        chunks.push({
          globalChunkOrdinal,
          globalComponentOrdinal: component.globalComponentOrdinal,
          componentOffset: chunk.componentOffset,
          length: chunk.length,
          chunkSha256: chunk.chunkSha256,
        });
        globalChunkOrdinal += 1;
      }
    }
    const firstComponentOrdinal = components[0].globalComponentOrdinal;
    const lastComponentOrdinal = components.at(-1).globalComponentOrdinal;
    const segmentManifest = {
      manifestSchemaVersion: 'realm.materialization-segment-manifest/v3',
      payloadAssemblyVersion: 'realm.materialization-assembly/v3',
      packetId,
      challengeDigest,
      segmentOrdinal,
      firstComponentOrdinal,
      lastComponentOrdinal,
      publishedSegmentLimits: segmentLimits,
      totalCanonicalBytes: components.reduce((sum, component) => sum + component.metadata.canonicalByteLength, 0),
      componentCount: components.length,
      chunkCount: chunks.length,
      components: components.map((component) => ({
        globalComponentOrdinal: component.globalComponentOrdinal,
        ...component.metadata,
      })),
      chunks,
    };
    return {
      segmentManifest,
      segmentManifestHash: hashDomain(SEGMENT_MANIFEST_DOMAIN, segmentManifest),
      orderedComponents: components.map((component) => ({
        ...component.metadata,
        canonicalBytes: component.canonicalBytes,
      })),
    };
  });
  const totalCanonicalBytes = prepared.reduce((sum, component) => sum + component.metadata.canonicalByteLength, 0);
  if (orderedSegments.length > limits.maxSetSegments
      || totalCanonicalBytes > limits.maxSetBytes
      || prepared.length > limits.maxSetComponentCount
      || globalChunkOrdinal > limits.maxSetChunks) {
    throw new Error('fixture closure set exceeds Runtime-published limits');
  }
  const closureSetManifest = {
    manifestSchemaVersion: 'realm.materialization-closure-set-manifest/v3',
    payloadAssemblyVersion: 'realm.materialization-assembly/v3',
    packetId,
    challengeDigest,
    publishedLimits: limits,
    orderedComponentSetHash: hashDomain(COMPONENT_SET_DOMAIN, prepared.map((component) => component.metadata)),
    totalCanonicalBytes,
    componentCount: prepared.length,
    chunkCount: globalChunkOrdinal,
    segmentCount: orderedSegments.length,
    segments: orderedSegments.map(({ segmentManifest, segmentManifestHash }) => ({
      segmentOrdinal: segmentManifest.segmentOrdinal,
      firstComponentOrdinal: segmentManifest.firstComponentOrdinal,
      lastComponentOrdinal: segmentManifest.lastComponentOrdinal,
      componentCount: segmentManifest.componentCount,
      totalCanonicalBytes: segmentManifest.totalCanonicalBytes,
      chunkCount: segmentManifest.chunkCount,
      segmentManifestHash,
    })),
  };
  return {
    orderedSegments,
    closureSetManifest,
    closureSetManifestHash: hashDomain(CLOSURE_SET_MANIFEST_DOMAIN, closureSetManifest),
  };
}

function prepareComponent(component, globalComponentOrdinal, limits) {
  const bytes = Buffer.concat(component.canonicalBytes.map((encoded) => Buffer.from(encoded, 'base64url')));
  if (sha256(bytes) !== component.canonicalBytesHash || bytes.byteLength !== component.canonicalByteLength) {
    throw new Error(`reference component bytes are corrupt: ${component.componentId}`);
  }
  const canonicalBytes = [];
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += limits.maxChunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(offset + limits.maxChunkBytes, bytes.byteLength));
    canonicalBytes.push(chunk.toString('base64url'));
    chunks.push({ componentOffset: offset, length: chunk.byteLength, chunkSha256: sha256(chunk) });
  }
  if (chunks.length === 0) throw new Error(`fixture component is empty: ${component.componentId}`);
  const metadata = Object.fromEntries(
    Object.entries(component).filter(([key]) => key !== 'canonicalBytes'),
  );
  return { globalComponentOrdinal, metadata, canonicalBytes, chunks };
}

function assertFixtureRequest(request) {
  const expected = request?.sourceRef?.kind === 'personaCharacter'
    ? FIXTURE_PERSONA_SOURCE_REF
    : FIXTURE_SOURCE_REF;
  if (canonicalJSON(request?.sourceRef) !== canonicalJSON(expected)) {
    throw new Error('Realm fixture received an unknown CharacterSourceRefV3');
  }
  if (!request.materializerAccountId
      || !request.challengeId
      || !/^[a-f0-9]{64}$/u.test(request.challengeDigest)
      || !request.intendedRuntimeAudience) {
    throw new Error('Realm fixture requires authenticated account and Runtime-issued challenge bindings');
  }
  const limits = request.publishedLimits;
  for (const key of [
    'maxSegmentBytes', 'maxSegmentComponentCount', 'maxChunkBytes', 'maxSegmentChunks',
    'maxSetSegments', 'maxSetBytes', 'maxSetComponentCount', 'maxSetChunks',
  ]) {
    if (!Number.isSafeInteger(limits?.[key]) || limits[key] <= 0) {
      throw new Error(`Realm fixture requires positive publishedLimits.${key}`);
    }
  }
}

function signDetachedPacketHash(packetHash) {
  const protectedHeader = Buffer.from(canonicalJSON({
    alg: 'RS256', kid: MATERIALIZATION_KEY_ID, typ: 'realm-source-materialization',
  }), 'utf8').toString('base64url');
  const signedPayload = `${PROOF_DOMAIN}${packetHash}`;
  const encodedPayload = Buffer.from(signedPayload, 'utf8').toString('base64url');
  const signingInput = Buffer.from(`${protectedHeader}.${encodedPayload}`, 'ascii');
  const signature = sign('RSA-SHA256', signingInput, MATERIALIZATION_KEYS.privateKey).toString('base64url');
  return { compactJws: `${protectedHeader}..${signature}`, signedPayload };
}

function hashDomain(domain, value) {
  return createHash('sha256').update(domain, 'utf8').update(canonicalJSON(value), 'utf8').digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').normalize('NFC'));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON received non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const normalizedEntries = Object.entries(value).filter(([, nested]) => nested !== undefined).map(([key, nested]) => [
      key.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').normalize('NFC'), nested,
    ]);
    const keys = new Set(normalizedEntries.map(([key]) => key));
    if (keys.size !== normalizedEntries.length) throw new TypeError('canonical JSON received normalized key collision');
    normalizedEntries.sort(([left], [right]) => compareUtf8(left, right));
    return `{${normalizedEntries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJSON(nested)}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON received ${typeof value}`);
}
