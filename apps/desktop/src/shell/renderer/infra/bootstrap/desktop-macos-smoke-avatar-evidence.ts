import type { DesktopMacosSmokeDriverDeps } from './desktop-macos-smoke-shared';

export class AvatarCarrierEvidenceFailureError extends Error {
  readonly smokeDetails: Record<string, unknown>;

  constructor(message: string, smokeDetails: Record<string, unknown>) {
    super(message);
    this.name = 'AvatarCarrierEvidenceFailureError';
    this.smokeDetails = smokeDetails;
  }
}

function readEvidenceRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(evidence.records)
    ? evidence.records.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function recordKind(record: Record<string, unknown>): string {
  return typeof record.kind === 'string' ? record.kind : '';
}

function recordDetail(record: Record<string, unknown>): Record<string, unknown> {
  return record.detail && typeof record.detail === 'object' && !Array.isArray(record.detail)
    ? record.detail as Record<string, unknown>
    : {};
}

function recordConsume(record: Record<string, unknown>): Record<string, unknown> {
  return record.consume && typeof record.consume === 'object' && !Array.isArray(record.consume)
    ? record.consume as Record<string, unknown>
    : {};
}

function recordConversationAnchorId(record: Record<string, unknown>): string {
  const detail = recordDetail(record);
  const consume = recordConsume(record);
  return String(
    record.conversationAnchorId
    || record.conversation_anchor_id
    || consume.conversationAnchorId
    || consume.conversation_anchor_id
    || detail.conversation_anchor_id
    || detail.conversationAnchorId
    || '',
  ).trim();
}

function recordAvatarInstanceId(record: Record<string, unknown>): string {
  const detail = recordDetail(record);
  const consume = recordConsume(record);
  return String(
    record.avatarInstanceId
    || record.avatar_instance_id
    || consume.avatarInstanceId
    || consume.avatar_instance_id
    || detail.avatar_instance_id
    || detail.avatarInstanceId
    || '',
  ).trim();
}

function recordTimeMs(record: Record<string, unknown>): number {
  const value = typeof record.recordedAt === 'string' ? Date.parse(record.recordedAt) : NaN;
  return Number.isFinite(value) ? value : 0;
}

function compactRuntimeBindFailure(record: Record<string, unknown>): Record<string, unknown> {
  const detail = recordDetail(record);
  return {
    kind: recordKind(record),
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : null,
    conversationAnchorId: recordConversationAnchorId(record) || null,
    avatarInstanceId: recordAvatarInstanceId(record) || null,
    agentId: typeof detail.agentId === 'string' ? detail.agentId : null,
    runtimeAppId: typeof detail.runtime_app_id === 'string' ? detail.runtime_app_id : null,
    reason: typeof detail.reason === 'string' ? detail.reason : null,
    errorMessage: typeof detail.error_message === 'string' ? detail.error_message : null,
    errorStage: typeof detail.error_stage === 'string' ? detail.error_stage : null,
    errorReasonCode: typeof detail.error_reason_code === 'string' ? detail.error_reason_code : null,
    errorAccountReasonCode: typeof detail.error_account_reason_code === 'string' ? detail.error_account_reason_code : null,
    errorActionHint: typeof detail.error_action_hint === 'string' ? detail.error_action_hint : null,
    errorSource: typeof detail.error_source === 'string' ? detail.error_source : null,
    errorRetryable: typeof detail.error_retryable === 'boolean' ? detail.error_retryable : null,
  };
}

function describeRuntimeBindFailure(record: Record<string, unknown>): string {
  const compact = compactRuntimeBindFailure(record);
  return [
    `reason=${String(compact.reason || 'unknown')}`,
    `message=${String(compact.errorMessage || 'unknown')}`,
    `stage=${String(compact.errorStage || 'unknown')}`,
    `reasonCode=${String(compact.errorReasonCode || 'unknown')}`,
    `accountReasonCode=${String(compact.errorAccountReasonCode || 'unknown')}`,
    `actionHint=${String(compact.errorActionHint || 'unknown')}`,
    `source=${String(compact.errorSource || 'unknown')}`,
    `runtimeAppId=${String(compact.runtimeAppId || 'unknown')}`,
    `avatarInstanceId=${String(compact.avatarInstanceId || 'unknown')}`,
  ].join(' ');
}

