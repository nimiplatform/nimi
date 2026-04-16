import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { formatAvatarVrmAssetLabel } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import type {
  DesktopAgentAvatarResourceAssetPayload,
  DesktopAgentAvatarResourceRecord,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-types';
import {
  listDesktopAgentAvatarResources,
  readDesktopAgentAvatarResourceAsset,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';
import { convertTauriFileSrc, hasTauriRuntime } from '@runtime/tauri-api';
import { parseDesktopAgentAvatarAssetRef } from './chat-agent-avatar-vrm-viewport-state';

type GlobalBase64Decoder = {
  atob?: (value: string) => string;
  Buffer?: {
    from: (value: string, encoding: string) => {
      toString: (targetEncoding: string) => string;
    };
  };
};

type CubismModel3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    DisplayInfo?: string;
    Expressions?: Array<{
      Name?: string;
      File?: string;
    }>;
    Motions?: Record<string, unknown[] | null | undefined>;
  };
};

export type ChatAgentAvatarLive2dModelSource = {
  resourceId: string | null;
  fileUrl: string | null;
  modelUrl: string;
  assetLabel: string;
  motionGroups: string[];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  resolvedAssetUrls: string[];
  cleanup?: (() => void) | null;
};

export type ChatAgentAvatarLive2dViewportState = {
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'];
  emotion: NonNullable<AvatarVrmViewportRenderInput['snapshot']['interaction']['emotion']> | 'neutral';
  amplitude: number;
  badgeLabel: string;
  assetLabel: string;
  motionSpeed: number;
  accentColor: string;
  glowColor: string;
};

type ChatAgentAvatarLive2dSourceDependencies = {
  listResources: () => Promise<DesktopAgentAvatarResourceRecord[]>;
  readAsset: (resourceId: string) => Promise<DesktopAgentAvatarResourceAssetPayload>;
};

const DEFAULT_SOURCE_DEPENDENCIES: ChatAgentAvatarLive2dSourceDependencies = {
  listResources: listDesktopAgentAvatarResources,
  readAsset: readDesktopAgentAvatarResourceAsset,
};

function phaseLabel(
  phase: AvatarVrmViewportRenderInput['snapshot']['interaction']['phase'],
): string {
  switch (phase) {
    case 'thinking':
      return 'Thinking';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'transitioning':
      return 'Transitioning';
    case 'idle':
    default:
      return 'Ready';
  }
}

function clampUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function resolvePalette(
  emotion: ChatAgentAvatarLive2dViewportState['emotion'],
): Pick<ChatAgentAvatarLive2dViewportState, 'accentColor' | 'glowColor'> {
  switch (emotion) {
    case 'joy':
      return { accentColor: '#fb7185', glowColor: '#fecdd3' };
    case 'focus':
      return { accentColor: '#38bdf8', glowColor: '#bae6fd' };
    case 'calm':
      return { accentColor: '#2dd4bf', glowColor: '#99f6e4' };
    case 'playful':
      return { accentColor: '#f59e0b', glowColor: '#fde68a' };
    case 'concerned':
      return { accentColor: '#8b5cf6', glowColor: '#ddd6fe' };
    case 'surprised':
      return { accentColor: '#f97316', glowColor: '#fdba74' };
    case 'neutral':
    default:
      return { accentColor: '#0ea5e9', glowColor: '#bfdbfe' };
  }
}

