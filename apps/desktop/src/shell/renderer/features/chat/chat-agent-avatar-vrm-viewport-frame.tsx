import { Suspense, type Dispatch, type RefObject, type SetStateAction } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import type {
  AvatarVrmFramingResult as ChatAgentAvatarVrmFramingResult,
  AvatarVrmViewportComponentProps,
} from '@nimiplatform/kit/features/avatar/vrm';
import { cn } from '@nimiplatform/kit/ui';

import type { ChatAgentAvatarAttentionState } from './chat-agent-avatar-attention-state';
import type { ChatAgentAvatarVrmDiagnostic } from './chat-agent-avatar-vrm-diagnostics';
import type {
  LoadedVrmState,
  VrmViewportStatus,
  ChatAgentAvatarVrmRuntimeLifecycleState,
} from './chat-agent-avatar-vrm-runtime';
import { AvatarScene, VrmRenderLoopTelemetry } from './chat-agent-avatar-vrm-scene';
import type { ChatAgentAvatarVrmViewportState } from './chat-agent-avatar-vrm-viewport-state';

type ChatAgentAvatarVrmViewportFrameProps = {
  input: AvatarVrmViewportComponentProps['input'];
  chrome: AvatarVrmViewportComponentProps['chrome'];
  state: ChatAgentAvatarVrmViewportState;
  diagnostic: ChatAgentAvatarVrmDiagnostic;
  resolvedViewportStatus: {
    status: VrmViewportStatus;
    error: string | null;
  };
  attentionState?: ChatAgentAvatarAttentionState | null;
  viewportHostRef: RefObject<HTMLDivElement | null>;
  showPosterFallback: boolean;
  debugLines: readonly string[];
  canvasEpoch: number;
  activeLoadedVrm: LoadedVrmState;
  activeVrmFraming: ChatAgentAvatarVrmFramingResult | null;
  stageVerticalOffsetY: number;
  setRuntimeLifecycle: Dispatch<SetStateAction<ChatAgentAvatarVrmRuntimeLifecycleState>>;
};

