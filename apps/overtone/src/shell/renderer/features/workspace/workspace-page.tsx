import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRuntimeReady } from '@renderer/hooks/use-runtime-ready.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { OtButton } from './ui-primitives.js';
import { BriefPanel } from './brief-panel.js';
import { GeneratePanel } from './generate-panel.js';
import { IteratePanel } from './iterate-panel.js';
import { TakesPanel } from './takes-panel.js';
import { PlayerPanel } from './player-panel.js';
import { PublishModal } from './publish-panel.js';

/* ─── ReadinessGate ─── */

function ReadinessGate({ children }: { children: React.ReactNode }) {
  const runtimeStatus = useAppStore((state) => state.runtimeStatus);
  const runtimeError = useAppStore((state) => state.runtimeError);

  useRuntimeReady();

  if (runtimeStatus === 'checking') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-ot-violet-400/20 border-t-ot-violet-400 rounded-full animate-spin mx-auto" />
          <p className="text-ot-text-secondary text-sm">Connecting to runtime...</p>
        </div>
      </div>
    );
  }

  if (runtimeStatus === 'unavailable') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-12 h-12 rounded-full bg-ot-error/10 flex items-center justify-center mx-auto">
            <span className="text-ot-error text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-ot-text-primary">Runtime Unavailable</h2>
          <p className="text-ot-text-secondary text-sm">
            {runtimeError || 'Could not connect to the nimi runtime daemon.'}
          </p>
          <p className="text-ot-text-tertiary text-xs">
            Make sure the nimi runtime is installed and accessible. Check your NIMI_RUNTIME_BRIDGE_MODE
            and NIMI_RUNTIME_BINARY environment variables.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/* ─── ReadinessIssuesBanner ─── */

