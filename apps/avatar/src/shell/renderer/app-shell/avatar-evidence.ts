import { useAvatarStore } from './app-store.js';
import { invokeAvatarHostCommand } from './avatar-host-bridge.js';

export type AvatarEvidenceKind =
  | 'avatar.renderer.boot'
  | 'avatar.renderer.entry-loaded'
  | 'avatar.renderer.failed'
  | 'avatar.renderer.launch-context-read'
  | 'avatar.launch.context-bound'
  | 'avatar.window.created'
  | 'avatar.window.page-loaded'
  | 'avatar.window.destroyed'
  | 'avatar.runtime.identity-bound'
  | 'avatar.startup.runtime-bound'
  | 'avatar.startup.failed'
  | 'avatar.visual.local-asset-resolved'
  | 'avatar.visual.package-resolved'
  | 'avatar.visual.model3-found'
  | 'avatar.visual.model-loaded'
  | 'avatar.runtime.bind-failed'
  | 'avatar.runtime.bound'
  | 'avatar.runtime.consume-ready'
  | 'avatar.runtime.driver-error'
  | 'avatar.debug.probe-submit-failed'
  | 'avatar.debug.probe-submit-skipped'
  | 'avatar.live2d.expression-inventory'
  | 'avatar.model.load'
  | 'avatar.carrier.visual'
  | 'avatar.carrier.lifecycle.context_lost'
  | 'avatar.carrier.lifecycle.context_restored'
  | 'avatar.carrier.lifecycle.failed_closed'
  | 'avatar.audio.pipeline.ready'
  | 'avatar.audio.pipeline.failed'
  | 'avatar.audio.lifecycle.state_changed'
  | 'avatar.audio.native_stream_projection_received'
  | 'avatar.audio.native_stream_chunk_played'
  | 'avatar.audio.native_stream_chunk_failed'
  | 'avatar.audio.native_stream_subscription_failed'
  | 'avatar.audio.privacy.indicator_changed'
  | 'avatar.hit_region.degraded'
  | 'avatar.carrier.interaction'
  | 'avatar.debug.session-evidence'
  // Wave 1 K-NAV-SHELL-COMPOSITION-004 — composition state machine evidence.
  | 'avatar.composition.transition'
  | 'avatar.composition.relaunch-pending'
  | 'avatar.composition.surface-mounted'
  | 'avatar.composition.surface-unmounted'
  // Wave 2 K-NAV-SHELL-OUTPUT-004/009 — transient context menu lifecycle.
  | 'avatar.shell.context_menu.opened'
  | 'avatar.shell.context_menu.dismissed'
  | 'avatar.shell.action_radial.opened'
  | 'avatar.shell.action_radial.selected'
  | 'avatar.shell.action_radial.dismissed'
  | 'avatar.shell.composer.opened'
  | 'avatar.shell.composer.submitted'
  | 'avatar.shell.composer.send-failed'
  | 'avatar.shell.composer.dismissed'
  | 'avatar.shell.scale.changed'
  | 'avatar.shell.scale.reset'
  | 'avatar.shell.foreground_priority.requested'
  | 'avatar.shell.appearance.opened'
  | 'avatar.shell.settings.changed'
  | 'avatar.shell.hide-requested'
  | 'avatar.shell.close-requested'
  | 'avatar.shell.interrupt.requested'
  | 'avatar.shell.interrupt.failed'
  | 'avatar.shell.debug.opened'
  | 'avatar.shell.debug.request-failed'
  // Wave 4 K-NAV-SHELL-002 — dynamic window-bounds recompute evidence.
  // Per avatar-event-contract.md §2.6 + §4 detail schemas.
  | 'avatar.shell.window-bounds-changed'
  // Topic 2026-04-30 wave_4 chunk 4-C — device tier detection (one-shot
  // at avatar boot, drives alpha-mask vs bbox-only fallback in the
  // per-backend hit-region constructors).
  | 'avatar.device.tier_detected';

// Surface identifier carried on `avatar.composition.surface-mounted` /
// `surface-unmounted` evidence per avatar-event-contract.md §4.
export type AvatarCompositionSurface =
  | 'embodiment-stage'
  | 'context-menu'
  | 'action-radial'
  | 'transient-composer'
  | 'settings-overlay'
  | 'appearance-overlay'
  | 'debug-overlay'
  | 'caption-overlay'
  | 'degraded-surface';

export type AvatarEvidencePayload = {
  kind: AvatarEvidenceKind;
  detail: Record<string, unknown>;
};

export type AvatarEvidenceArtifactWriteResult = {
  artifactPath: string;
  artifactMimeType: string;
  artifactByteLength: number;
};

function snapshotEvidenceContext() {
  const state = useAvatarStore.getState();
  return {
    consume: {
      mode: state.consume.mode,
      authority: state.consume.authority,
      avatarInstanceId: state.consume.avatarInstanceId,
      conversationAnchorId: state.consume.conversationAnchorId,
      agentId: state.consume.agentId,
      worldId: state.consume.worldId,
    },
    model: {
      modelPath: state.model.modelPath,
      modelId: state.model.modelId,
      loadState: state.model.loadState,
      error: state.model.error,
    },
  };
}

export async function recordAvatarEvidence(input: AvatarEvidencePayload): Promise<void> {
  const snapshot = snapshotEvidenceContext();
  await invokeAvatarHostCommand('nimi_avatar_record_evidence', {
    payload: {
      kind: input.kind,
      recordedAt: new Date().toISOString(),
      detail: input.detail,
      consume: snapshot.consume,
      model: snapshot.model,
    },
  });
}

export async function writeAvatarEvidenceArtifact(input: {
  artifactId: string;
  dataUrl: string;
}): Promise<AvatarEvidenceArtifactWriteResult> {
  return invokeAvatarHostCommand<AvatarEvidenceArtifactWriteResult>('nimi_avatar_write_evidence_artifact', {
    payload: {
      artifactId: input.artifactId,
      dataUrl: input.dataUrl,
    },
  });
}

export function recordAvatarEvidenceEventually(input: AvatarEvidencePayload): void {
  void recordAvatarEvidence(input).catch((error: unknown) => {
    console.warn(`[avatar:evidence] failed to record ${input.kind}: ${error instanceof Error ? error.message : String(error)}`);
  });
}
