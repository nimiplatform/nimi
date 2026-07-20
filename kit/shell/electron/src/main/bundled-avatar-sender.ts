import { NimiElectronShellHostError } from './types.js';
import type { RegisterNimiElectronRuntimeBridgeInput } from './types.js';

export function resolveBundledAvatarRendererUrl(
  input: RegisterNimiElectronRuntimeBridgeInput,
  appId: string,
  baseAllowedRendererUrls: readonly string[],
): string | undefined {
  if (!input.bundledAvatarHost) return undefined;
  if (appId !== 'nimi.desktop') {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Only the verified Desktop host can register the bundled Avatar renderer profile',
      reasonCode: 'electron-bundled-avatar-desktop-host-required',
      actionHint: 'register_bundled_avatar_from_desktop_main',
    });
  }
  if (typeof input.bundledAvatarHost.authorizeSender !== 'function' ||
      typeof input.bundledAvatarHost.subscribeSenderInvalidation !== 'function') {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Bundled Avatar host requires exact sender authorization and invalidation',
      reasonCode: 'electron-bundled-avatar-sender-registry-required',
      actionHint: 'provide_desktop_owned_sender_registry',
    });
  }
  let rendererUrl = '';
  try {
    rendererUrl = new URL(input.bundledAvatarHost.rendererUrl.trim()).toString();
  } catch {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Bundled Avatar renderer URL must be one exact absolute URL',
      reasonCode: 'electron-bundled-avatar-renderer-url-invalid',
      actionHint: 'provide_exact_avatar_renderer_url',
    });
  }
  if (baseAllowedRendererUrls.some((candidate) => rendererUrlsEqualExact(candidate, rendererUrl))) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Desktop and bundled Avatar renderer URLs must be disjoint',
      reasonCode: 'electron-bundled-avatar-renderer-url-overlap',
      actionHint: 'use_distinct_desktop_and_avatar_renderer_urls',
    });
  }
  return rendererUrl;
}

export function rendererUrlsEqualExact(left: string | undefined, right: string | undefined): boolean {
  try {
    return new URL(left?.trim() ?? '').toString() === new URL(right?.trim() ?? '').toString();
  } catch {
    return false;
  }
}

export function rendererOriginFromUrl(value: string): string {
  const parsed = new URL(value);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}
