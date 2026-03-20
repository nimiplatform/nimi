import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

function ReadinessIndicator() {
  const runtimeStatus = useAppStore((s) => s.runtimeStatus);
  const runtimeError = useAppStore((s) => s.runtimeError);
  const musicOk = useAppStore((s) => s.musicConnectorAvailable);
  const textOk = useAppStore((s) => s.textConnectorAvailable);

  const isConnected = runtimeStatus === 'ready' || runtimeStatus === 'degraded';
  const dotClass = isConnected
    ? runtimeStatus === 'ready'
      ? 'ot-readiness__dot--ready'
      : 'ot-readiness__dot--degraded'
    : runtimeStatus === 'checking'
      ? 'ot-readiness__dot--checking'
      : 'ot-readiness__dot--error';

  return (
    <div className="flex items-center gap-3 text-[11px] text-ot-text-tertiary" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="flex items-center gap-1.5">
        <div className={`ot-readiness__dot ${dotClass}`} />
        <span>
          Runtime{' '}
          {isConnected
            ? 'connected'
            : runtimeStatus === 'checking'
              ? 'connecting...'
              : 'unavailable'}
        </span>
      </div>
      {isConnected && (
        <>
          <div className="flex items-center gap-1.5">
            <div className={`ot-readiness__dot ${textOk ? 'ot-readiness__dot--ready' : 'ot-readiness__dot--error'}`} />
            <span>Text</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`ot-readiness__dot ${musicOk ? 'ot-readiness__dot--ready' : 'ot-readiness__dot--error'}`} />
            <span>Music</span>
          </div>
        </>
      )}
      {runtimeError && runtimeStatus === 'unavailable' && (
        <span className="text-ot-error truncate max-w-64" title={runtimeError}>
          {runtimeError}
        </span>
      )}
    </div>
  );
}

function ActivityLine() {
  const activeJobs = useAppStore((s) => s.activeJobs);
  if (activeJobs.size === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
      <div
        className="h-full w-full"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, var(--ot-violet-400) 50%, transparent 100%)',
          animation: 'ot-activity-slide 2s linear infinite',
        }}
      />
    </div>
  );
}

export function StudioLayout() {
  return (
    <div className="h-screen flex flex-col bg-ot-surface-0 text-ot-text-primary">
      <header
        className="relative flex items-center justify-between px-4 border-b border-ot-surface-5 shrink-0 select-none"
        style={{ height: 52, paddingTop: 28, paddingLeft: 84, WebkitAppRegion: 'drag' } as React.CSSProperties}
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-ot-text-primary">Overtone</h1>
        </div>
        <ReadinessIndicator />
        <ActivityLine />
      </header>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
