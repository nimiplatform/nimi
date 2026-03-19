// Main layout shell — assembles all feature surfaces
// Phase 5.3: Left sidebar (agent) + Center (chat) + Right sidebar (buddy)

import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../providers/app-store.js';
import { AgentSelector } from '../../features/agent/components/agent-selector.js';
import { UserMenu } from '../components/user-menu.js';

// Code-split pixi.js (~600KB) — only loaded when agent has Live2D model
const BuddyCanvas = lazy(() =>
  import('../../features/buddy/components/buddy-canvas.js').then((m) => ({ default: m.BuddyCanvas })),
);

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const realtimeConnected = useAppStore((s) => s.realtimeConnected);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Status bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <UserMenu />
          <h1 className="text-sm font-semibold">{t('app.name')}</h1>
          {currentAgent && (
            <span className="text-xs text-gray-400">
              {t('agent.label', { name: currentAgent.name })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusDot active={runtimeAvailable} label={t('status.runtime')} />
          <StatusDot active={realtimeConnected} label={t('status.realtime')} />
        </div>
      </header>

      {/* Main content area — 3 column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — agent selection */}
        <aside className="w-56 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
          <AgentSelector />
        </aside>

        {/* Center — main content (chat) */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>

        {/* Right sidebar — Live2D buddy (lazy-loaded, only when agent has a model) */}
        {currentAgent?.live2dModelUrl && (
          <aside className="w-72 flex-shrink-0 border-l border-gray-800 overflow-hidden">
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <span className="text-sm text-gray-500">{t('live2d.loadingLive2d')}</span>
              </div>
            }>
              <BuddyCanvas />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div
        className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`}
      />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}