function decodeDesktopAgentAvatarAssetText(base64: string): string {
  const globalDecoder = globalThis as typeof globalThis & GlobalBase64Decoder;
  if (typeof globalDecoder.atob === 'function') {
    const binary = globalDecoder.atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  if (globalDecoder.Buffer) {
    return globalDecoder.Buffer.from(base64, 'base64').toString('utf8');
  }
  throw new Error('Live2D model payload cannot be decoded');
}

export function parseChatAgentAvatarLive2dModelSettings(
  asset: DesktopAgentAvatarResourceAssetPayload,
): { motionGroups: string[]; parsed: CubismModel3Json } {
  const jsonText = decodeDesktopAgentAvatarAssetText(asset.base64);
  const parsed = JSON.parse(jsonText) as CubismModel3Json;
  const motionGroups = Object.keys(parsed.FileReferences?.Motions || {});
  return {
    motionGroups,
    parsed,
  };
}

function resolveAbsoluteLive2dFileUrl(baseFileUrl: string, relativePath: string): string {
  const resolved = new URL(relativePath, baseFileUrl);
  return resolveChatAgentAvatarLive2dAssetUrl(resolved.toString()) || resolved.toString();
}

function rewriteLive2dModelSettingsForDesktopAsset(input: {
  parsed: CubismModel3Json;
  baseFileUrl: string;
}): { jsonText: string; resolvedAssetUrls: string[] } {
  const next: CubismModel3Json = JSON.parse(JSON.stringify(input.parsed)) as CubismModel3Json;
  const resolvedAssetUrls = new Set<string>();
  const remember = (value: string) => {
    resolvedAssetUrls.add(value);
    return value;
  };
  const fileReferences = next.FileReferences;
  if (fileReferences?.Moc) {
    fileReferences.Moc = remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, fileReferences.Moc));
  }
  if (Array.isArray(fileReferences?.Textures)) {
    fileReferences.Textures = fileReferences.Textures.map((entry) => (
      typeof entry === 'string'
        ? remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, entry))
        : entry
    ));
  }
  if (fileReferences?.Physics) {
    fileReferences.Physics = remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, fileReferences.Physics));
  }
  if (fileReferences?.DisplayInfo) {
    fileReferences.DisplayInfo = remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, fileReferences.DisplayInfo));
  }
  if (Array.isArray(fileReferences?.Expressions)) {
    fileReferences.Expressions = fileReferences.Expressions.map((entry) => (
      entry?.File
        ? {
          ...entry,
          File: remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, entry.File)),
        }
        : entry
    ));
  }
  if (fileReferences?.Motions) {
    for (const [group, motions] of Object.entries(fileReferences.Motions)) {
      if (!Array.isArray(motions)) {
        continue;
      }
      fileReferences.Motions[group] = motions.map((motion) => {
        if (!motion || typeof motion !== 'object') {
          return motion;
        }
        const record = motion as Record<string, unknown>;
        return typeof record.File === 'string'
          ? {
            ...record,
            File: remember(resolveAbsoluteLive2dFileUrl(input.baseFileUrl, record.File)),
          }
          : record;
      });
    }
  }
  return {
    jsonText: JSON.stringify(next),
    resolvedAssetUrls: [...resolvedAssetUrls],
  };
}

export function resolvePreferredLive2dIdleMotionGroup(groups: string[]): string | null {
  const exact = groups.find((group) => group.trim().toLowerCase() === 'idle');
  if (exact) {
    return exact;
  }
  return groups.find((group) => {
    const normalized = group.trim().toLowerCase();
    return normalized.includes('idle') || normalized.includes('home') || normalized.includes('default');
  }) || null;
}

export function resolvePreferredLive2dSpeechMotionGroup(groups: string[]): string | null {
  return groups.find((group) => {
    const normalized = group.trim().toLowerCase();
    return normalized.includes('speak')
      || normalized.includes('talk')
      || normalized.includes('voice')
      || normalized.includes('mouth');
  }) || null;
}

export function resolveChatAgentAvatarLive2dAssetUrl(assetRef: string): string | null {
  const normalized = assetRef.trim();
  if (!normalized || normalized.startsWith('fallback://') || normalized.startsWith('desktop-avatar://')) {
    return null;
  }
  if (normalized.toLowerCase().startsWith('file://') && hasTauriRuntime()) {
    try {
      const parsed = new URL(normalized);
      const pathname = decodeURIComponent(parsed.pathname || '');
      if (!pathname) {
        return normalized;
      }
      const resolvedPath = parsed.hostname
        ? `//${parsed.hostname}${pathname}`
        : pathname;
      return convertTauriFileSrc(resolvedPath);
    } catch {
      return normalized;
    }
  }
  return normalized;
}

