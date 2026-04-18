import { hasTauriRuntime } from '@runtime/tauri-api';
import type { VRM } from '@pixiv/three-vrm';

import type { DesktopAgentAvatarAssetRef } from './chat-agent-avatar-vrm-viewport-state';

export type LoadedVrmState =
  | { status: 'idle' | 'loading'; assetRef: string; vrm: null; error: null }
  | { status: 'ready'; assetRef: string; vrm: VRM; error: null }
  | { status: 'error'; assetRef: string; vrm: null; error: string };

export type VrmViewportStatus = LoadedVrmState['status'];

export const VRM_CONTEXT_RECOVERY_TIMEOUT_MS = 1_500;
const MIN_RENDERABLE_VRM_VIEWPORT_SIZE = 4;

export type ChatAgentAvatarVrmResizePosture = 'tracked-host-size' | 'awaiting-renderable-host';

export type ChatAgentAvatarVrmViewportHostMetrics = {
  width: number;
  height: number;
  renderable: boolean;
};

export type ChatAgentAvatarVrmResolvedAssetState = {
  assetRef: string;
  url: string | null;
  arrayBuffer: ArrayBuffer | null;
};

export type ChatAgentAvatarVrmRuntimeLifecycleState = {
  phase: 'stable' | 'recovering' | 'failed';
  reason: 'host-not-renderable' | 'webgl-context-lost' | 'webgl-context-restored' | null;
  attemptCount: number;
  error: string | null;
};

function resolveChatAgentAvatarVrmResolvedAssetUrl(input: {
  assetRef: string;
  desktopAssetRef: DesktopAgentAvatarAssetRef | null;
  networkAssetUrl: string | null;
  resolvedAsset: ChatAgentAvatarVrmResolvedAssetState;
}): string | null {
  if (input.resolvedAsset.assetRef === input.assetRef) {
    return input.resolvedAsset.url;
  }
  return input.desktopAssetRef ? null : input.networkAssetUrl;
}

export function resolveChatAgentAvatarVrmEffectiveLoadState(input: {
  assetRef: string;
  desktopAssetRef: DesktopAgentAvatarAssetRef | null;
  networkAssetUrl: string | null;
  resolvedAsset: ChatAgentAvatarVrmResolvedAssetState;
  loadedVrm: LoadedVrmState;
}): {
  status: VrmViewportStatus;
  error: string | null;
  assetUrl: string | null;
} {
  const assetUrl = resolveChatAgentAvatarVrmResolvedAssetUrl(input);
  if (input.loadedVrm.assetRef === input.assetRef) {
    return {
      status: input.loadedVrm.status,
      error: input.loadedVrm.error,
      assetUrl,
    };
  }
  return {
    status: assetUrl || input.desktopAssetRef ? 'loading' : 'idle',
    error: null,
    assetUrl,
  };
}

export function createChatAgentAvatarVrmNonReadyState(input: {
  assetRef: string;
  status: 'idle' | 'loading' | 'error';
  error: string | null;
}): LoadedVrmState {
  if (input.status === 'error') {
    return {
      status: 'error',
      assetRef: input.assetRef,
      vrm: null,
      error: input.error || 'VRM viewport failed closed.',
    };
  }
  return {
    status: input.status,
    assetRef: input.assetRef,
    vrm: null,
    error: null,
  };
}

export function resolveChatAgentAvatarVrmViewportHostMetrics(host: HTMLElement | null): ChatAgentAvatarVrmViewportHostMetrics {
  if (!host) {
    return {
      width: 0,
      height: 0,
      renderable: true,
    };
  }
  const rect = host.getBoundingClientRect();
  const width = Math.max(0, Math.round(rect.width));
  const height = Math.max(0, Math.round(rect.height));
  return {
    width,
    height,
    renderable: width >= MIN_RENDERABLE_VRM_VIEWPORT_SIZE && height >= MIN_RENDERABLE_VRM_VIEWPORT_SIZE,
  };
}

export function resolveChatAgentAvatarVrmViewportStatus(input: {
  loadedStatus: VrmViewportStatus;
  loadedError: string | null;
  hostRenderable: boolean;
  runtimeLifecycle: ChatAgentAvatarVrmRuntimeLifecycleState;
}): {
  status: VrmViewportStatus;
  error: string | null;
} {
  if (input.loadedStatus === 'error') {
    return {
      status: 'error',
      error: input.loadedError,
    };
  }
  if (input.runtimeLifecycle.phase === 'failed') {
    return {
      status: 'error',
      error: input.runtimeLifecycle.error,
    };
  }
  if (input.runtimeLifecycle.phase === 'recovering') {
    return {
      status: 'loading',
      error: null,
    };
  }
  if (!input.hostRenderable && input.loadedStatus === 'ready') {
    return {
      status: 'loading',
      error: null,
    };
  }
  return {
    status: input.loadedStatus,
    error: input.loadedError,
  };
}

export function suspendCreateImageBitmapForTauriVrmLoad(): () => void {
  if (!hasTauriRuntime()) {
    return () => {};
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  if (!descriptor || descriptor.configurable === false) {
    return () => {};
  }
  try {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: undefined,
    });
    return () => {
      try {
        Object.defineProperty(globalThis, 'createImageBitmap', descriptor);
      } catch {
        // Fail closed to the current runtime state.
      }
    };
  } catch {
    return () => {};
  }
}