export function ChatAgentAvatarVrmViewportFrame({
  input,
  chrome,
  state,
  diagnostic,
  resolvedViewportStatus,
  attentionState,
  viewportHostRef,
  showPosterFallback,
  debugLines,
  canvasEpoch,
  activeLoadedVrm,
  activeVrmFraming,
  stageVerticalOffsetY,
  setRuntimeLifecycle,
}: ChatAgentAvatarVrmViewportFrameProps) {
  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden',
        chrome === 'minimal'
          ? 'bg-transparent'
          : 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,231,255,0.88)_45%,rgba(186,230,253,0.7)_68%,rgba(14,165,233,0.16))]',
      )}
      data-desktop-agent-vrm-viewport="true"
      data-avatar-vrm-status={resolvedViewportStatus.status}
      data-avatar-vrm-stage={diagnostic.stage}
      data-avatar-attention-active={attentionState?.active ? 'true' : 'false'}
    >
      {chrome === 'minimal' || !input.posterUrl ? null : (
        <img
          src={input.posterUrl}
          alt={input.label}
          className={cn(
            'absolute inset-0 h-full w-full object-cover saturate-150',
            'opacity-20',
          )}
        />
      )}
      {chrome === 'minimal' ? null : (
        <span
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.58),transparent_54%)]"
        />
      )}
      <div className={cn(
        'absolute overflow-hidden',
        chrome === 'minimal'
          ? 'inset-0'
          : 'inset-[6%] rounded-[46%] border border-white/70 bg-white/18 shadow-[0_30px_80px_rgba(14,165,233,0.14)]',
      )} ref={viewportHostRef}>
        {showPosterFallback ? (
          <div className="relative h-full w-full overflow-hidden bg-transparent">
            <img
              src={input.posterUrl || ''}
              alt={input.label}
              className={cn(
                'absolute saturate-[1.08]',
                chrome === 'minimal'
                  ? 'inset-0 h-full w-full object-contain object-center opacity-[0.96]'
                  : 'inset-0 h-full w-full object-cover object-top',
              )}
            />
            {chrome === 'minimal' ? null : (
              <>
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(255,255,255,0.72),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.12),transparent_26%,rgba(15,23,42,0.08)_94%)]" />
                <span className="absolute inset-x-[12%] bottom-[8%] h-[22%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.24),rgba(14,165,233,0.12)_48%,transparent_78%)] blur-2xl" />
                <span className="absolute inset-x-0 bottom-0 h-[28%] bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.16)_18%,rgba(9,22,34,0.28))]" />
              </>
            )}
          </div>
        ) : (
          <Canvas
            key={canvasEpoch}
            camera={{ position: [0, 0.42, 5.1], fov: 26, near: 0.01, far: 20 }}
            dpr={[1, 1.8]}
            gl={{ antialias: true, alpha: true }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 0.92;
              setRuntimeLifecycle((current) => (
                current.phase === 'failed'
                  ? current
                  : {
                      ...current,
                      phase: 'stable',
                      reason: null,
                      error: null,
                    }
              ));
            }}
          >
            <VrmRenderLoopTelemetry canvasEpoch={canvasEpoch} ready={activeLoadedVrm.status === 'ready'} />
            <Suspense fallback={null}>
              <AvatarScene
                state={state}
                input={input}
                loadedVrm={activeLoadedVrm}
                framing={activeVrmFraming}
                verticalOffsetY={stageVerticalOffsetY}
                transparentBackground={chrome === 'minimal'}
              />
            </Suspense>
          </Canvas>
        )}
      </div>
      {chrome === 'default' ? (
        <span
          className="pointer-events-none absolute inset-[10%] rounded-[48%] border"
          style={{
            borderColor: `${state.accentColor}38`,
            boxShadow: `0 0 0 1px ${state.glowColor}2a inset`,
          }}
        />
      ) : null}
      {chrome === 'default' ? (
        <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/75 bg-slate-950/82 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              state.phase === 'speaking' || state.phase === 'listening' ? 'animate-pulse' : '',
            )}
            style={{ background: state.glowColor }}
          />
          <span>{state.badgeLabel}</span>
        </span>
      ) : null}
      {chrome === 'default' && resolvedViewportStatus.status === 'loading' ? (
        <span className="absolute top-11 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          {diagnostic.recoveryReason ? 'Recovering model' : 'Loading model'}
        </span>
      ) : null}
      {chrome === 'default' && resolvedViewportStatus.status === 'error' ? (
        <span
          className="absolute top-11 max-w-[72%] rounded-full border border-amber-200/80 bg-white/92 px-2.5 py-1 text-center text-[10px] font-semibold text-amber-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
          title={resolvedViewportStatus.error || undefined}
        >
          VRM fallback active
        </span>
      ) : null}
      {chrome === 'default' ? (
        <>
          <span className="absolute left-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-[0_8px_20px_rgba(14,165,233,0.12)]" style={{ color: state.accentColor }}>
            {resolvedViewportStatus.status === 'ready' ? 'VRM Live' : 'VRM'}
          </span>
          <span className="absolute right-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
            {state.emotion}
          </span>
          <span className="absolute bottom-12 rounded-full border border-white/70 bg-white/86 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            {state.assetLabel}
          </span>
        </>
      ) : null}
      {chrome === 'minimal' && debugLines.length > 0 ? (
        <div
          className="absolute inset-x-3 bottom-3 rounded-2xl nimi-material-glass-thin border border-amber-200/70 bg-[var(--nimi-material-glass-thin-bg)] px-3 py-2 text-[10px] leading-4 text-amber-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
          data-avatar-vrm-debug="true"
        >
          {debugLines.map((line) => (
            <div key={line} className="truncate font-mono">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
