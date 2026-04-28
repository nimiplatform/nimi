import { invoke } from '@tauri-apps/api/core';
import { useAvatarStore } from './app-store.js';

export type AvatarEvidenceKind =
  | 'avatar.renderer.boot'
  | 'avatar.renderer.entry-loaded'
  | 'avatar.renderer.failed'
  | 'avatar.renderer.launch-context-read'
  | 'avatar.launch.context-bound'
  | 'avatar.window.page-loaded'
  | 'avatar.startup.runtime-bound'
  | 'avatar.startup.failed'
  | 'avatar.visual.package-resolved'
  | 'avatar.visual.model3-found'
  | 'avatar.visual.model-loaded'
  | 'avatar.runtime.bind-failed'
  | 'avatar.runtime.bound'
  | 'avatar.model.load'
  | 'avatar.carrier.visual';

export type AvatarEvidencePayload = {
  kind: AvatarEvidenceKind;
  detail: Record<string, unknown>;
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
  await invoke('nimi_avatar_record_evidence', {
    payload: {
      kind: input.kind,
      recordedAt: new Date().toISOString(),
      detail: input.detail,
      consume: snapshot.consume,
      model: snapshot.model,
    },
  });
}

export function recordAvatarEvidenceEventually(input: AvatarEvidencePayload): void {
  void recordAvatarEvidence(input).catch((error: unknown) => {
    console.warn(`[avatar:evidence] failed to record ${input.kind}: ${error instanceof Error ? error.message : String(error)}`);
  });
}
