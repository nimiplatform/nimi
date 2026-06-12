import type {
  AvatarLive2dViewportRenderInput,
  AvatarLive2dViewportState,
} from '@nimiplatform/kit/features/avatar/live2d';
import {
  resolveAvatarLive2dViewportState,
  resolvePreferredLive2dIdleMotionGroup,
  resolvePreferredLive2dSpeechMotionGroup,
} from '@nimiplatform/kit/features/avatar/live2d';
import { formatAvatarVrmAssetLabel } from '@nimiplatform/kit/features/avatar/vrm';

type GlobalBase64Decoder = {
  atob?: (value: string) => string;
  Buffer?: {
    from: (value: string, encoding: string) => {
      toString: (targetEncoding: string) => string;
    };
  };
};

type AvatarAssetPayload = {
  mimeType: string;
  base64: string;
};

type CubismModel3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    Expressions?: Array<{
      Name?: string;
      File?: string;
    }>;
    Motions?: Record<string, unknown[] | null | undefined>;
  };
};

const LIVE2D_MOC3_MAGIC = 'MOC3';

export type ChatAgentAvatarLive2dModelSource = {
  resourceId: string | null;
  fileUrl: string | null;
  modelUrl: string;
  runtimeSource: string | Record<string, unknown>;
  runtimeAssetPayloads?: Record<string, AvatarAssetPayload> | null;
  assetLabel: string;
  mocVersion: number | null;
  motionGroups: string[];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  resolvedAssetUrls: string[];
  cleanup?: (() => void) | null;
};

export type ChatAgentAvatarLive2dViewportState = AvatarLive2dViewportState;

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

function decodeDesktopAgentAvatarAssetBytes(base64: string): Uint8Array {
  const globalDecoder = globalThis as typeof globalThis & GlobalBase64Decoder;
  if (typeof globalDecoder.atob === 'function') {
    const binary = globalDecoder.atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (globalDecoder.Buffer) {
    const binary = globalDecoder.Buffer.from(base64, 'base64').toString('binary');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  throw new Error('Live2D asset payload cannot be decoded');
}

export function parseChatAgentAvatarLive2dModelSettings(
  asset: AvatarAssetPayload,
): { motionGroups: string[]; parsed: CubismModel3Json } {
  const jsonText = decodeDesktopAgentAvatarAssetText(asset.base64);
  const parsed = JSON.parse(jsonText) as CubismModel3Json;
  const motionGroups = Object.keys(parsed.FileReferences?.Motions || {});
  return {
    motionGroups,
    parsed,
  };
}

export function parseChatAgentAvatarLive2dMocVersion(
  asset: AvatarAssetPayload,
): number | null {
  const bytes = decodeDesktopAgentAvatarAssetBytes(asset.base64);
  if (bytes.byteLength < 8) {
    return null;
  }
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== LIVE2D_MOC3_MAGIC) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true);
}

export { resolvePreferredLive2dIdleMotionGroup, resolvePreferredLive2dSpeechMotionGroup };

export function resolveChatAgentAvatarLive2dAssetUrl(assetRef: string): string | null {
  const normalized = assetRef.trim();
  void normalized;
  return null;
}

export async function loadChatAgentAvatarLive2dModelSource(assetRef: string): Promise<ChatAgentAvatarLive2dModelSource> {
  const normalized = assetRef.trim();
  if (normalized.startsWith('desktop-avatar://')) {
    throw new Error('desktop-avatar:// asset references are decommissioned; use Avatar-owned local asset materialization.');
  }
  const modelUrl = resolveChatAgentAvatarLive2dAssetUrl(assetRef);
  if (!modelUrl) {
    throw new Error('Live2D asset references must be materialized by the Avatar-owned carrier.');
  }
  return {
    resourceId: null,
    fileUrl: null,
    modelUrl,
    runtimeSource: modelUrl,
    runtimeAssetPayloads: null,
    assetLabel: formatAvatarVrmAssetLabel(assetRef) || 'avatar.model3.json',
    mocVersion: null,
    motionGroups: [],
    idleMotionGroup: null,
    speechMotionGroup: null,
    resolvedAssetUrls: [],
    cleanup: null,
  };
}

export function resolveChatAgentAvatarLive2dViewportState(
  input: AvatarLive2dViewportRenderInput,
  source?: Pick<ChatAgentAvatarLive2dModelSource, 'assetLabel'> | null,
): ChatAgentAvatarLive2dViewportState {
  return resolveAvatarLive2dViewportState(input, source);
}
