import type {
  AbortSourceMaterializationUploadRequest,
  AbortSourceMaterializationUploadResponse,
  BeginSourceMaterializationUploadRequest,
  BeginSourceMaterializationUploadResponse,
  BundleTransportManifestV1,
  CommitSourceMaterializationRequest,
  CommitSourceMaterializationResponse,
  CreateSourceMaterializationChallengeRequest,
  CreateSourceMaterializationChallengeResponse,
  PutSourceMaterializationChunkRequest,
  PutSourceMaterializationChunkResponse,
  RuntimeTypedCallOptions,
  SourceMaterializationPacketEnvelopeV2,
  SourceMaterializationSourceRef,
} from '../core-generated/runtime-typed-client';
import {
  AgentSourceMaterializationBundleManifestSchemaVersion,
  AgentSourceMaterializationChallengeState,
  AgentSourceMaterializationComponentKind,
  AgentSourceMaterializationKeyUse,
  AgentSourceMaterializationPacketSchemaVersion,
  AgentSourceMaterializationPayloadAssemblyVersion,
  AgentSourceMaterializationProofAlgorithm,
  AgentSourceMaterializationReasonCode,
  AgentSourceMaterializationSourceKind,
  AgentSourceMaterializationUploadState,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRealmCoreSourceRef,
  NimiRealmSocialApi,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmSourceMaterializationPacket,
} from '../realm/social';
import { createNimiRealmSourceMaterializationPacket } from '../realm/social';
import { createNimiError } from '../types';
import {
  assertKnownAgentSourceMaterializationChallengeState,
  assertKnownAgentSourceMaterializationReasonCode,
  assertKnownAgentSourceMaterializationSourceKind,
  assertKnownAgentSourceMaterializationUploadState,
} from './wire-types/agent-participation-enums';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { isRuntimeLocalAgentRef } from './agent-local-identity';
import {
  decodeNimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentSourceContextStatus,
} from './runtime-agent-context-projections';
import {
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
  toNimiRuntimeTimestamp,
} from './runtime-agent-values';