function ReadinessIssuesBanner() {
  const runtimeStatus = useAppStore((state) => state.runtimeStatus);
  const readinessIssues = useAppStore((state) => state.readinessIssues);
  const realmConfigured = useAppStore((state) => state.realmConfigured);

  if (runtimeStatus !== 'degraded' && realmConfigured) {
    return null;
  }

  const issues = [...readinessIssues];
  if (!realmConfigured) {
    issues.push('Realm is not configured. Set VITE_NIMI_REALM_BASE_URL and VITE_NIMI_REALM_ACCESS_TOKEN.');
  }

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="mx-4 mt-2 rounded-lg border border-ot-warning/20 bg-ot-warning/10 px-3 py-2">
      <p className="text-xs font-medium text-ot-warning mb-1">Readiness issues</p>
      <ul className="text-[10px] text-ot-warning/80 space-y-0.5">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Ambient Waveform (Empty State) ─── */

function AmbientWaveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    const BAR_COUNT = 120;

    const animate = () => {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const time = Date.now() / 1000;
      const barWidth = rect.width / BAR_COUNT;
      const centerY = rect.height / 2;

      ctx.fillStyle = 'rgba(139, 92, 246, 0.08)';

      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = (i / BAR_COUNT) * Math.PI * 4 + time * 0.8;
        const amplitude = 0.05 + 0.10 * Math.sin(time * 0.3 + i * 0.05);
        const h = Math.max(2, Math.abs(Math.sin(phase)) * rect.height * amplitude);
        const x = i * barWidth;
        ctx.beginPath();
        ctx.roundRect(x + 1, centerY - h / 2, barWidth - 2, h, [2, 2, 0, 0]);
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

/* ─── ProjectStarter (Empty State) ─── */

function ProjectStarter() {
  const startProject = useAppStore((state) => state.startProject);
  const runtimeStatus = useAppStore((s) => s.runtimeStatus);
  const realmConfigured = useAppStore((s) => s.realmConfigured);
  const musicOk = useAppStore((s) => s.musicConnectorAvailable);
  const textOk = useAppStore((s) => s.textConnectorAvailable);

  const dots = [
    { label: 'Runtime', ok: runtimeStatus === 'ready' || runtimeStatus === 'degraded', checking: runtimeStatus === 'checking' },
    { label: 'Realm', ok: realmConfigured, checking: false },
    { label: 'Music', ok: musicOk, checking: false },
    { label: 'Text', ok: textOk, checking: false },
  ];

  return (
    <div className="flex-1 flex items-center justify-center relative">
      <AmbientWaveform />
      <div className="text-center space-y-8 relative z-10">
        <div className="space-y-3">
          <h2 className="text-[28px] font-bold tracking-[0.3em] uppercase text-ot-text-primary">
            OVERTONE
          </h2>
          <p className="text-sm text-ot-text-tertiary">
            AI Music Creation Studio
          </p>
        </div>

        <OtButton
          variant="primary"
          className="min-w-[200px]"
          onClick={startProject}
          type="button"
        >
          Start New Session
        </OtButton>

        <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-ot-text-ghost">
          <span>⌘N New Session</span>
        </div>

        <div className="flex items-center justify-center gap-4">
          {dots.map((d) => (
            <div key={d.label} className="flex items-center gap-1.5">
              <div
                className={`ot-readiness__dot ${
                  d.checking
                    ? 'ot-readiness__dot--checking'
                    : d.ok
                      ? 'ot-readiness__dot--ready'
                      : 'ot-readiness__dot--error'
                }`}
              />
              <span className="text-[11px] text-ot-text-tertiary">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── StudioWorkspace ─── */

function StudioWorkspace() {
  const resetProject = useAppStore((state) => state.resetProject);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [composeWidth, setComposeWidth] = useState(320);
  const resizing = useRef(false);

  const handlePublish = useCallback(() => {
    setPublishModalOpen(true);
  }, []);

  /* ─── Keyboard Shortcuts ─── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (publishModalOpen) {
          setPublishModalOpen(false);
          return;
        }
        const { compareTakeIds, clearCompareTakeIds } = useAppStore.getState();
        if (compareTakeIds[0] || compareTakeIds[1]) {
          clearCompareTakeIds();
          return;
        }
      }

      if (isInput) return;

      if (e.key === ' ') {
        e.preventDefault();
        // Space → play/pause handled by PlayerPanel's own logic via store
        // We dispatch a custom event that PlayerPanel listens for
        window.dispatchEvent(new CustomEvent('ot-toggle-playback'));
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.shiftKey ? 15 : 5;
        const sign = e.key === 'ArrowLeft' ? -1 : 1;
        window.dispatchEvent(new CustomEvent('ot-seek-delta', { detail: delta * sign }));
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        const { selectedTakeId, toggleFavorite } = useAppStore.getState();
        if (selectedTakeId) toggleFavorite(selectedTakeId);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        useAppStore.getState().resetProject();
        useAppStore.getState().startProject();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        // Dispatch generate event — GeneratePanel can listen for it
        window.dispatchEvent(new CustomEvent('ot-trigger-generate'));
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        if (useAppStore.getState().selectedTakeId) {
          setPublishModalOpen(true);
        }
        return;
      }

      if (e.key === '1' || e.key === '2') {
        const { compareTakeIds, selectTake } = useAppStore.getState();
        const slot = e.key === '1' ? 0 : 1;
        const takeId = compareTakeIds[slot];
        if (takeId) {
          selectTake(takeId);
          window.dispatchEvent(new CustomEvent('ot-toggle-playback'));
        }
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [publishModalOpen]);

  /* ─── Resize handler for Compose panel ─── */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = composeWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - startX;
      setComposeWidth(Math.max(280, Math.min(480, startW + delta)));
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [composeWidth]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Project toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-ot-surface-5">
        <span className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Song Project</span>
        <button
          className="ot-btn-tertiary text-xs py-1 px-2"
          onClick={resetProject}
          type="button"
        >
          Close Project
        </button>
      </div>

      <ReadinessIssuesBanner />

      {/* Stage: Compose + Output */}
      <div className="flex-1 flex min-h-0">
        {/* Compose Panel */}
        <div
          className="flex flex-col min-h-0 border-r border-ot-surface-5"
          style={{ width: composeWidth, minWidth: 280, maxWidth: 480 }}
        >
          <div className="flex-1 overflow-y-auto ot-scroll p-4 space-y-0">
            <BriefPanel />
            <GeneratePanel />
            <IteratePanel />
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="w-[1px] bg-ot-surface-5 cursor-col-resize hover:bg-ot-violet-400/30 transition-colors relative"
          style={{ padding: '0 3px', margin: '0 -3px' }}
          onMouseDown={handleResizeStart}
        />

        {/* Output Panel */}
        <div className="flex-1 flex flex-col min-h-0 min-w-[400px]">
          <div className="flex-1 overflow-y-auto ot-scroll p-4">
            <TakesPanel onPublish={handlePublish} />
          </div>
        </div>
      </div>

      {/* Transport Bar */}
      <PlayerPanel />

      {/* Publish Modal */}
      <PublishModal open={publishModalOpen} onClose={() => setPublishModalOpen(false)} />
    </div>
  );
}

/* ─── WorkspacePage ─── */

export function WorkspacePage() {
  const projectId = useAppStore((state) => state.projectId);

  return (
    <div className="h-full flex flex-col">
      <ReadinessGate>
        {projectId ? <StudioWorkspace /> : <ProjectStarter />}
      </ReadinessGate>
    </div>
  );
}