function avatarCarrierEvidenceFailure(
  message: string,
  input: {
    avatarInstanceId: string;
    expectedConversationAnchorId: string;
    evidencePath: string;
    bindFailure: Record<string, unknown>;
  },
): AvatarCarrierEvidenceFailureError {
  return new AvatarCarrierEvidenceFailureError(message, {
    avatarCarrierEvidence: {
      avatarInstanceId: input.avatarInstanceId,
      expectedConversationAnchorId: input.expectedConversationAnchorId,
      evidencePath: input.evidencePath,
      bindFailure: compactRuntimeBindFailure(input.bindFailure),
    },
  });
}

function describeAvatarFailureRecord(record: Record<string, unknown>): string {
  const detail = recordDetail(record);
  const parts = [
    `kind=${recordKind(record)}`,
    `source=${String(detail.source || 'unknown')}`,
    `phase=${String(detail.phase || 'unknown')}`,
    `message=${String(detail.message || detail.reason || detail.error || 'unknown')}`,
  ];
  if (typeof detail.window_label === 'string' && detail.window_label.trim().length > 0) {
    parts.push(`window=${detail.window_label}`);
  }
  return parts.join(' ');
}

function hasLive2dHitRegionDefault(record: Record<string, unknown> | null): boolean {
  const detail = record ? recordDetail(record) : {};
  const metadata = detail.backend_metadata && typeof detail.backend_metadata === 'object' && !Array.isArray(detail.backend_metadata)
    ? detail.backend_metadata as Record<string, unknown>
    : {};
  const hitRegion = metadata.hit_region_default && typeof metadata.hit_region_default === 'object' && !Array.isArray(metadata.hit_region_default)
    ? metadata.hit_region_default as Record<string, unknown>
    : {};
  const body = hitRegion.body && typeof hitRegion.body === 'object' && !Array.isArray(hitRegion.body)
    ? hitRegion.body as Record<string, unknown>
    : {};
  const drag = hitRegion.drag && typeof hitRegion.drag === 'object' && !Array.isArray(hitRegion.drag)
    ? hitRegion.drag as Record<string, unknown>
    : {};
  return (
    Number(body.left) === 0
    && Number(body.top) === 0
    && Number(body.right) === 1
    && Number(body.bottom) === 1
    && Number(drag.left) === 0
    && Number(drag.top) === 0
    && Number(drag.right) === 1
    && Number(drag.bottom) === 1
  );
}

function isLive2dModelLoadWithHitRegionDefault(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const detail = recordDetail(record);
  const metadata = detail.backend_metadata && typeof detail.backend_metadata === 'object' && !Array.isArray(detail.backend_metadata)
    ? detail.backend_metadata as Record<string, unknown>
    : {};
  const backendKind = typeof detail.backend_kind === 'string' ? detail.backend_kind : '';
  const modelKind = typeof metadata.model_kind === 'string' ? metadata.model_kind : '';
  return backendKind === 'live2d' && modelKind === 'live2d' && hasLive2dHitRegionDefault(record);
}

function isLive2dLocalAvatarAssetResolved(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const detail = recordDetail(record);
  return (
    recordKind(record) === 'avatar.visual.local-asset-resolved'
    && detail.backend_kind === 'live2d'
    && detail.asset_authority === 'local_avatar_asset'
    && detail.resolver_authority === 'avatar_local_materialization'
    && typeof detail.local_asset_ref === 'string'
    && detail.local_asset_ref.trim().length > 0
  );
}

function hasHumanVisibleArtifact(record: Record<string, unknown> | null): boolean {
  const detail = record ? recordDetail(record) : {};
  return (
    typeof detail.human_visible_artifact_path === 'string'
    && detail.human_visible_artifact_path.trim().length > 0
    && detail.artifact_mime_type === 'image/png'
    && Number(detail.artifact_byte_length || 0) > 0
    && Number(detail.canvas_width || 0) > 0
    && Number(detail.canvas_height || 0) > 0
  );
}

