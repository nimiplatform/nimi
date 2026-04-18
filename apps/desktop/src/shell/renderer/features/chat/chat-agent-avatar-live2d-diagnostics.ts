import type { ChatAgentAvatarLive2dModelSource } from './chat-agent-avatar-live2d-viewport-state';

export type Live2dViewportStatus = 'loading' | 'ready' | 'error';

export type ChatAgentAvatarLive2dViewportLoadState = {
  status: Live2dViewportStatus;
  source: ChatAgentAvatarLive2dModelSource | null;
  error: string | null;
};

export type Live2dRuntimeError = Error & {
  url?: string;
  status?: number;
};

export type ChatAgentAvatarLive2dDiagnostic = {
  backendKind: 'live2d';
  stage: 'core-check' | 'runtime-load' | 'source-resolve' | 'model-load' | 'ready';
  status: Live2dViewportStatus;
  assetRef: string;
  assetLabel: string | null;
  mocVersion: number | null;
  resourceId: string | null;
  fileUrl: string | null;
  modelUrl: string | null;
  error: string | null;
  errorUrl: string | null;
  errorStatus: number | null;
  runtimeUrls: string[];
  cubismCoreAvailable: boolean;
  assetProbeFailures: string[];
  motionGroups: string[];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  recoveryAttemptCount: number;
  recoveryReason: string | null;
};

export function hasLive2dCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

export function describeLive2dLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Live2D model failed to load';
}

export function createLive2dDiagnostic(input: {
  assetRef: string;
  stage: ChatAgentAvatarLive2dDiagnostic['stage'];
  status: Live2dViewportStatus;
  source?: ChatAgentAvatarLive2dModelSource | null;
  error?: string | null;
  cause?: unknown;
  runtimeUrls?: string[];
  assetProbeFailures?: string[];
  recoveryAttemptCount?: number;
  recoveryReason?: string | null;
}): ChatAgentAvatarLive2dDiagnostic {
  const runtimeError = input.cause as Live2dRuntimeError | undefined;
  return {
    backendKind: 'live2d',
    stage: input.stage,
    status: input.status,
    assetRef: input.assetRef,
    assetLabel: input.source?.assetLabel || null,
    mocVersion: input.source?.mocVersion ?? null,
    resourceId: input.source?.resourceId || null,
    fileUrl: input.source?.fileUrl || null,
    modelUrl: input.source?.modelUrl || null,
    error: input.error || null,
    errorUrl: typeof runtimeError?.url === 'string' ? runtimeError.url : null,
    errorStatus: typeof runtimeError?.status === 'number' ? runtimeError.status : null,
    runtimeUrls: input.runtimeUrls ?? [],
    cubismCoreAvailable: hasLive2dCubismCore(),
    assetProbeFailures: input.assetProbeFailures ?? [],
    motionGroups: input.source?.motionGroups ?? [],
    idleMotionGroup: input.source?.idleMotionGroup ?? null,
    speechMotionGroup: input.source?.speechMotionGroup ?? null,
    recoveryAttemptCount: input.recoveryAttemptCount ?? 0,
    recoveryReason: input.recoveryReason ?? null,
  };
}

export function resolveLive2dRuntimeUrls(source: ChatAgentAvatarLive2dModelSource | null): string[] {
  if (!source) {
    return [];
  }
  return [...new Set([source.modelUrl, ...source.resolvedAssetUrls].filter(Boolean))];
}

export async function probeLive2dAssetUrls(urls: readonly string[]): Promise<string[]> {
  const failures = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        return `${url} -> HTTP ${response.status}`;
      }
      const bytes = (await response.arrayBuffer()).byteLength;
      return `${url} -> OK (${bytes} bytes)`;
    } catch (error) {
      return `${url} -> ${describeLive2dLoadError(error)}`;
    }
  }));
  return failures.filter((value): value is string => Boolean(value));
}

export function resizeCanvasToHost(canvas: HTMLCanvasElement, host: HTMLDivElement): {
  width: number;
  height: number;
  changed: boolean;
  renderable: boolean;
} {
  const minimumRenderableCssPixels = 24;
  if (host.clientWidth < minimumRenderableCssPixels || host.clientHeight < minimumRenderableCssPixels) {
    return {
      width: Math.max(canvas.width, 1),
      height: Math.max(canvas.height, 1),
      changed: false,
      renderable: false,
    };
  }

  const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(Math.max(host.clientWidth, 1) * devicePixelRatio));
  const height = Math.max(1, Math.round(Math.max(host.clientHeight, 1) * devicePixelRatio));
  const changed = canvas.width !== width || canvas.height !== height;

  if (changed) {
    canvas.width = width;
    canvas.height = height;
  }

  return {
    width,
    height,
    changed,
    renderable: true,
  };
}
