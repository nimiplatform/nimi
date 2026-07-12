import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
const COVERAGE_DOMAIN = 'nimi.realm.materialization-coverage/v1\0';
const CONTEXT_DOMAIN = 'nimi.realm.materialization-context/v1\0';
const PAYLOAD_DOMAIN = 'nimi.realm.materialization-payload/v2\0';
const MANIFEST_DOMAIN = 'nimi.realm.materialization-bundle-manifest/v1\0';
const PACKET_DOMAIN = 'nimi.realm.source-materialization-packet/v2\0';
const PROOF_DOMAIN = 'nimi.realm.source-materialization-proof/v2\0';
const MATERIALIZATION_KEY_ID = 'sdk-runtime-live-source-materialization-rs256';
const MATERIALIZATION_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048 });
const MATERIALIZATION_PUBLIC_JWK = MATERIALIZATION_KEYS.publicKey.export({ format: 'jwk' });
const FIXTURE_TIME = '2026-07-10T05:00:00.000Z';
function fixtureIdentity(environmentKey, fallback) {
    const value = String(process.env[environmentKey] || fallback).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
        throw new Error(`${environmentKey} must be a bounded product identity`);
    }
    return value;
}
export const FIXTURE_ACCOUNT_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID', 'user-runtime-agent-live');
const FIXTURE_WORLD_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_WORLD_ID', 'world-runtime-live');
const FIXTURE_SOURCE_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_SOURCE_ID', 'source-runtime-live');
const FIXTURE_PERSONA_SOURCE_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_PERSONA_SOURCE_ID', 'persona-runtime-live');
const FIXTURE_ENTITY_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_ENTITY_ID', 'entity-runtime-live');
const FIXTURE_RESOURCE_ID = fixtureIdentity('NIMI_LOCAL_AGENT_PRODUCT_RESOURCE_ID', 'resource-runtime-live-avatar');
export let FIXTURE_REALM_ISSUER = 'https://realm.sdk-runtime-agent-live.test';
export function configureFixtureRealmIssuer(issuer) {
    const normalized = String(issuer || '').trim();
    if (!/^https?:\/\//u.test(normalized)) {
        throw new Error('fixture Realm issuer must be an absolute HTTP(S) origin');
    }
    FIXTURE_REALM_ISSUER = normalized;
}
export const FIXTURE_SOURCE_MATERIALIZATION_JWKS = {
    keys: [{
            ...MATERIALIZATION_PUBLIC_JWK,
            kid: MATERIALIZATION_KEY_ID,
            use: 'sig',
            alg: 'RS256',
            purpose: 'realm-source-materialization',
        }],
};
const origin = { kind: 'manual' };
const worldCore = {
    identity: {
        name: 'Runtime Live World',
        summary: 'A canonical world for Runtime source snapshot verification.',
        worldType: 'test-world',
    },
    presentation: {
        title: 'Runtime Live World',
        tagline: 'Source materialization fixture world.',
    },
    ontology: {
        entityKinds: ['worldCharacter'],
        relationshipTypes: ['knows'],
    },
    timeModel: {
        mode: 'wallClockAnchored',
        flowRatio: 1,
        isPaused: false,
        anchor: {
            realStartedAt: FIXTURE_TIME,
            worldStartedAt: FIXTURE_TIME,
            worldStartedAtDisplay: 'July 10, 2026',
        },
        pausedWorldTime: null,
        calendar: null,
        displayFormat: null,
    },
    timeline: { events: [] },
    entities: [{ entityId: FIXTURE_ENTITY_ID, kind: 'person', label: 'Runtime Live Source' }],
    relationships: [],
    systems: [],
    scenes: [],
    assets: { resourceRefs: [], intents: [] },
    authoring: { source: 'sdk-runtime-live-fixture' },
};
const world = {
    id: FIXTURE_WORLD_ID,
    schemaVersion: 'realm.world-core/v1',
    contentRevision: 7,
    contentHash: hashCanonicalJSON({
        schemaVersion: 'realm.world-core/v1',
        origin,
        creatorId: FIXTURE_ACCOUNT_ID,
        visibility: 'public',
        core: worldCore,
    }),
    origin,
    creatorId: FIXTURE_ACCOUNT_ID,
    visibility: 'public',
    core: worldCore,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
};
const characterCore = {
    identity: {
        name: 'Runtime Live Source',
        summary: 'A source-grounded Runtime live verification character.',
        aliases: ['Runtime Source'],
    },
    presentation: {
        displayName: 'Runtime Live Source',
        shortBio: 'Canonical Runtime source materialization fixture.',
        avatarResourceRef: FIXTURE_RESOURCE_ID,
    },
    placement: {
        worldId: world.id,
        entityId: FIXTURE_ENTITY_ID,
        role: 'Verification Guide',
        faction: 'Runtime Verification',
        rank: 'Canonical',
        sceneRefs: [],
    },
    biography: {
        milestones: [{
                milestoneId: 'milestone-runtime-live',
                title: 'Materialized from Realm',
                summary: 'The source was captured through packet v2.',
                sequence: 1,
            }],
        sourceNotes: ['All source facts are proof-covered.'],
    },
    psychology: {
        drives: ['Preserve source fidelity'],
        boundaries: ['Never invent private context'],
    },
    knowledge: {
        topics: ['Runtime source snapshot verification'],
        constraints: ['Unknown facts remain unknown'],
    },
    relationships: [],
    capabilities: {
        interactionModes: ['dialogue'],
        tools: [],
    },
    interactionProfile: {
        tone: 'precise and warm',
        cadence: 'measured',
        scenario: 'A user verifies the Runtime LocalAgent chain.',
        greeting: 'The source snapshot is ready.',
        greetingVariants: ['The verified source is available.'],
        dialogueExemplars: ['I will distinguish source truth from inference.'],
    },
    assets: {
        resourceRefs: [{ refId: FIXTURE_RESOURCE_ID, kind: 'image', purpose: 'avatar' }],
        externalRefs: [],
        intents: [{ intentId: 'intent-runtime-live-voice', kind: 'voice', summary: 'Measured voice.' }],
    },
    authoring: {
        source: 'sdk-runtime-live-fixture',
        maintainers: ['sdk-runtime-live-suite'],
        notes: ['Every required Character section is present.'],
    },
};
const source = {
    kind: 'worldCharacter',
    id: FIXTURE_SOURCE_ID,
    schemaVersion: 'realm.world-character-core/v1',
    contentRevision: 7,
    contentHash: hashCanonicalJSON({
        schemaVersion: 'realm.world-character-core/v1',
        origin,
        worldId: world.id,
        entityId: FIXTURE_ENTITY_ID,
        core: characterCore,
    }),
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    origin,
    creatorId: FIXTURE_ACCOUNT_ID,
    visibility: 'public',
    worldId: world.id,
    entityId: FIXTURE_ENTITY_ID,
    core: characterCore,
};
const personaCore = {
    identity: { handle: 'solace', name: 'Solace', summary: 'A canonical source-grounded persona.', aliases: ['Guide'] },
    presentation: { displayName: 'Solace', profileLine: 'Clear, calm, and source grounded.' },
    personaStyle: { archetype: 'advisor', traits: ['calm', 'direct'], voice: 'clear', pacing: 'measured' },
    contentProfile: { topics: ['Runtime source snapshot verification'], boundaries: ['Never invent private context'], guidelines: [{ guidelineId: 'source-truth', statement: 'Separate source truth from inference', source: 'fixture' }] },
    interactionProfile: { homeWorldId: world.id, interactionModes: ['conversation'] },
    assets: { resourceRefs: [], externalRefs: [], intents: [] },
    authoring: { source: 'desktop-local-agent-product-fixture' },
};
const personaSource = {
    kind: 'realmPersona',
    id: FIXTURE_PERSONA_SOURCE_ID,
    schemaVersion: 'realm.persona/v1',
    contentRevision: 4,
    contentHash: hashCanonicalJSON({
        schemaVersion: 'realm.persona/v1', origin, ownerId: FIXTURE_ACCOUNT_ID,
        homeWorldId: world.id, visibility: 'public', core: personaCore,
    }),
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    origin,
    ownerId: FIXTURE_ACCOUNT_ID,
    homeWorldId: world.id,
    visibility: 'public',
    core: personaCore,
};
const entityCore = {
    identity: {
        name: 'Runtime Live Source',
        summary: 'Runtime Live Source is the canonical bound person.',
        kind: 'person',
        aliases: [],
    },
    classification: { tags: ['person'], sourceCategories: ['runtime-live-fixture'] },
    facts: [{
            factId: 'fact-runtime-live-source',
            type: 'fixture-fact',
            label: 'Source-grounded fixture fact',
            value: { sourceGrounded: true },
            sourceRefs: [`fixture:${FIXTURE_ENTITY_ID}`],
            confidence: 'recorded',
        }],
    evidence: { sourceRefs: [`fixture:${FIXTURE_ENTITY_ID}`], completeness: 'complete' },
    assets: { resourceRefs: [], externalRefs: [], intents: [] },
    authoring: { source: 'sdk-runtime-live-fixture', maintainers: ['sdk-runtime-live-suite'] },
};
const boundEntity = {
    id: FIXTURE_ENTITY_ID,
    schemaVersion: 'realm.world-entity-core/v1',
    contentRevision: 3,
    contentHash: hashCanonicalJSON({
        schemaVersion: 'realm.world-entity-core/v1',
        origin,
        worldId: world.id,
        kind: 'person',
        core: entityCore,
    }),
    origin,
    worldId: world.id,
    kind: 'person',
    core: entityCore,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
};
export const FIXTURE_SOURCE_REF = {
    kind: 'worldCharacter',
    worldId: world.id,
    sourceId: source.id,
    sourceContentHash: source.contentHash,
};
export const FIXTURE_PERSONA_SOURCE_REF = {
    kind: 'realmPersona',
    worldId: world.id,
    sourceId: personaSource.id,
    sourceContentHash: personaSource.contentHash,
};
export function createFixtureRealmCoreSeed(identitySuffix) {
    const suffix = String(identitySuffix || '').trim().replace(/[^a-zA-Z0-9-]/gu, '-').slice(-40);
    if (!suffix) {
        throw new Error('fixture Realm core seed requires an identity suffix');
    }
    const ids = {
        world: `world-local-agent-${suffix}`,
        entity: `entity-local-agent-${suffix}`,
        character: `character-local-agent-${suffix}`,
        persona: `persona-local-agent-${suffix}`,
    };
    const replacements = new Map([
        [world.id, ids.world],
        [boundEntity.id, ids.entity],
        [source.id, ids.character],
        [personaSource.id, ids.persona],
    ]);
    const replace = (value) => {
        if (typeof value === 'string') return replacements.get(value) || value;
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, replace(nested)]));
        }
        return value;
    };
    const withoutUnseededAssets = (value) => {
        if (Array.isArray(value)) return value.map(withoutUnseededAssets);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => {
                if (/ResourceRef$/u.test(key)) return [];
                if (key === 'resourceRefs' || key === 'externalRefs') return [[key, []]];
                return [[key, withoutUnseededAssets(nested)]];
            }));
        }
        return value;
    };
    const seededWorldCore = withoutUnseededAssets(replace(world.core));
    seededWorldCore.identity.name = `LocalAgent Product ${suffix}`;
    seededWorldCore.presentation.title = `LocalAgent Product ${suffix}`;
    return {
        displayName: seededWorldCore.identity.name,
        world: { id: ids.world, visibility: 'public', origin, core: seededWorldCore },
        entity: { id: ids.entity, kind: boundEntity.kind, origin, core: withoutUnseededAssets(replace(boundEntity.core)) },
        character: { id: ids.character, entityId: ids.entity, origin, core: withoutUnseededAssets(replace(source.core)) },
        persona: { id: ids.persona, homeWorldId: ids.world, visibility: 'public', origin, core: withoutUnseededAssets(replace(personaSource.core)) },
    };
}
export function createFixtureSourceMaterializationPacket(request) {
    assertFixtureRequest(request);
    const packetId = `packet-${randomUUID()}`;
    const isPersona = request.sourceRef.kind === 'realmPersona';
    const selectedSource = isPersona ? personaSource : source;
    const initial = isPersona
        ? [
            component('realmPersona', personaSource.homeWorldId, personaSource.id, personaSource.schemaVersion, personaSource.contentRevision, personaSource.contentHash, personaSource),
            component('worldCore', world.id, world.id, world.schemaVersion, world.contentRevision, world.contentHash, world),
        ]
        : [
            component('worldCharacter', source.worldId, source.id, source.schemaVersion, source.contentRevision, source.contentHash, source),
            component('worldCore', world.id, world.id, world.schemaVersion, world.contentRevision, world.contentHash, world),
            component('worldEntity', boundEntity.worldId, boundEntity.id, boundEntity.schemaVersion, boundEntity.contentRevision, boundEntity.contentHash, boundEntity),
        ];
    const requiredSections = Object.keys(selectedSource.core)
        .sort(compareUtf8)
        .map((section) => ({ path: `source.core.${section}`, state: 'present' }));
    const sourceCompactRef = `${selectedSource.kind}:${request.sourceRef.worldId}:${selectedSource.id}`;
    const requiredRefs = isPersona
        ? [
            { path: 'source.core.interactionProfile.homeWorldId', refKind: 'worldCore', refId: world.id, state: 'resolved' },
            { path: 'source.homeWorldId', refKind: 'worldCore', refId: world.id, state: 'resolved' },
        ]
        : [
            { path: 'source.entityId', refKind: 'worldEntity', refId: boundEntity.id, state: 'resolved' },
            { path: 'source.worldId', refKind: 'worldCore', refId: world.id, state: 'resolved' },
        ];
    const optionalRefs = isPersona ? [
        { path: 'source.core.presentation.avatarResourceRef', refKind: 'resource', refId: 'absent:source.core.presentation.avatarResourceRef', state: 'omitted', omissionReason: 'not-declared' },
        { path: 'source.core.presentation.profileCoverResourceRef', refKind: 'resource', refId: 'absent:source.core.presentation.profileCoverResourceRef', state: 'omitted', omissionReason: 'not-declared' },
    ] : [
        { path: 'source.core.presentation.avatarResourceRef', refKind: 'resource', refId: characterCore.presentation.avatarResourceRef, state: 'resolved' },
        { path: 'source.core.presentation.profileCoverResourceRef', refKind: 'resource', refId: 'absent:source.core.presentation.profileCoverResourceRef', state: 'omitted', omissionReason: 'not-declared' },
    ];
    const crossReferenceChecks = isPersona
        ? [
            { checkId: 'persona-interaction-home-world', state: 'valid', sourceRef: sourceCompactRef, targetRef: `worldCore:${world.id}:${world.id}` },
            { checkId: 'source-owning-world', state: 'valid', sourceRef: sourceCompactRef, targetRef: `worldCore:${world.id}:${world.id}` },
        ]
        : [
            { checkId: 'source-bound-entity', state: 'valid', sourceRef: sourceCompactRef, targetRef: `worldEntity:${boundEntity.worldId}:${boundEntity.id}` },
            { checkId: 'source-owning-world', state: 'valid', sourceRef: sourceCompactRef, targetRef: `worldCore:${world.id}:${world.id}` },
        ];
    const coverageUnsigned = {
        manifestSchemaVersion: 'realm.materialization-coverage/v1',
        closurePolicyVersion: 'realm.materialization-closure/v1',
        requiredSections,
        requiredRefs,
        optionalRefs,
        components: initial.map(componentMetadata),
        crossReferenceChecks,
        aggregateStatus: 'complete',
    };
    const coverageManifestHash = hashDomain(COVERAGE_DOMAIN, coverageUnsigned);
    const coverageManifest = { ...coverageUnsigned, coverageManifestHash };
    const sourceComponentDigests = [componentDigest(initial[0])];
    const worldAndClosureComponentDigests = initial.slice(1).map(componentDigest);
    const contextHashInput = {
        contextSchemaVersion: 'realm.materialization-context/v1',
        sourceComponentDigests,
        worldAndClosureComponentDigests,
        closurePolicyVersion: 'realm.materialization-closure/v1',
        coverageManifestHash,
    };
    const materializationContextHash = hashDomain(CONTEXT_DOMAIN, contextHashInput);
    const materializationContext = {
        contextSchemaVersion: 'realm.materialization-context/v1',
        sourceRef: request.sourceRef,
        owningWorld: world,
        dependencyClosure: isPersona
            ? { kind: 'realmPersona', explicitDependencies: [] }
            : { kind: 'worldCharacter', boundEntity, incidentRelationships: [], endpointEntities: [], explicitDependencies: [] },
        sourceComponentDigests,
        worldAndClosureComponentDigests,
        closurePolicyVersion: 'realm.materialization-closure/v1',
        coverageManifestHash,
        materializationContextHash,
    };
    const semanticPayload = {
        payloadSchemaVersion: 'realm.source-materialization-payload/v2',
        payloadAssemblyVersion: 'realm.materialization-assembly/v1',
        source: selectedSource,
        materializationContext,
        coverageManifest,
        coverageManifestHash,
        materializationContextHash,
    };
    const payloadHash = hashDomain(PAYLOAD_DOMAIN, semanticPayload);
    const coverage = component('coverageManifest', 'manifest', packetId, 'realm.materialization-coverage/v1', 1, coverageManifestHash, coverageManifest);
    const transport = buildTransport(packetId, request, [...initial, coverage]);
    const issuedAt = new Date();
    const challengeExpiry = new Date(request.challengeExpiresAt);
    if (!Number.isFinite(challengeExpiry.getTime()) || challengeExpiry.getTime() <= issuedAt.getTime()) {
        throw new Error('Runtime source materialization challenge expiry is invalid');
    }
    const unsignedEnvelope = {
        packetSchemaVersion: 'realm.source-materialization-packet/v2',
        packetId,
        issuer: FIXTURE_REALM_ISSUER,
        keyId: MATERIALIZATION_KEY_ID,
        algorithm: 'RS256',
        keyUse: 'sig',
        issuedAt: issuedAt.toISOString(),
        expiresAt: challengeExpiry.toISOString(),
        nonce: randomUUID(),
        intendedRuntimeAudience: request.intendedRuntimeAudience,
        challengeId: request.challengeId,
        challengeDigest: request.challengeDigest,
        challengeLimits: request.challengeLimits,
        materializerAccountId: request.materializerAccountId,
        sourceRef: request.sourceRef,
        payloadHash,
        bundleManifestHash: transport.bundleManifestHash,
    };
    const packetHash = hashDomain(PACKET_DOMAIN, unsignedEnvelope);
    return {
        ...unsignedEnvelope,
        packetHash,
        packetProof: signDetachedPacketHash(packetHash),
        semanticPayload,
        bundleTransportManifest: transport.manifest,
        orderedComponentChunks: transport.orderedComponentChunks,
    };
}
function component(kind, worldId, id, schemaVersion, revision, contentHash, value) {
    const bytes = Buffer.from(canonicalJSON(value), 'utf8');
    return {
        componentId: `${kind}:${worldId}:${id}`,
        kind,
        schemaVersion,
        revision,
        contentHash,
        value,
        bytes,
        canonicalBytesHash: sha256(bytes),
        canonicalByteLength: bytes.byteLength,
    };
}
function componentMetadata(value) {
    return {
        componentId: value.componentId,
        kind: value.kind,
        schemaVersion: value.schemaVersion,
        revision: value.revision,
        contentHash: value.contentHash,
    };
}
function componentDigest(value) {
    return {
        componentId: value.componentId,
        kind: value.kind,
        contentHash: value.contentHash,
    };
}
function buildTransport(packetId, request, components) {
    const limits = request.challengeLimits;
    const totalCanonicalBytes = components.reduce((total, item) => total + item.canonicalByteLength, 0);
    if (components.length > limits.maxComponentCount || totalCanonicalBytes > limits.maxBundleBytes) {
        throw new Error('Runtime challenge capacity is too small for source fixture');
    }
    let globalOrdinal = 0;
    const manifestChunks = [];
    const orderedComponentChunks = components.map((item) => {
        const canonicalBytes = [];
        for (let offset = 0; offset < item.bytes.byteLength; offset += limits.maxChunkBytes) {
            const bytes = item.bytes.subarray(offset, Math.min(offset + limits.maxChunkBytes, item.bytes.byteLength));
            const descriptor = {
                globalOrdinal,
                componentOffset: offset,
                length: bytes.byteLength,
                chunkSha256: sha256(bytes),
            };
            manifestChunks.push(descriptor);
            canonicalBytes.push({ ...descriptor, bytesBase64: bytes.toString('base64') });
            globalOrdinal += 1;
        }
        return {
            componentId: item.componentId,
            kind: item.kind,
            schemaVersion: item.schemaVersion,
            revision: item.revision,
            contentHash: item.contentHash,
            canonicalBytesHash: item.canonicalBytesHash,
            canonicalByteLength: item.canonicalByteLength,
            canonicalBytes,
        };
    });
    if (manifestChunks.length > limits.maxChunks || limits.maxChunkBytes <= 0) {
        throw new Error('Runtime challenge chunk capacity is too small for source fixture');
    }
    const manifest = {
        manifestSchemaVersion: 'realm.materialization-bundle-manifest/v1',
        payloadAssemblyVersion: 'realm.materialization-assembly/v1',
        packetId,
        challengeDigest: request.challengeDigest,
        totalCanonicalBytes,
        componentCount: components.length,
        chunkCount: manifestChunks.length,
        components: orderedComponentChunks.map((component) => {
            const metadata = { ...component };
            delete metadata.canonicalBytes;
            return metadata;
        }),
        chunks: manifestChunks,
    };
    return {
        manifest,
        bundleManifestHash: hashDomain(MANIFEST_DOMAIN, manifest),
        orderedComponentChunks,
    };
}
function assertFixtureRequest(request) {
    const expected = request.sourceRef.kind === 'realmPersona' ? FIXTURE_PERSONA_SOURCE_REF : FIXTURE_SOURCE_REF;
    if (request.sourceRef.kind !== expected.kind
        || request.sourceRef.worldId !== expected.worldId
        || request.sourceRef.sourceId !== expected.sourceId
        || request.sourceRef.sourceContentHash !== expected.sourceContentHash) {
        throw new Error('Realm fixture received an unknown canonical source ref');
    }
    if (!request.materializerAccountId
        || !request.challengeId
        || !/^[a-f0-9]{64}$/u.test(request.challengeDigest)
        || !request.intendedRuntimeAudience) {
        throw new Error('Realm fixture requires Runtime-issued challenge bindings');
    }
}
function signDetachedPacketHash(packetHash) {
    const protectedHeader = Buffer.from(JSON.stringify({
        alg: 'RS256',
        kid: MATERIALIZATION_KEY_ID,
        typ: 'realm-source-materialization',
    }), 'utf8').toString('base64url');
    const proofPayload = Buffer.from(`${PROOF_DOMAIN}${packetHash}`, 'utf8').toString('base64url');
    const signingInput = Buffer.from(`${protectedHeader}.${proofPayload}`, 'ascii');
    const signature = sign('RSA-SHA256', signingInput, MATERIALIZATION_KEYS.privateKey).toString('base64url');
    return `${protectedHeader}..${signature}`;
}
function hashDomain(domain, value) {
    return createHash('sha256').update(domain, 'utf8').update(canonicalJSON(value), 'utf8').digest('hex');
}
function hashCanonicalJSON(value) {
    return createHash('sha256').update(canonicalJSON(value), 'utf8').digest('hex');
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function compareUtf8(left, right) {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
function canonicalJSON(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('canonical JSON received non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJSON).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(',')}}`;
    }
    throw new TypeError(`canonical JSON received ${typeof value}`);
}
