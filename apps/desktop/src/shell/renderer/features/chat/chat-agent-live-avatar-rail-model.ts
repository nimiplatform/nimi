import type { AvatarPresentationProfile, AvatarStageSnapshot } from '@nimiplatform/nimi-kit/features/avatar/headless';
import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';

function slugifySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

function resolveFallbackPhaseLabel(
  phase: NonNullable<ConversationCharacterData['interactionState']>['phase'] | null | undefined,
): string {
  switch (phase) {
    case 'thinking':
      return 'Thinking';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'loading':
      return 'Transitioning';
    case 'idle':
    default:
      return 'Here with you';
  }
}

function readDesktopEnv(name: string): string {
  if (typeof globalThis.process === 'undefined') {
    return '';
  }
  const env = (globalThis.process as { env?: Record<string, string | undefined> }).env ?? {};
  return String(env[name] || '').trim();
}

function normalizeLocalFileAssetRef(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('file://')) {
    return normalized;
  }
  if (!normalized.startsWith('/')) {
    return '';
  }
  return new URL(normalized, 'file://').toString();
}

function resolveDesktopLocalSampleVrmAssetRef(): string {
  const explicit = normalizeLocalFileAssetRef(readDesktopEnv('NIMI_DESKTOP_LIVE_AVATAR_SAMPLE_VRM'));
  if (explicit) {
    return explicit;
  }
  const home = readDesktopEnv('HOME');
  if (!home) {
    return '';
  }
  const candidate = `${home.replace(/\/+$/, '')}/Downloads/AliciaSolid.vrm`;
  return new URL(candidate, 'file://').toString();
}

function resolveLiveAvatarPresentationProfile(input: {
  displayName: string;
  presentationProfile?: AvatarPresentationProfile | null;
}): AvatarPresentationProfile {
  const presentationProfile = input.presentationProfile || null;
  if (presentationProfile?.backendKind === 'vrm') {
    return presentationProfile;
  }
  const localSampleAssetRef = resolveDesktopLocalSampleVrmAssetRef();
  return {
    backendKind: 'vrm',
    avatarAssetRef: localSampleAssetRef || `fallback://agent-live-rail/${slugifySegment(input.displayName)}`,
    expressionProfileRef: 'desktop://agent-live-rail/default-expression-profile',
    idlePreset: 'desktop-live-rail-idle',
    interactionPolicyRef: 'desktop://agent-live-rail/default-interaction-policy',
    defaultVoiceReference: null,
  };
}

export type ChatAgentLiveAvatarRailModel = {
  displayName: string;
  statusLabel: string;
  presentation: AvatarPresentationProfile;
  snapshot: AvatarStageSnapshot;
  viewportInput: AvatarVrmViewportRenderInput;
};

export function resolveChatAgentLiveAvatarRailModel(input: {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
}): ChatAgentLiveAvatarRailModel {
  const displayName = input.characterData?.name || input.selectedTarget.title || 'Agent';
  const interactionState = input.characterData?.interactionState || null;
  const statusLabel = interactionState?.label || resolveFallbackPhaseLabel(interactionState?.phase);
  const presentation = resolveLiveAvatarPresentationProfile({
    displayName,
    presentationProfile: input.characterData?.avatarPresentationProfile || null,
  });
  const snapshot: AvatarStageSnapshot = {
    presentation,
    interaction: {
      phase: interactionState?.phase === 'loading'
        ? 'transitioning'
        : interactionState?.phase === 'thinking'
          ? 'thinking'
          : interactionState?.phase === 'listening'
            ? 'listening'
            : interactionState?.phase === 'speaking'
              ? 'speaking'
              : 'idle',
      emotion: interactionState?.emotion || 'calm',
      actionCue: statusLabel,
      amplitude: typeof interactionState?.amplitude === 'number' ? interactionState.amplitude : 0.12,
      visemeId: interactionState?.visemeId || null,
    },
  };

  return {
    displayName,
    statusLabel,
    presentation,
    snapshot,
    viewportInput: {
      label: displayName,
      assetRef: presentation.avatarAssetRef,
      posterUrl: input.characterData?.avatarUrl || input.selectedTarget.avatarUrl || null,
      idlePreset: presentation.idlePreset || null,
      expressionProfileRef: presentation.expressionProfileRef || null,
      interactionPolicyRef: presentation.interactionPolicyRef || null,
      defaultVoiceReference: presentation.defaultVoiceReference || null,
      snapshot,
    },
  };
}
