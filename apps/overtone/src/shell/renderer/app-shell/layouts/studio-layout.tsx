import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

function ReadinessIndicator() {
  const runtimeStatus = useAppStore((s) => s.runtimeStatus);
  const runtimeError = useAppStore((s) => s.runtimeError);
  const musicOk = useAppStore((s) => s.musicConnectorAvailable);
  const textOk = useAppStore((s) => s.textConnectorAvailable);

  const isConnected = runtimeStatus === 'ready' || runtimeStatus === 'degraded';
  const statusColor = isConnected
    ? (runtimeStatus === 'ready' ? 'bg-emerald-500' : 'bg-amber-500')
    : runtimeStatus === 'checking'
      ? 'bg-amber-500 animate-pulse'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-400">
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
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
            <div className={`w-2 h-2 rounded-full ${textOk ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            <span>Text</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${musicOk ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            <span>Music</span>
          </div>
        </>
      )}
      {runtimeError && runtimeStatus === 'unavailable' && (
        <span className="text-red-400 truncate max-w-64" title={runtimeError}>
          {runtimeError}
        </span>
      )}
    </div>
  );
}

export function StudioLayout() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar with traffic light offset */}
      <header
        className="flex items-center justify-between px-4 border-b border-zinc-800 shrink-0 select-none"
        style={{ height: 52, paddingTop: 28 }}
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Overtone</h1>
        </div>
        <ReadinessIndicator />
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
