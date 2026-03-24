import React from 'react';
import { Outlet } from 'react-router-dom';
import { StatusBadge } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

function ReadinessIndicator() {
  const runtimeStatus = useAppStore((s) => s.runtimeStatus);
  const runtimeError = useAppStore((s) => s.runtimeError);
  const musicOk = useAppStore((s) => s.musicConnectorAvailable);
  const textOk = useAppStore((s) => s.textConnectorAvailable);

  const isConnected = runtimeStatus === 'ready' || runtimeStatus === 'degraded';
  const runtimeTone = isConnected
    ? runtimeStatus === 'ready'
      ? 'success'
      : 'warning'
    : runtimeStatus === 'checking'
      ? 'info'
      : 'danger';

  return (
    <div className="ot-app-region-no-drag flex items-center gap-2 text-[11px] text-[var(--nimi-text-muted)]">
      <StatusBadge tone={runtimeTone}>
        Runtime{' '}
        {isConnected
          ? 'connected'
          : runtimeStatus === 'checking'
            ? 'connecting...'
            : 'unavailable'}
      </StatusBadge>
      {isConnected && (
        <>
          <StatusBadge tone={textOk ? 'success' : 'danger'}>Text</StatusBadge>
          <StatusBadge tone={musicOk ? 'success' : 'danger'}>Music</StatusBadge>
        </>
      )}
      {runtimeError && runtimeStatus === 'unavailable' && (
        <span className="text-[var(--nimi-status-danger)] truncate max-w-64" title={runtimeError}>
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
      <div className="ot-activity-line__bar h-full w-full" />
    </div>
  );
}

export function StudioLayout() {
  return (
    <div className="h-screen flex flex-col bg-[var(--nimi-app-background)] text-[var(--nimi-text-primary)]">
      <header
        className="ot-studio-header relative flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-surface-card)_74%,var(--nimi-action-primary-bg)_26%)] px-4 shrink-0 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]">Overtone</h1>
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