function isLive2dInteractionEvidence(record: Record<string, unknown> | null): boolean {
  if (!record || recordKind(record) !== 'avatar.carrier.interaction') {
    return false;
  }
  const detail = recordDetail(record);
  return (
    detail.status === 'ready'
    && detail.source === 'live2d-carrier-surface'
    && typeof detail.active_motion_group === 'string'
    && detail.active_motion_group.trim().length > 0
    && typeof detail.active_expression_id === 'string'
    && detail.active_expression_id.trim().length > 0
    && detail.motion_frame_applied === true
    && detail.expression_frame_applied === true
    && Number(detail.visible_pixels || 0) > 0
    && Number(detail.sampled_pixels || 0) > 0
    && Number(detail.canvas_width || 0) > 0
    && Number(detail.canvas_height || 0) > 0
  );
}

export async function waitForAvatarCarrierEvidence(
  deps: DesktopMacosSmokeDriverDeps,
  avatarInstanceId: string,
  expectedConversationAnchorId: string,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const result = await deps.readAvatarEvidence(avatarInstanceId);
      const records = readEvidenceRecords(result.evidence);
      const latestRecords = [...records].reverse();
      const startupTerminal = latestRecords.find((record) => {
        if (recordConversationAnchorId(record) !== expectedConversationAnchorId) {
          return false;
        }
        const kind = recordKind(record);
        return kind === 'avatar.startup.runtime-bound' || kind === 'avatar.startup.failed';
      }) || null;
      if (startupTerminal && recordKind(startupTerminal) === 'avatar.startup.failed') {
        const detail = recordDetail(startupTerminal);
        throw new Error(`Avatar runtime-bound startup failed: ${String(detail.error || 'unknown startup failure')}`);
      }
      const startup = startupTerminal && recordKind(startupTerminal) === 'avatar.startup.runtime-bound'
        ? startupTerminal
        : null;
      const startupRecordedAt = startup ? recordTimeMs(startup) : 0;
      const recordsForCurrentStartup = startupRecordedAt > 0
        ? latestRecords.filter((record) => recordTimeMs(record) >= startupRecordedAt)
        : latestRecords;
      const bindFailure = recordsForCurrentStartup.find((record) => (
        recordKind(record) === 'avatar.runtime.bind-failed'
        && recordConversationAnchorId(record) === expectedConversationAnchorId
      )) || null;
      if (bindFailure) {
        throw avatarCarrierEvidenceFailure(
          `Avatar Runtime consume failed: ${describeRuntimeBindFailure(bindFailure)}`,
          {
            avatarInstanceId,
            expectedConversationAnchorId,
            evidencePath: result.evidencePath,
            bindFailure,
          },
        );
      }
      const preAnchorBindFailure = recordsForCurrentStartup.find((record) => (
        recordKind(record) === 'avatar.runtime.bind-failed'
        && recordConversationAnchorId(record) === ''
        && recordAvatarInstanceId(record) === avatarInstanceId
      )) || null;
      if (preAnchorBindFailure) {
        throw avatarCarrierEvidenceFailure(
          `Avatar Runtime consume failed before anchor binding: ${describeRuntimeBindFailure(preAnchorBindFailure)}`,
          {
            avatarInstanceId,
            expectedConversationAnchorId,
            evidencePath: result.evidencePath,
            bindFailure: preAnchorBindFailure,
          },
        );
      }
      const terminalFailure = recordsForCurrentStartup.find((record) => {
        const kind = recordKind(record);
        return kind === 'avatar.renderer.failed' || kind === 'avatar.window.destroyed';
      }) || null;
      if (terminalFailure) {
        throw new Error(`Avatar renderer/window lifecycle failed before visual readiness: ${describeAvatarFailureRecord(terminalFailure)}`);
      }
      const consumeReady = recordsForCurrentStartup.find((record) => (
        recordKind(record) === 'avatar.runtime.consume-ready'
        && recordConversationAnchorId(record) === expectedConversationAnchorId
      )) || null;
      const localAssetResolved = recordsForCurrentStartup.find((record) => (
        recordKind(record) === 'avatar.visual.local-asset-resolved'
        && recordConversationAnchorId(record) === expectedConversationAnchorId
      )) || null;
      const modelLoad = recordsForCurrentStartup.find((record) => (
        recordKind(record) === 'avatar.model.load'
        && recordConversationAnchorId(record) === expectedConversationAnchorId
      )) || null;
      const visibleFrame = recordsForCurrentStartup.find((record) => {
        if (recordKind(record) !== 'avatar.carrier.visual') {
          return false;
        }
        if (recordConversationAnchorId(record) !== expectedConversationAnchorId) {
          return false;
        }
        const detail = recordDetail(record);
        return detail.status === 'ready' && Number(detail.visible_pixels || 0) > 0;
      }) || null;
      const visual = visibleFrame && hasHumanVisibleArtifact(visibleFrame) ? visibleFrame : null;
      const lifecycleMounted = recordsForCurrentStartup.find((record) => {
        if (recordKind(record) !== 'avatar.carrier.visual') {
          return false;
        }
        if (recordConversationAnchorId(record) !== expectedConversationAnchorId) {
          return false;
        }
        const detail = recordDetail(record);
        return detail.lifecycle === 'mounted' && detail.source === 'live2d-carrier-surface';
      }) || null;
      const hitRegionDefault = hasLive2dHitRegionDefault(modelLoad);
      const live2dModelLoad = isLive2dModelLoadWithHitRegionDefault(modelLoad);
      const live2dLocalAssetResolved = isLive2dLocalAvatarAssetResolved(localAssetResolved);
      const localAssetResolvedTime = localAssetResolved ? recordTimeMs(localAssetResolved) : 0;
      const modelLoadTime = modelLoad ? recordTimeMs(modelLoad) : 0;
      const visibleFrameTime = visibleFrame ? recordTimeMs(visibleFrame) : 0;
      const localAssetResolvedBeforeModelLoad = localAssetResolvedTime > 0
        && modelLoadTime > 0
        && localAssetResolvedTime <= modelLoadTime;
      const localAssetResolvedBeforeVisibleFrame = localAssetResolvedTime > 0
        && visibleFrameTime > 0
        && localAssetResolvedTime <= visibleFrameTime;
      const visualArtifact = hasHumanVisibleArtifact(visibleFrame);
      if (
        startup
        && consumeReady
        && live2dLocalAssetResolved
        && localAssetResolvedBeforeModelLoad
        && localAssetResolvedBeforeVisibleFrame
        && live2dModelLoad
        && lifecycleMounted
        && visual
      ) {
        return {
          evidencePath: result.evidencePath,
          evidence: result.evidence,
          startup,
          consumeReady,
          localAssetResolved,
          modelLoad,
          lifecycleMounted,
          visual,
        };
      }
      lastError = `anchor=${expectedConversationAnchorId} requirements=`
        + `startup:${Boolean(startup)} consumeReady:${Boolean(consumeReady)} localAssetResolved:${Boolean(localAssetResolved)} `
        + `live2dLocalAssetResolved:${live2dLocalAssetResolved} modelLoad:${Boolean(modelLoad)} `
        + `localAssetResolvedBeforeModelLoad:${localAssetResolvedBeforeModelLoad} `
        + `localAssetResolvedBeforeVisibleFrame:${localAssetResolvedBeforeVisibleFrame} `
        + `live2dModelLoad:${live2dModelLoad} hitRegionDefault:${hitRegionDefault} `
        + `lifecycleMounted:${Boolean(lifecycleMounted)} visual:${Boolean(visibleFrame)} visualArtifact:${visualArtifact} `
        + `records=${records.map((record) => `${recordKind(record)}:${recordConversationAnchorId(record) || 'no-anchor'}`).join(',') || 'none'}`;
    } catch (error) {
      if (error instanceof AvatarCarrierEvidenceFailureError) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error || 'unknown evidence read error');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`missing same-anchor Avatar local asset/SDK/model/visual evidence for ${avatarInstanceId} anchor=${expectedConversationAnchorId}: ${lastError}`);
}