function assertReadyLive2dResource(
  resource: DesktopAgentAvatarResourceRecord | null | undefined,
  resourceId: string,
): DesktopAgentAvatarResourceRecord {
  if (!resource) {
    throw new Error(`Live2D resource ${resourceId} is unavailable`);
  }
  if (resource.kind !== 'live2d') {
    throw new Error(`Avatar resource ${resourceId} is not a Live2D resource`);
  }
  if (resource.status !== 'ready') {
    throw new Error(`Live2D resource ${resourceId} is not ready`);
  }
  return resource;
}

export async function loadChatAgentAvatarLive2dModelSource(
  assetRef: string,
  dependencies: ChatAgentAvatarLive2dSourceDependencies = DEFAULT_SOURCE_DEPENDENCIES,
): Promise<ChatAgentAvatarLive2dModelSource> {
  const localAsset = parseDesktopAgentAvatarAssetRef(assetRef);
  if (!localAsset) {
    const modelUrl = resolveChatAgentAvatarLive2dAssetUrl(assetRef);
    if (!modelUrl) {
      throw new Error('Live2D asset reference is invalid');
    }
    return {
      resourceId: null,
      fileUrl: null,
      modelUrl,
      assetLabel: formatAvatarVrmAssetLabel(assetRef) || 'avatar.model3.json',
      motionGroups: [],
      idleMotionGroup: null,
      speechMotionGroup: null,
      resolvedAssetUrls: [],
      cleanup: null,
    };
  }

  const [resources, modelAsset] = await Promise.all([
    dependencies.listResources(),
    dependencies.readAsset(localAsset.resourceId),
  ]);
  const resource = assertReadyLive2dResource(
    resources.find((item) => item.resourceId === localAsset.resourceId),
    localAsset.resourceId,
  );
  const modelUrl = resolveChatAgentAvatarLive2dAssetUrl(resource.fileUrl);
  if (!modelUrl) {
    throw new Error(`Live2D resource ${localAsset.resourceId} is missing a concrete model URL`);
  }
  const { motionGroups, parsed } = parseChatAgentAvatarLive2dModelSettings(modelAsset);
  const rewrittenSettings = rewriteLive2dModelSettingsForDesktopAsset({
    parsed,
    baseFileUrl: resource.fileUrl,
  });
  const objectUrl = URL.createObjectURL(new Blob([rewrittenSettings.jsonText], {
    type: modelAsset.mimeType || 'application/json',
  }));
  return {
    resourceId: resource.resourceId,
    fileUrl: resource.fileUrl,
    modelUrl: objectUrl,
    assetLabel: resource.displayName || resource.sourceFilename || 'avatar.model3.json',
    motionGroups,
    idleMotionGroup: resolvePreferredLive2dIdleMotionGroup(motionGroups),
    speechMotionGroup: resolvePreferredLive2dSpeechMotionGroup(motionGroups),
    resolvedAssetUrls: rewrittenSettings.resolvedAssetUrls,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

export function resolveChatAgentAvatarLive2dViewportState(
  input: AvatarVrmViewportRenderInput,
  source?: Pick<ChatAgentAvatarLive2dModelSource, 'assetLabel'> | null,
): ChatAgentAvatarLive2dViewportState {
  const phase = input.snapshot.interaction.phase;
  const emotion = input.snapshot.interaction.emotion || 'neutral';
  const amplitude = clampUnit(input.snapshot.interaction.amplitude);
  const palette = resolvePalette(emotion);

  return {
    phase,
    emotion,
    amplitude,
    badgeLabel: input.snapshot.interaction.actionCue || phaseLabel(phase),
    assetLabel: source?.assetLabel || formatAvatarVrmAssetLabel(input.assetRef) || 'avatar.model3.json',
    motionSpeed: phase === 'speaking'
      ? 1.1 + amplitude * 0.8
      : phase === 'thinking'
        ? 0.68
        : phase === 'listening'
          ? 0.76
          : 0.52,
    accentColor: palette.accentColor,
    glowColor: palette.glowColor,
  };
}