export interface NimiRuntimeAgentMaterializationModule {
  createSourceMaterializationChallenge(
    request: CreateSourceMaterializationChallengeRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<CreateSourceMaterializationChallengeResponse>;
  beginSourceMaterializationUpload(
    request: BeginSourceMaterializationUploadRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<BeginSourceMaterializationUploadResponse>;
  putSourceMaterializationChunk(
    request: PutSourceMaterializationChunkRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PutSourceMaterializationChunkResponse>;
  commitSourceMaterialization(
    request: CommitSourceMaterializationRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<CommitSourceMaterializationResponse>;
  abortSourceMaterializationUpload(
    request: AbortSourceMaterializationUploadRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<AbortSourceMaterializationUploadResponse>;
}

export interface NimiRuntimeAgentMaterializationRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: NimiRuntimeAgentMaterializationModule;
}

export interface NimiRuntimeAgentMaterializationSurfaceOptions {
  readonly getRuntime: () => NimiRuntimeAgentMaterializationRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export interface NimiRuntimeAgentMaterializeRealmSourceInput {
  readonly sourceRef: NimiRealmCoreSourceRef;
  readonly requestId: unknown;
  readonly realm: Pick<NimiRealmSocialApi, 'generated'>;
  readonly emitRealmDataError: NimiRealmSocialDataErrorEmitter;
  readonly realmOptions?: Parameters<typeof createNimiRealmSourceMaterializationPacket>[3];
}

export interface NimiRuntimeAgentMaterializedRealmSource {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly uploadId: string;
  readonly packetHash: string;
  readonly bundleManifestHash: string;
  readonly sourceContextStatus: NimiRuntimeAgentSourceContextStatus;
}

export interface NimiRuntimeAgentMaterializationSurface {
  materializeRealmSource(
    input: NimiRuntimeAgentMaterializeRealmSourceInput,
  ): Promise<NimiRuntimeAgentMaterializedRealmSource>;
}

type OpenUpload = {
  readonly uploadId: string;
  readonly packetHash: string;
  readonly bundleManifestHash: string;
};

const MATERIALIZATION_SCOPE = ['runtime.agent.admin'] as const;

export function createNimiHostRuntimeAgentMaterializationSurface(
  options: NimiRuntimeAgentMaterializationSurfaceOptions,
): NimiRuntimeAgentMaterializationSurface {
  return {
    async materializeRealmSource(input) {
      const runtime = options.getRuntime();
      const ownerUserId = requireText(
        await options.getSubjectUserId(),
        'SDK_RUNTIME_AGENT_MATERIALIZER_REQUIRED',
        'authenticate_runtime_materializer',
      );
      const requestId = requireText(
        input.requestId,
        'SDK_RUNTIME_AGENT_MATERIALIZATION_REQUEST_ID_REQUIRED',
        'provide_materialization_request_id',
      );
      const sourceRef = requireSourceRef(input.sourceRef);
      const runtimeSourceRef = runtimeSourceRefFor(sourceRef);
      const context = {
        appId: requireText(runtime.appId, 'SDK_RUNTIME_AGENT_APP_ID_REQUIRED', 'provide_runtime_agent_app_id'),
        subjectUserId: ownerUserId,
        ownerUserId,
        runtimeSourceRef,
        localAgentRef: '',
      };
      const call = <T>(operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>) =>
        options.withScopes
          ? options.withScopes(MATERIALIZATION_SCOPE, operation)
          : withNimiRuntimeAgentScopes(
            { runtime, subjectUserId: ownerUserId },
            MATERIALIZATION_SCOPE,
            operation,
          );

      const challenge = await call((callOptions) => runtime.agent.createSourceMaterializationChallenge({
        context,
        requestId: `${requestId}:challenge`,
        sourceRef,
      }, callOptions));
      const challengeProjection = requireIssuedChallenge(challenge, sourceRef, ownerUserId);
      const packet = await createNimiRealmSourceMaterializationPacket(
        input.realm,
        input.emitRealmDataError,
        {
          sourceRef: input.sourceRef,
          materializerAccountId: ownerUserId,
          challengeId: challengeProjection.challengeId,
          challengeDigest: challengeProjection.challengeDigest,
          intendedRuntimeAudience: challengeProjection.intendedRuntimeAudience,
          challengeExpiresAt: challengeProjection.expiresAt,
          challengeLimits: challengeProjection.realmLimits,
        },
        input.realmOptions,
      );
      const bundle = requirePacketBundle(packet, challengeProjection, sourceRef, ownerUserId);

      let openUpload: OpenUpload | undefined;
      let committed = false;
      try {
        const begin = await call((callOptions) => runtime.agent.beginSourceMaterializationUpload({
          context,
          beginRequestId: `${requestId}:begin`,
          control: bundle.control,
        }, callOptions));
        openUpload = {
          uploadId: requireText(begin.uploadId, 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID', 'check_runtime_materialization_begin'),
          packetHash: requireText(begin.packetHash, 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID', 'check_runtime_materialization_begin'),
          bundleManifestHash: requireText(begin.bundleManifestHash, 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID', 'check_runtime_materialization_begin'),
        };
        requireBeginSuccess(begin, bundle);

        for (const chunk of bundle.chunks) {
          const put = await call((callOptions) => runtime.agent.putSourceMaterializationChunk({
            context,
            putRequestId: `${requestId}:put:${chunk.globalOrdinal}`,
            uploadId: openUpload!.uploadId,
            packetHash: openUpload!.packetHash,
            bundleManifestHash: openUpload!.bundleManifestHash,
            globalOrdinal: chunk.globalOrdinal,
            componentId: chunk.componentId,
            componentOffset: String(chunk.componentOffset),
            chunkSha256: chunk.chunkSha256,
            bytes: chunk.bytes,
          }, callOptions));
          requirePutSuccess(put, openUpload, chunk);
        }

        const commit = await call((callOptions) => runtime.agent.commitSourceMaterialization({
          context,
          commitRequestId: `${requestId}:commit`,
          uploadId: openUpload!.uploadId,
          packetHash: openUpload!.packetHash,
          bundleManifestHash: openUpload!.bundleManifestHash,
        }, callOptions));
        const sourceContextStatus = requireCommitSuccess(commit, openUpload, sourceRef);
        committed = true;
        return {
          ownerUserId,
          runtimeSourceRef,
          localAgentRef: commit.localAgentRef,
          uploadId: openUpload.uploadId,
          packetHash: openUpload.packetHash,
          bundleManifestHash: openUpload.bundleManifestHash,
          sourceContextStatus,
        };
      } catch (error) {
        if (openUpload && !committed) {
          await call((callOptions) => runtime.agent.abortSourceMaterializationUpload({
            context,
            abortRequestId: `${requestId}:abort`,
            uploadId: openUpload!.uploadId,
            packetHash: openUpload!.packetHash,
            bundleManifestHash: openUpload!.bundleManifestHash,
          }, callOptions)).then(requireAbortTerminal).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}

function requireIssuedChallenge(
  response: CreateSourceMaterializationChallengeResponse,
  sourceRef: SourceMaterializationSourceRef,
  ownerUserId: string,
) {
  requireChallengeResponseEnums(response.state, response.reasonCode);
  if (response.state !== AgentSourceMaterializationChallengeState.ISSUED
      || response.reasonCode !== AgentSourceMaterializationReasonCode.NONE) {
    responseError('Runtime rejected source materialization challenge.', 'request_new_source_materialization_challenge');
  }
  if (!sourceRefsEqual(response.sourceRef, sourceRef)
      || normalizeNimiRuntimeAgentText(response.materializerAccountId) !== ownerUserId) {
    responseError('Runtime source materialization challenge binding is invalid.', 'check_runtime_materialization_challenge_binding');
  }
  const expiresAt = toNimiRuntimeIsoFromTimestamp(response.expiresAt);
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    responseError('Runtime source materialization challenge expiry is invalid.', 'request_new_source_materialization_challenge');
  }
  const limits = response.limits;
  if (!limits) {
    responseError('Runtime source materialization challenge omitted capacity limits.', 'check_runtime_materialization_challenge_limits');
  }
  const realmLimits = {
    maxBundleBytes: requireSafePositiveInteger(limits.maxBundleBytes, 'maxBundleBytes'),
    maxComponentCount: requireSafePositiveInteger(limits.maxComponentCount, 'maxComponentCount'),
    maxChunkBytes: requireSafePositiveInteger(limits.maxChunkBytes, 'maxChunkBytes'),
    maxChunks: requireSafePositiveInteger(limits.maxChunks, 'maxChunks'),
  };
  return {
    challengeId: requireText(response.challengeId, 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID', 'check_runtime_materialization_challenge'),
    intendedRuntimeAudience: requireText(response.intendedRuntimeAudience, 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID', 'check_runtime_materialization_challenge'),
    challengeDigest: requireDigest(response.challengeDigest, 'challengeDigest'),
    expiresAt,
    realmLimits,
  };
}

function requirePacketBundle(
  packet: NimiRealmSourceMaterializationPacket,
  challenge: ReturnType<typeof requireIssuedChallenge>,
  sourceRef: SourceMaterializationSourceRef,
  ownerUserId: string,
) {
  if (packet.packetSchemaVersion !== 'realm.source-materialization-packet/v2'
      || packet.algorithm !== 'RS256'
      || packet.keyUse !== 'sig'
      || packet.challengeId !== challenge.challengeId
      || packet.challengeDigest !== challenge.challengeDigest
      || packet.intendedRuntimeAudience !== challenge.intendedRuntimeAudience
      || packet.materializerAccountId !== ownerUserId
      || !realmSourceRefEquals(packet.sourceRef, sourceRef)) {
    responseError('Realm source materialization packet binding or schema is invalid.', 'request_new_realm_source_materialization_packet');
  }
  requireText(packet.packetProof, 'SDK_REALM_SOURCE_MATERIALIZATION_PACKET_INVALID', 'check_realm_materialization_packet_proof');
  const issuedAt = requireTimestamp(packet.issuedAt, 'issuedAt');
  const expiresAt = requireTimestamp(packet.expiresAt, 'expiresAt');
  if (issuedAt.getTime() >= expiresAt.getTime()) {
    responseError('Realm source materialization packet issuance window is invalid.', 'request_new_realm_source_materialization_packet');
  }
  const packetHash = requireDigest(packet.packetHash, 'packetHash');
  const bundleManifestHash = requireDigest(packet.bundleManifestHash, 'bundleManifestHash');
  const payloadHash = requireDigest(packet.payloadHash, 'payloadHash');
  const limits = packet.challengeLimits;
  if (!limits || !numberLimitsEqual(limits, challenge.realmLimits)) {
    responseError('Realm source materialization packet limits do not match Runtime challenge.', 'request_new_realm_source_materialization_packet');
  }
  const manifest = packet.bundleTransportManifest;
  if (manifest.manifestSchemaVersion !== 'realm.materialization-bundle-manifest/v1'
      || manifest.payloadAssemblyVersion !== 'realm.materialization-assembly/v1'
      || manifest.packetId !== packet.packetId
      || manifest.challengeDigest !== challenge.challengeDigest) {
    responseError('Realm source materialization transport manifest is invalid.', 'request_new_realm_source_materialization_packet');
  }
  const components = [...manifest.components];
  const packetComponents = new Map(packet.orderedComponentChunks.map((component) => [component.componentId, component]));
  if (components.length !== manifest.componentCount
      || components.length !== packetComponents.size
      || components.length > challenge.realmLimits.maxComponentCount) {
    responseError('Realm source materialization component coverage is invalid.', 'request_new_realm_source_materialization_packet');
  }
  const mappedComponents = components.map((component, componentIndex) => {
    const packetComponent = packet.orderedComponentChunks[componentIndex];
    if (!packetComponent
        || packetComponent.componentId !== component.componentId
        || packetComponent.kind !== component.kind
        || packetComponent.schemaVersion !== component.schemaVersion
        || packetComponent.revision !== component.revision
        || packetComponent.contentHash !== component.contentHash
        || packetComponent.canonicalBytesHash !== component.canonicalBytesHash
        || packetComponent.canonicalByteLength !== component.canonicalByteLength) {
      responseError('Realm packet component descriptors are inconsistent.', 'request_new_realm_source_materialization_packet');
    }
    return {
      componentId: component.componentId,
      kind: componentKind(component.kind),
      schemaVersion: component.schemaVersion,
      revision: String(requireSafeNonNegativeInteger(component.revision, 'component.revision')),
      contentHash: requireDigest(component.contentHash, 'component.contentHash'),
      canonicalBytesHash: requireDigest(component.canonicalBytesHash, 'component.canonicalBytesHash'),
      canonicalByteLength: String(requireSafePositiveInteger(component.canonicalByteLength, 'component.canonicalByteLength')),
    };
  });
  const chunks = [...packetComponents.values()]
    .flatMap((component) => {
      let expectedOffset = 0;
      const mapped = component.canonicalBytes.map((chunk) => {
        const componentOffset = requireSafeNonNegativeInteger(chunk.componentOffset, 'chunk.componentOffset');
        const length = requireSafePositiveInteger(chunk.length, 'chunk.length');
        if (componentOffset !== expectedOffset) {
          responseError('Realm source materialization component chunk offsets are not contiguous.', 'request_new_realm_source_materialization_packet');
        }
        expectedOffset += length;
        return {
      componentId: component.componentId,
      globalOrdinal: requireSafeNonNegativeInteger(chunk.globalOrdinal, 'chunk.globalOrdinal'),
      componentOffset,
      length,
      chunkSha256: requireDigest(chunk.chunkSha256, 'chunk.chunkSha256'),
      bytes: decodeBase64(chunk.bytesBase64),
        };
      });
      if (expectedOffset !== component.canonicalByteLength) {
        responseError('Realm source materialization component byte length is inconsistent.', 'request_new_realm_source_materialization_packet');
      }
      return mapped;
    })
    .sort((left, right) => left.globalOrdinal - right.globalOrdinal);
  if (chunks.length !== manifest.chunkCount
      || chunks.length !== manifest.chunks.length
      || chunks.length > challenge.realmLimits.maxChunks) {
    responseError('Realm source materialization chunk coverage is invalid.', 'request_new_realm_source_materialization_packet');
  }
  let totalBytes = 0;
  chunks.forEach((chunk, index) => {
    const descriptor = manifest.chunks[index];
    if (chunk.globalOrdinal !== index
        || !descriptor
        || descriptor.globalOrdinal !== chunk.globalOrdinal
        || descriptor.componentOffset !== chunk.componentOffset
        || descriptor.length !== chunk.length
        || descriptor.chunkSha256 !== chunk.chunkSha256
        || chunk.bytes.byteLength !== chunk.length
        || chunk.length > challenge.realmLimits.maxChunkBytes) {
      responseError('Realm source materialization chunk descriptors are inconsistent.', 'request_new_realm_source_materialization_packet');
    }
    totalBytes += chunk.length;
  });
  if (totalBytes !== manifest.totalCanonicalBytes || totalBytes > challenge.realmLimits.maxBundleBytes) {
    responseError('Realm source materialization bundle byte count is invalid.', 'request_new_realm_source_materialization_packet');
  }
  const runtimeManifest: BundleTransportManifestV1 = {
    manifestSchemaVersion: AgentSourceMaterializationBundleManifestSchemaVersion.V1,
    payloadAssemblyVersion: AgentSourceMaterializationPayloadAssemblyVersion.V1,
    packetId: packet.packetId,
    challengeDigest: packet.challengeDigest,
    totalCanonicalBytes: String(manifest.totalCanonicalBytes),
    componentCount: manifest.componentCount,
    chunkCount: manifest.chunkCount,
    components: mappedComponents,
    chunks: manifest.chunks.map((chunk) => ({
      globalOrdinal: chunk.globalOrdinal,
      componentOffset: String(chunk.componentOffset),
      length: String(chunk.length),
      chunkSha256: chunk.chunkSha256,
    })),
  };
  const envelope: SourceMaterializationPacketEnvelopeV2 = {
    packetSchemaVersion: AgentSourceMaterializationPacketSchemaVersion.V2,
    packetId: packet.packetId,
    issuer: packet.issuer,
    keyId: packet.keyId,
    algorithm: AgentSourceMaterializationProofAlgorithm.RS256,
    keyUse: AgentSourceMaterializationKeyUse.SIG,
    issuedAt: toNimiRuntimeTimestamp(issuedAt),
    expiresAt: toNimiRuntimeTimestamp(expiresAt),
    nonce: packet.nonce,
    intendedRuntimeAudience: packet.intendedRuntimeAudience,
    challengeId: packet.challengeId,
    challengeDigest: packet.challengeDigest,
    challengeLimits: {
      maxBundleBytes: String(limits.maxBundleBytes),
      maxComponentCount: limits.maxComponentCount,
      maxChunkBytes: String(limits.maxChunkBytes),
      maxChunks: limits.maxChunks,
    },
    materializerAccountId: packet.materializerAccountId,
    sourceRef,
    payloadHash,
    bundleManifestHash,
    packetHash,
  };
  return {
    control: {
      packetEnvelope: envelope,
      packetProof: packet.packetProof,
      bundleTransportManifest: runtimeManifest,
    },
    packetHash,
    bundleManifestHash,
    chunks,
  };
}

function requireBeginSuccess(
  response: BeginSourceMaterializationUploadResponse,
  bundle: ReturnType<typeof requirePacketBundle>,
): void {
  requireUploadChallengeResponseEnums(response.uploadState, response.challengeState, response.reasonCode);
  if (response.uploadState !== AgentSourceMaterializationUploadState.OPEN
      || response.challengeState !== AgentSourceMaterializationChallengeState.LEASED
      || response.reasonCode !== AgentSourceMaterializationReasonCode.NONE
      || response.packetHash !== bundle.packetHash
      || response.bundleManifestHash !== bundle.bundleManifestHash) {
    responseError('Runtime rejected source materialization begin.', 'check_runtime_materialization_begin');
  }
}

function requirePutSuccess(
  response: PutSourceMaterializationChunkResponse,
  upload: OpenUpload,
  chunk: { readonly globalOrdinal: number; readonly componentId: string },
): void {
  requireUploadResponseEnums(response.uploadState, response.reasonCode);
  if (response.uploadState !== AgentSourceMaterializationUploadState.OPEN
      || response.reasonCode !== AgentSourceMaterializationReasonCode.NONE
      || response.uploadId !== upload.uploadId
      || response.globalOrdinal !== chunk.globalOrdinal
      || response.componentId !== chunk.componentId) {
    responseError('Runtime rejected source materialization chunk.', 'check_runtime_materialization_chunk');
  }
}

function requireCommitSuccess(
  response: CommitSourceMaterializationResponse,
  upload: OpenUpload,
  expectedSourceRef: SourceMaterializationSourceRef,
): NimiRuntimeAgentSourceContextStatus {
  requireUploadChallengeResponseEnums(response.uploadState, response.challengeState, response.reasonCode);
  const localAgentRef = normalizeNimiRuntimeAgentText(response.localAgentRef);
  if (response.uploadState !== AgentSourceMaterializationUploadState.COMMITTED
      || response.challengeState !== AgentSourceMaterializationChallengeState.CONSUMED
      || response.reasonCode !== AgentSourceMaterializationReasonCode.NONE
      || response.uploadId !== upload.uploadId
      || !isRuntimeLocalAgentRef(localAgentRef)) {
    responseError('Runtime rejected source materialization commit.', 'check_runtime_materialization_commit');
  }
  const status = response.sourceContextStatus;
  if (!status) {
    responseError('Runtime materialization commit omitted bounded source context status.', 'check_runtime_materialization_commit');
  }
  let projected: NimiRuntimeAgentSourceContextStatus;
  try {
    projected = decodeNimiRuntimeAgentSourceContextStatus(status);
  } catch {
    responseError('Runtime materialization source context status is invalid.', 'check_runtime_materialization_commit');
  }
  const expectedKind = expectedSourceRef.kind === AgentSourceMaterializationSourceKind.WORLD_CHARACTER
    ? 'worldCharacter'
    : 'realmPersona';
  if (!projected.ready || !projected.sourceRef
      || projected.localAgentRef !== localAgentRef
      || projected.sourceRef.kind !== expectedKind
      || projected.sourceRef.worldId !== expectedSourceRef.worldId
      || projected.sourceRef.sourceId !== expectedSourceRef.sourceId
      || projected.sourceRef.sourceContentHash !== expectedSourceRef.sourceContentHash) {
    responseError('Runtime materialization source context status binding is invalid.', 'check_runtime_materialization_commit');
  }
  return projected;
}

function requireAbortTerminal(response: AbortSourceMaterializationUploadResponse): void {
  requireUploadChallengeResponseEnums(response.uploadState, response.challengeState, response.reasonCode);
  if (response.uploadState !== AgentSourceMaterializationUploadState.ABORTED
      || response.challengeState !== AgentSourceMaterializationChallengeState.INVALIDATED
      || response.reasonCode !== AgentSourceMaterializationReasonCode.ABORTED) {
    responseError('Runtime source materialization abort did not reach its terminal state.', 'check_runtime_materialization_abort');
  }
}

function requireChallengeResponseEnums(challengeState: unknown, reasonCode: unknown): void {
  assertKnownAgentSourceMaterializationChallengeState(challengeState);
  assertKnownAgentSourceMaterializationReasonCode(reasonCode);
}

function requireUploadResponseEnums(uploadState: unknown, reasonCode: unknown): void {
  assertKnownAgentSourceMaterializationUploadState(uploadState);
  assertKnownAgentSourceMaterializationReasonCode(reasonCode);
}

function requireUploadChallengeResponseEnums(
  uploadState: unknown,
  challengeState: unknown,
  reasonCode: unknown,
): void {
  assertKnownAgentSourceMaterializationUploadState(uploadState);
  assertKnownAgentSourceMaterializationChallengeState(challengeState);
  assertKnownAgentSourceMaterializationReasonCode(reasonCode);
}

function requireSourceRef(value: NimiRealmCoreSourceRef): SourceMaterializationSourceRef {
  if (!value || (value.kind !== 'worldCharacter' && value.kind !== 'realmPersona')) {
    responseError('Source materialization requires a typed Character or Persona source ref.', 'provide_hash_bearing_source_ref');
  }
  return {
    kind: value.kind === 'worldCharacter'
      ? AgentSourceMaterializationSourceKind.WORLD_CHARACTER
      : AgentSourceMaterializationSourceKind.REALM_PERSONA,
    worldId: requireText(value.worldId, 'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID', 'provide_hash_bearing_source_ref'),
    sourceId: requireText(value.sourceId, 'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID', 'provide_hash_bearing_source_ref'),
    sourceContentHash: requireDigest(value.sourceContentHash, 'sourceContentHash'),
  };
}

function componentKind(value: string): AgentSourceMaterializationComponentKind {
  const kinds: Record<string, AgentSourceMaterializationComponentKind> = {
    worldCharacter: AgentSourceMaterializationComponentKind.WORLD_CHARACTER,
    realmPersona: AgentSourceMaterializationComponentKind.REALM_PERSONA,
    worldCore: AgentSourceMaterializationComponentKind.WORLD_CORE,
    worldEntity: AgentSourceMaterializationComponentKind.WORLD_ENTITY,
    worldRelationship: AgentSourceMaterializationComponentKind.WORLD_RELATIONSHIP,
    coverageManifest: AgentSourceMaterializationComponentKind.COVERAGE_MANIFEST,
  };
  const kind = kinds[value];
  if (kind === undefined) {
    responseError('Realm source materialization component kind is unknown.', 'request_new_realm_source_materialization_packet');
  }
  return kind;
}

function runtimeSourceRefFor(sourceRef: SourceMaterializationSourceRef): string {
  const kind = sourceRef.kind === AgentSourceMaterializationSourceKind.WORLD_CHARACTER
    ? 'worldCharacter'
    : 'realmPersona';
  return `runtime-source:${kind}:${sourceRef.worldId}:${sourceRef.sourceId}:${sourceRef.sourceContentHash}`;
}

function sourceRefsEqual(left: SourceMaterializationSourceRef | undefined, right: SourceMaterializationSourceRef): boolean {
  return Boolean(left)
    && left!.kind === right.kind
    && left!.worldId === right.worldId
    && left!.sourceId === right.sourceId
    && left!.sourceContentHash === right.sourceContentHash;
}

function realmSourceRefEquals(left: NimiRealmCoreSourceRef, right: SourceMaterializationSourceRef): boolean {
  return left.kind === (right.kind === AgentSourceMaterializationSourceKind.WORLD_CHARACTER ? 'worldCharacter' : 'realmPersona')
    && left.worldId === right.worldId
    && left.sourceId === right.sourceId
    && left.sourceContentHash === right.sourceContentHash;
}

function numberLimitsEqual(
  left: NimiRealmSourceMaterializationPacket['challengeLimits'],
  right: { readonly maxBundleBytes: number; readonly maxComponentCount: number; readonly maxChunkBytes: number; readonly maxChunks: number },
): boolean {
  return left.maxBundleBytes === right.maxBundleBytes
    && left.maxComponentCount === right.maxComponentCount
    && left.maxChunkBytes === right.maxChunkBytes
    && left.maxChunks === right.maxChunks;
}

function decodeBase64(value: unknown): Uint8Array {
  const encoded = typeof value === 'string' ? value : '';
  if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    responseError('Realm source materialization chunk bytes are not canonical base64.', 'request_new_realm_source_materialization_packet');
  }
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requireDigest(value: unknown, field: string): string {
  const digest = normalizeNimiRuntimeAgentText(value);
  if (!isDigest(digest)) {
    responseError(`Source materialization ${field} must be a lowercase SHA-256 digest.`, 'request_new_source_materialization_packet');
  }
  return digest;
}

function isDigest(value: unknown): value is string {
  return /^[a-f0-9]{64}$/u.test(normalizeNimiRuntimeAgentText(value));
}

function requireTimestamp(value: unknown, field: string): Date {
  const text = normalizeNimiRuntimeAgentText(value);
  const timestamp = new Date(text);
  if (!text || !Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== text) {
    responseError(`Source materialization ${field} must be a canonical UTC timestamp.`, 'request_new_source_materialization_packet');
  }
  return timestamp;
}

function requireText(value: unknown, reasonCode: string, actionHint: string): string {
  const text = normalizeNimiRuntimeAgentText(value);
  if (!text) {
    responseError('Source materialization required text is missing.', actionHint, reasonCode);
  }
  return text;
}

function requireSafePositiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^[0-9]+$/u.test(value) ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    responseError(`Source materialization ${field} must be a positive safe integer.`, 'request_new_source_materialization_packet');
  }
  return parsed;
}

function requireSafeNonNegativeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    responseError(`Source materialization ${field} must be a non-negative safe integer.`, 'request_new_source_materialization_packet');
  }
  return parsed;
}

function responseError(message: string, actionHint: string, reasonCode = 'SDK_RUNTIME_AGENT_MATERIALIZATION_RESPONSE_INVALID'): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}