export async function waitForAvatarLive2dInteractionEvidence(
  deps: DesktopMacosSmokeDriverDeps,
  avatarInstanceId: string,
  expectedConversationAnchorId: string,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const result = await deps.readAvatarEvidence(avatarInstanceId);
      const records = readEvidenceRecords(result.evidence);
      const latestRecords = [...records].reverse();
      const interaction = latestRecords.find((record) => (
        recordConversationAnchorId(record) === expectedConversationAnchorId
        && isLive2dInteractionEvidence(record)
      )) || null;
      if (interaction) {
        return {
          evidencePath: result.evidencePath,
          evidence: result.evidence,
          interaction,
        };
      }
      lastError = `anchor=${expectedConversationAnchorId} interaction:false records=${records.map((record) => `${recordKind(record)}:${recordConversationAnchorId(record) || 'no-anchor'}`).join(',') || 'none'}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || 'unknown evidence read error');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`missing same-anchor Avatar Live2D motion/expression interaction evidence for ${avatarInstanceId} anchor=${expectedConversationAnchorId}: ${lastError}`);
}

export async function waitForAvatarLocalAssetDegradedEvidence(
  deps: DesktopMacosSmokeDriverDeps,
  avatarInstanceId: string,
  expectedConversationAnchorId: string,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const result = await deps.readAvatarEvidence(avatarInstanceId);
      const records = readEvidenceRecords(result.evidence);
      const latestRecords = [...records].reverse();
      const bindFailure = latestRecords.find((record) => {
        if (recordKind(record) !== 'avatar.runtime.bind-failed') {
          return false;
        }
        if (recordConversationAnchorId(record) !== expectedConversationAnchorId) {
          return false;
        }
        const detail = recordDetail(record);
        return (
          detail.error_stage === 'local_avatar_asset_manifest'
          && detail.error_reason_code === 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED'
          && detail.error_action_hint === 'reimport_or_select_local_avatar_asset'
          && detail.error_source === 'avatar_local_materialization'
          && detail.error_retryable === false
        );
      }) || null;
      const bindFailureTime = bindFailure ? recordTimeMs(bindFailure) : 0;
      const degradedTransition = latestRecords.find((record) => {
        if (recordKind(record) !== 'avatar.composition.transition') {
          return false;
        }
        if (bindFailureTime > 0 && recordTimeMs(record) < bindFailureTime) {
          return false;
        }
        const detail = recordDetail(record);
        return (
          detail.to === 'degraded_runtime_unavailable'
          && detail.stage === 'local_avatar_asset_manifest'
          && detail.reason_code === 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED'
          && detail.action_hint === 'reimport_or_select_local_avatar_asset'
          && detail.source === 'avatar_local_materialization'
          && detail.retryable === false
        );
      }) || null;
      const degradedSurface = latestRecords.find((record) => {
        if (recordKind(record) !== 'avatar.composition.surface-mounted') {
          return false;
        }
        if (bindFailureTime > 0 && recordTimeMs(record) < bindFailureTime) {
          return false;
        }
        const detail = recordDetail(record);
        return (
          detail.surface === 'degraded-surface'
          && detail.composition_state === 'degraded_runtime_unavailable'
        );
      }) || null;
      if (bindFailure && degradedTransition && degradedSurface) {
        return {
          evidencePath: result.evidencePath,
          evidence: result.evidence,
          bindFailure,
          degradedTransition,
          degradedSurface,
        };
      }
      lastError = `anchor=${expectedConversationAnchorId} requirements=`
        + `bindFailure:${Boolean(bindFailure)} degradedTransition:${Boolean(degradedTransition)} degradedSurface:${Boolean(degradedSurface)} `
        + `records=${records.map((record) => `${recordKind(record)}:${recordConversationAnchorId(record) || 'no-anchor'}`).join(',') || 'none'}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || 'unknown evidence read error');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`missing same-anchor Avatar local asset degraded evidence for ${avatarInstanceId} anchor=${expectedConversationAnchorId}: ${lastError}`);
}
