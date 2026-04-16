import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import {
  loadChatAgentAvatarLive2dModelSource,
  resolveChatAgentAvatarLive2dViewportState,
  type ChatAgentAvatarLive2dModelSource,
} from './chat-agent-avatar-live2d-viewport-state';

type Live2dViewportStatus = 'loading' | 'ready' | 'error';
type ChatAgentAvatarLive2dViewportLoadState = {
  status: Live2dViewportStatus;
  source: ChatAgentAvatarLive2dModelSource | null;
  error: string | null;
};

type ChatAgentAvatarLive2dViewportProps = AvatarVrmViewportComponentProps & {
  onLoadStateChange?: (status: Live2dViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
};

type Live2dCanvasLayout = {
  x: number;
  y: number;
  scale: number;
};

type PixiModule = typeof import('pixi.js');
type Live2dRuntimeModule = typeof import('pixi-live2d-display/cubism4');

type Live2dRuntimeModel = {
  anchor: { set: (x: number, y?: number) => void };
  scale: { set: (value: number) => void };
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  motion: (group: string, index?: number, priority?: number) => Promise<boolean>;
  destroy: () => void;
};

type PixiApplicationInstance = {
  view: HTMLCanvasElement;
  stage: {
    addChild: (child: Live2dRuntimeModel) => void;
  };
  ticker: {
    add: (callback: () => void) => void;
    remove: (callback: () => void) => void;
  };
  destroy: (removeView?: boolean, stageOptions?: unknown) => void;
};

type Live2dGlobal = typeof globalThis & {
  PIXI?: PixiModule;
  Live2DCubismCore?: unknown;
};

export type ChatAgentAvatarLive2dDiagnostic = {
  backendKind: 'live2d';
  stage: 'core-check' | 'runtime-load' | 'source-resolve' | 'model-load' | 'ready';
  status: Live2dViewportStatus;
  assetRef: string;
  assetLabel: string | null;
  resourceId: string | null;
  fileUrl: string | null;
  modelUrl: string | null;
  error: string | null;
  cubismCoreAvailable: boolean;
  assetProbeFailures: string[];
};

function live2dGlobal(): Live2dGlobal {
  return globalThis as Live2dGlobal;
}

function hasLive2dCubismCore(): boolean {
  return Boolean(live2dGlobal().Live2DCubismCore);
}

function fitLive2dModelToHost(
  model: Live2dRuntimeModel,
  host: HTMLDivElement,
): Live2dCanvasLayout {
  const width = Math.max(host.clientWidth, 1);
  const height = Math.max(host.clientHeight, 1);
  model.anchor.set(0.5, 0);
  model.scale.set(1);
  const naturalWidth = Math.max(model.width, 1);
  const naturalHeight = Math.max(model.height, 1);
  const scale = Math.min((width * 0.78) / naturalWidth, (height * 0.84) / naturalHeight);
  model.scale.set(scale);
  model.x = width * 0.5;
  model.y = height * 0.08;
  return {
    x: model.x,
    y: model.y,
    scale,
  };
}

function describeLive2dLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Live2D model failed to load';
}

function createLive2dDiagnostic(input: {
  assetRef: string;
  stage: ChatAgentAvatarLive2dDiagnostic['stage'];
  status: Live2dViewportStatus;
  source?: ChatAgentAvatarLive2dModelSource | null;
  error?: string | null;
}): ChatAgentAvatarLive2dDiagnostic {
  return {
    backendKind: 'live2d',
    stage: input.stage,
    status: input.status,
    assetRef: input.assetRef,
    assetLabel: input.source?.assetLabel || null,
    resourceId: input.source?.resourceId || null,
    fileUrl: input.source?.fileUrl || null,
    modelUrl: input.source?.modelUrl || null,
    error: input.error || null,
    cubismCoreAvailable: hasLive2dCubismCore(),
    assetProbeFailures: [],
  };
}

async function probeLive2dAssetUrls(urls: readonly string[]): Promise<string[]> {
  const failures = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        return `${url} -> HTTP ${response.status}`;
      }
      return null;
    } catch (error) {
      return `${url} -> ${describeLive2dLoadError(error)}`;
    }
  }));
  return failures.filter((value): value is string => Boolean(value));
}

async function loadLive2dRuntime(): Promise<{
  pixiModule: PixiModule;
  live2dModule: Live2dRuntimeModule;
}> {
  const pixiModule = await import('pixi.js');
  live2dGlobal().PIXI = pixiModule;
  const live2dModule = await import('pixi-live2d-display/cubism4');
  live2dModule.Live2DModel.registerTicker(pixiModule.Ticker);
  return {
    pixiModule,
    live2dModule,
  };
}

