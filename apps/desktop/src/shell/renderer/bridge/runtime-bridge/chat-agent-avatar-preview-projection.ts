import {
  isAvatarControlledPreviewSurfaceRef,
} from '@nimiplatform/kit/features/avatar/headless';
import type { AgentCenterHostCommittedPreviewEvidence } from '@nimiplatform/kit/features/agent-center';
import { invokeChecked } from './invoke.js';

export type DesktopAvatarPreviewProjectionInput = {
  readonly conversationAnchorId: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
};

export type DesktopAvatarPreviewProjectionResult = AgentCenterHostCommittedPreviewEvidence;

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
  if (hostResult.result.backendKind !== input.backendKind
    || hostResult.result.avatarAssetRef !== input.avatarAssetRef) {
    throw new Error('desktop Avatar preview projection result does not match the requested committed appearance');
  }
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
  const conversationAnchorId = requireText(input.conversationAnchorId, 'conversationAnchorId');
  const backendKind = input.backendKind;
  if (backendKind !== 'live2d' && backendKind !== 'vrm') {
    throw new Error('desktop Avatar preview projection backendKind is unsupported');
  }
  return {
    conversationAnchorId,
    backendKind,
    avatarAssetRef: requireText(input.avatarAssetRef, 'avatarAssetRef'),
    presentationRevision: requireText(input.presentationRevision, 'presentationRevision'),
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
    assertExactKeys(record, [
      'state', 'tier', 'backendKind', 'avatarAssetRef', 'previewMaterialRef', 'previewImageRef', 'warnings',
    ], 'desktop Avatar ready preview projection');
    const previewImageRef = requireText(record.previewImageRef, 'previewImageRef');
    if (!isAvatarControlledPreviewSurfaceRef(previewImageRef)) {
      throw new Error('desktop Avatar preview projection returned an uncontrolled Avatar surface ref');
    }
    return {
      state,
      tier: 'avatar_preview_service',
      backendKind: parseBackendKind(record.backendKind),
      avatarAssetRef: requireText(record.avatarAssetRef, 'avatarAssetRef'),
      previewMaterialRef: requireText(record.previewMaterialRef, 'previewMaterialRef'),
      previewImageRef,
      warnings: parseWarnings(record.warnings),
    };
  }
  if (state !== 'failed' && state !== 'unavailable') {
    throw new Error('desktop Avatar preview projection returned an invalid state');
  }
  assertExactKeys(record, [
    'state', 'tier', 'backendKind', 'avatarAssetRef', 'previewMaterialRef', 'previewImageRef', 'reason', 'warnings',
  ], 'desktop Avatar non-ready preview projection');
  return {
    state,
    tier: 'avatar_preview_service',
    backendKind: parseBackendKind(record.backendKind),
    avatarAssetRef: requireText(record.avatarAssetRef, 'avatarAssetRef'),
    previewMaterialRef: optionalText(record.previewMaterialRef),
    previewImageRef: null,
    reason: requireText(record.reason, 'reason'),
    warnings: parseWarnings(record.warnings),
  };
}

function parseBackendKind(value: unknown): 'live2d' | 'vrm' {
  if (value !== 'live2d' && value !== 'vrm') {
    throw new Error('desktop Avatar preview projection returned an invalid backendKind');
  }
  return value;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${field} contains unsupported fields`);
  }
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
