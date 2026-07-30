import {
  isAvatarControlledPreviewSurfaceRef,
  type AgentCenterAvatarPreviewServiceResult,
} from '@nimiplatform/kit/features/avatar/headless';
import { invokeChecked } from './invoke.js';

export type DesktopAvatarPreviewProjectionInput = {
  readonly agentId: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly previewMaterialRef: string;
  readonly backendCapabilityProfileRef?: string | null;
};

export type DesktopAvatarPreviewProjectionResult =
  | (Extract<AgentCenterAvatarPreviewServiceResult, { readonly state: 'ready' }> & {
      readonly backendKind: 'live2d' | 'vrm';
      readonly previewMaterialRef: string;
    })
  | (Exclude<AgentCenterAvatarPreviewServiceResult, { readonly state: 'ready' }> & {
      readonly backendKind?: 'live2d' | 'vrm' | null;
      readonly previewMaterialRef?: string | null;
      readonly previewImageRef?: null;
      readonly visiblePixels?: null;
      readonly reasonCode?: string;
    });

type DesktopAvatarPreviewProjectionHostResult = {
  readonly result: DesktopAvatarPreviewProjectionResult;
  readonly previewPngBase64?: string | null;
};

export async function requestDesktopAvatarPreviewProjection(
  input: DesktopAvatarPreviewProjectionInput,
): Promise<DesktopAvatarPreviewProjectionResult> {
  const hostResult = await invokeChecked(
    'desktop_avatar_preview_projection',
    { payload: buildDesktopAvatarPreviewProjectionPayload(input) },
    parseDesktopAvatarPreviewProjectionHostResult,
  );
  if (hostResult.result.state !== 'ready' || !hostResult.previewPngBase64) return hostResult.result;
  const pngBytes = decodePngBase64(hostResult.previewPngBase64);
  const pngBuffer = new ArrayBuffer(pngBytes.byteLength);
  new Uint8Array(pngBuffer).set(pngBytes);
  const previewImageRef = URL.createObjectURL(new Blob([pngBuffer], { type: 'image/png' }));
  if (!isAvatarControlledPreviewSurfaceRef(previewImageRef)) {
    URL.revokeObjectURL(previewImageRef);
    throw new Error('desktop Avatar preview projection produced an uncontrolled surface ref');
  }
  return {
    ...hostResult.result,
    previewImageRef,
  };
}

function buildDesktopAvatarPreviewProjectionPayload(
  input: DesktopAvatarPreviewProjectionInput,
): DesktopAvatarPreviewProjectionInput {
  const agentId = requireText(input.agentId, 'agentId');
  if (!agentId.startsWith('local-agent:')) {
    throw new Error('desktop Avatar preview projection requires agentId to be a local-agent ref');
  }
  const backendKind = input.backendKind;
  if (backendKind !== 'live2d' && backendKind !== 'vrm') {
    throw new Error('desktop Avatar preview projection backendKind is unsupported');
  }
  return {
    agentId,
    backendKind,
    avatarAssetRef: requireText(input.avatarAssetRef, 'avatarAssetRef'),
    previewMaterialRef: requireText(input.previewMaterialRef, 'previewMaterialRef'),
    backendCapabilityProfileRef: optionalText(input.backendCapabilityProfileRef),
  };
}

function parseDesktopAvatarPreviewProjectionHostResult(
  value: unknown,
): DesktopAvatarPreviewProjectionHostResult {
  const record = requireRecord(value, 'desktop Avatar preview projection host result');
  const result = parseProjectionResult(record.result);
  const previewPngBase64 = optionalText(record.previewPngBase64);
  if (result.state !== 'ready' && previewPngBase64) {
    throw new Error('desktop Avatar preview projection non-ready result cannot include PNG output');
  }
  return { result, previewPngBase64 };
}

function parseProjectionResult(value: unknown): DesktopAvatarPreviewProjectionResult {
  const record = requireRecord(value, 'desktop Avatar preview projection result');
  if (record.tier !== 'avatar_preview_service') {
    throw new Error('desktop Avatar preview projection returned an invalid tier');
  }
  const state = record.state;
  if (state === 'ready') {
    const backendKind = requireBackendKind(record.backendKind);
    const previewImageRef = requireText(record.previewImageRef, 'previewImageRef');
    if (!isAvatarControlledPreviewSurfaceRef(previewImageRef)) {
      throw new Error('desktop Avatar preview projection returned an uncontrolled Avatar surface ref');
    }
    const visiblePixels = Number(record.visiblePixels);
    if (!Number.isFinite(visiblePixels) || visiblePixels <= 0 || record.nonPlaceholder !== true) {
      throw new Error('desktop Avatar preview projection returned invalid visible-pixel evidence');
    }
    return {
      state,
      tier: 'avatar_preview_service',
      backendKind,
      avatarAssetRef: requireText(record.avatarAssetRef, 'avatarAssetRef'),
      previewMaterialRef: requireText(record.previewMaterialRef, 'previewMaterialRef'),
      previewImageRef,
      visiblePixels,
      nonPlaceholder: true,
      warnings: parseWarnings(record.warnings),
    };
  }
  if (state !== 'failed' && state !== 'unavailable' && state !== 'loading') {
    throw new Error('desktop Avatar preview projection returned an invalid state');
  }
  if (record.nonPlaceholder !== false) {
    throw new Error('desktop Avatar preview projection non-ready result claimed renderer output');
  }
  const backendKind = record.backendKind == null ? null : requireBackendKind(record.backendKind);
  return {
    state,
    tier: 'avatar_preview_service',
    backendKind,
    avatarAssetRef: optionalText(record.avatarAssetRef),
    previewMaterialRef: optionalText(record.previewMaterialRef),
    previewImageRef: null,
    visiblePixels: null,
    nonPlaceholder: false,
    reason: requireText(record.reason, 'reason'),
    reasonCode: optionalText(record.reasonCode) || undefined,
    warnings: parseWarnings(record.warnings),
  };
}

function decodePngBase64(value: unknown): Uint8Array {
  const text = requireText(value, 'previewPngBase64');
  const binary = globalThis.atob(text);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length < 8
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47) {
    throw new Error('desktop Avatar preview projection returned invalid PNG output');
  }
  return bytes;
}

function parseWarnings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('desktop Avatar preview projection warnings are invalid');
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function requireBackendKind(value: unknown): 'live2d' | 'vrm' {
  if (value !== 'live2d' && value !== 'vrm') {
    throw new Error('desktop Avatar preview projection returned an invalid backendKind');
  }
  return value;
}

function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text || text.length > 32_768) throw new Error(`desktop Avatar preview projection requires ${field}`);
  return text;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