function Live2dLoadingShell({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,242,254,0.94)_50%,rgba(191,219,254,0.82))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700/80">
            {t('Chat.avatarLive2dLabel', { defaultValue: 'Live2D' })}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Live2dErrorShell(props: {
  label: string;
  errorMessage: string;
  posterUrl?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.98),rgba(226,232,240,0.94)_54%,rgba(203,213,225,0.84))]">
      {props.posterUrl ? (
        <img
          src={props.posterUrl}
          alt={props.label}
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
      ) : null}
      <div className="relative mx-6 max-w-[18rem] rounded-[24px] border border-white/80 bg-white/84 px-5 py-4 text-center shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('Chat.avatarLive2dFallbackLabel', { defaultValue: 'Live2D Fallback' })}
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-900">{props.label}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">{props.errorMessage}</p>
      </div>
    </div>
  );
}

export default function ChatAgentAvatarLive2dViewport({
  input,
  chrome = 'default',
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
}: ChatAgentAvatarLive2dViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PixiApplicationInstance | null>(null);
  const modelRef = useRef<Live2dRuntimeModel | null>(null);
  const layoutRef = useRef<Live2dCanvasLayout | null>(null);
  const animationStateRef = useRef(resolveChatAgentAvatarLive2dViewportState(input));
  const motionPhaseRef = useRef<string | null>(null);
  const [loadState, setLoadState] = useState<ChatAgentAvatarLive2dViewportLoadState>({
    status: 'loading',
    source: null,
    error: null,
  });
  const [diagnostic, setDiagnostic] = useState<ChatAgentAvatarLive2dDiagnostic>(() => (
    createLive2dDiagnostic({
      assetRef: input.assetRef,
      stage: 'runtime-load',
      status: 'loading',
    })
  ));
  const viewportState = useMemo(
    () => resolveChatAgentAvatarLive2dViewportState(input, loadState.source),
    [input, loadState.source],
  );

  animationStateRef.current = viewportState;

  useEffect(() => {
    onLoadStateChange?.(loadState.status);
  }, [loadState.status, onLoadStateChange]);

  useEffect(() => {
    onLoadErrorChange?.(loadState.error);
  }, [loadState.error, onLoadErrorChange]);

  useEffect(() => {
    onDiagnosticChange?.(diagnostic);
  }, [diagnostic, onDiagnosticChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    if (!hasLive2dCubismCore()) {
      setDiagnostic(createLive2dDiagnostic({
        assetRef: input.assetRef,
        stage: 'core-check',
        status: 'error',
        error: 'Live2D Cubism Core is not available in the desktop shell.',
      }));
      setLoadState({
        status: 'error',
        source: null,
        error: 'Live2D Cubism Core is not available in the desktop shell.',
      });
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let tickerCallback: (() => void) | null = null;
    let sourceForCleanup: ChatAgentAvatarLive2dModelSource | null = null;
    setLoadState({
      status: 'loading',
      source: null,
      error: null,
    });
    setDiagnostic(createLive2dDiagnostic({
      assetRef: input.assetRef,
      stage: 'runtime-load',
      status: 'loading',
    }));
    motionPhaseRef.current = null;

    void (async () => {
      let failureStage: ChatAgentAvatarLive2dDiagnostic['stage'] = 'runtime-load';
      let source: ChatAgentAvatarLive2dModelSource | null = null;
      try {
        const { pixiModule, live2dModule } = await loadLive2dRuntime();
        if (cancelled) {
          return;
        }
        const app = new pixiModule.Application({
          antialias: true,
          autoDensity: true,
          backgroundAlpha: 0,
          resizeTo: host,
          sharedTicker: true,
        }) as PixiApplicationInstance;
        appRef.current = app;
        host.replaceChildren(app.view);
        failureStage = 'source-resolve';
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          stage: 'source-resolve',
          status: 'loading',
        }));
        source = await loadChatAgentAvatarLive2dModelSource(input.assetRef);
        sourceForCleanup = source;
        if (cancelled) {
          source?.cleanup?.();
          app.destroy(true);
          return;
        }
        failureStage = 'model-load';
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          source,
          stage: 'model-load',
          status: 'loading',
        }));
        const model = await live2dModule.Live2DModel.from(source.modelUrl, {
          autoInteract: false,
        }) as Live2dRuntimeModel;
        if (cancelled) {
          source?.cleanup?.();
          model.destroy();
          app.destroy(true);
          return;
        }
        modelRef.current = model;
        app.stage.addChild(model);
        layoutRef.current = fitLive2dModelToHost(model, host);
        if (source.idleMotionGroup) {
          motionPhaseRef.current = `idle:${source.idleMotionGroup}`;
          void model.motion(
            source.idleMotionGroup,
            undefined,
            live2dModule.MotionPriority.IDLE,
          ).catch(() => undefined);
        }
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!hostRef.current || !modelRef.current) {
              return;
            }
            layoutRef.current = fitLive2dModelToHost(modelRef.current, hostRef.current);
          });
          resizeObserver.observe(host);
        }
        tickerCallback = () => {
          const live2dModel = modelRef.current;
          const layout = layoutRef.current;
          if (!live2dModel || !layout) {
            return;
          }
          const state = animationStateRef.current;
          const seconds = performance.now() / 1000;
          const breathing = 1 + Math.sin(seconds * (0.8 + state.motionSpeed * 0.3)) * 0.012;
          const speakingPulse = state.phase === 'speaking'
            ? 1 + Math.sin(seconds * (4 + state.amplitude * 5)) * (0.018 + state.amplitude * 0.03)
            : 1;
          live2dModel.scale.set(layout.scale * breathing * speakingPulse);
          live2dModel.x = layout.x;
          live2dModel.y = layout.y + Math.sin(seconds * (0.65 + state.motionSpeed * 0.2)) * 6;
          live2dModel.rotation = Math.sin(seconds * (0.35 + state.motionSpeed * 0.08)) * 0.015;
        };
        app.ticker.add(tickerCallback);
        setLoadState({
          status: 'ready',
          source,
          error: null,
        });
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          source,
          stage: 'ready',
          status: 'ready',
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        const errorMessage = describeLive2dLoadError(error);
        const assetProbeFailures = failureStage === 'model-load' && source?.resolvedAssetUrls.length
          ? await probeLive2dAssetUrls(source.resolvedAssetUrls)
          : [];
        if (appRef.current) {
          appRef.current.destroy(true);
          appRef.current = null;
        }
        source?.cleanup?.();
        setLoadState({
          status: 'error',
          source: null,
          error: errorMessage,
        });
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          source,
          stage: failureStage,
          status: 'error',
          error: errorMessage,
        }));
        setDiagnostic((current) => ({
          ...current,
          stage: failureStage,
          status: 'error',
          assetRef: input.assetRef,
          assetLabel: source?.assetLabel || null,
          resourceId: source?.resourceId || null,
          fileUrl: source?.fileUrl || null,
          modelUrl: source?.modelUrl || null,
          error: errorMessage,
          cubismCoreAvailable: hasLive2dCubismCore(),
          assetProbeFailures,
        }));
        logRendererEvent({
          level: 'error',
          area: 'chat-live2d',
          message: 'action:live2d-viewport-load-failed',
          details: {
            assetRef: input.assetRef,
            stage: failureStage,
            resourceId: source?.resourceId || null,
            fileUrl: source?.fileUrl || null,
            modelUrl: source?.modelUrl || null,
            error: errorMessage,
            assetProbeFailures,
          },
        });
      }
    })();

    return () => {
      cancelled = true;
      motionPhaseRef.current = null;
      resizeObserver?.disconnect();
      if (tickerCallback && appRef.current) {
        appRef.current.ticker.remove(tickerCallback);
      }
      if (modelRef.current) {
        modelRef.current.destroy();
        modelRef.current = null;
      }
      sourceForCleanup?.cleanup?.();
      layoutRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, {
          children: true,
          texture: true,
          baseTexture: true,
        });
        appRef.current = null;
      }
    };
  }, [input.assetRef]);

  useEffect(() => {
    const model = modelRef.current;
    const source = loadState.source;
    if (!model || !source) {
      return;
    }
    const phase = input.snapshot.interaction.phase;
    const targetMotionGroup = phase === 'speaking'
      ? source.speechMotionGroup || source.idleMotionGroup
      : source.idleMotionGroup;
    if (!targetMotionGroup) {
      motionPhaseRef.current = null;
      return;
    }
    const nextMotionToken = `${phase}:${targetMotionGroup}`;
    if (motionPhaseRef.current === nextMotionToken) {
      return;
    }
    motionPhaseRef.current = nextMotionToken;
    void model.motion(
      targetMotionGroup,
      undefined,
      phase === 'speaking'
        ? 2
        : 1,
    ).catch(() => undefined);
  }, [input.snapshot.interaction.phase, loadState.source]);

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        chrome === 'minimal' ? 'bg-transparent' : 'rounded-[28px]',
      )}
      data-avatar-live2d-status={loadState.status}
      data-avatar-live2d-phase={viewportState.phase}
      data-avatar-live2d-asset={viewportState.assetLabel}
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-[-10%] top-[-12%] h-44 w-44 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${viewportState.glowColor}, transparent 70%)` }}
        />
        <div
          className="absolute bottom-[-10%] right-[-6%] h-52 w-52 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${viewportState.accentColor}33, transparent 72%)` }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),transparent_22%,transparent_80%,rgba(255,255,255,0.16))]" />
      </div>
      <div ref={hostRef} className="relative z-[1] h-full w-full" />
      {loadState.status === 'loading' ? <Live2dLoadingShell label={input.label} /> : null}
      {loadState.status === 'error' ? (
        <Live2dErrorShell
          label={input.label}
          errorMessage={loadState.error || 'Live2D model failed to load'}
          posterUrl={input.posterUrl}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-4">
        <span className="rounded-full border border-white/80 bg-slate-950/84 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
          {viewportState.badgeLabel}
        </span>
      </div>
    </div>
  );
}
