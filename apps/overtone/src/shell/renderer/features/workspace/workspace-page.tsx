import React from 'react';
import { useRuntimeReady } from '@renderer/hooks/use-runtime-ready.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { BriefPanel } from './brief-panel.js';
import { GeneratePanel } from './generate-panel.js';
import { IteratePanel } from './iterate-panel.js';
import { TakesPanel } from './takes-panel.js';
import { PlayerPanel } from './player-panel.js';
import { PublishPanel } from './publish-panel.js';

function ReadinessGate({ children }: { children: React.ReactNode }) {
  const runtimeStatus = useAppStore((state) => state.runtimeStatus);
  const runtimeError = useAppStore((state) => state.runtimeError);

  useRuntimeReady();

  if (runtimeStatus === 'checking') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 text-sm">Connecting to runtime...</p>
        </div>
      </div>
    );
  }

  if (runtimeStatus === 'unavailable') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-zinc-200">Runtime Unavailable</h2>
          <p className="text-zinc-400 text-sm">
            {runtimeError || 'Could not connect to the nimi runtime daemon.'}
          </p>
          <p className="text-zinc-500 text-xs">
            Make sure the nimi runtime is installed and accessible. Check your NIMI_RUNTIME_BRIDGE_MODE
            and NIMI_RUNTIME_BINARY environment variables.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

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
    <div className="mx-4 mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2">
      <p className="text-xs font-medium text-amber-300 mb-1">Readiness issues</p>
      <ul className="text-[10px] text-amber-300/80 space-y-0.5">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

function ProjectStarter() {
  const startProject = useAppStore((state) => state.startProject);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-6 max-w-lg">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Overtone Studio</h2>
          <p className="text-zinc-400">
            AI-powered music creation. Describe your song, generate candidates, compare takes, and publish.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left">
          <InfoCard
            title="Song Brief"
            description="Describe your idea and let AI help structure it into a creative brief."
          />
          <InfoCard
            title="Generate Music"
            description="Create multiple song candidates from your brief and lyrics."
          />
          <InfoCard
            title="Compare Takes"
            description="A/B compare, favorite, and iterate on your best candidates."
          />
          <InfoCard
            title="Publish Prep"
            description="Prepare metadata and provenance for future realm publishing."
          />
        </div>

        <button
          className="px-6 py-2.5 bg-zinc-100 text-zinc-900 font-medium rounded-lg hover:bg-zinc-200 transition-colors"
          onClick={startProject}
          type="button"
        >
          New Song Project
        </button>
      </div>
    </div>
  );
}

function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
      <h3 className="text-sm font-medium text-zinc-200 mb-1">{title}</h3>
      <p className="text-xs text-zinc-500">{description}</p>
    </div>
  );
}

function StudioWorkspace() {
  const resetProject = useAppStore((state) => state.resetProject);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-500">Song Project</span>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={resetProject}
          type="button"
        >
          Close Project
        </button>
      </div>

      <ReadinessIssuesBanner />

      <div className="flex-1 flex min-h-0">
        <div className="w-80 border-r border-zinc-800 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <BriefPanel />
            <div className="border-t border-zinc-800 pt-4">
              <GeneratePanel />
            </div>
            <div className="border-t border-zinc-800 pt-4">
              <IteratePanel />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <TakesPanel />
            <div className="border-t border-zinc-800 pt-4">
              <PublishPanel />
            </div>
          </div>
          <PlayerPanel />
        </div>
      </div>
    </div>
  );
}

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
