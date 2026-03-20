// Main layout shell — sidebar + chat + detail panel
// Per design.md §4: three-column layout

import { lazy, Suspense, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ConversationSidebar } from '../../features/sidebar/components/conversation-sidebar.js';
import { DetailPanel } from './detail-panel.js';
import { SettingsDrawer } from '../../features/chat/components/settings-drawer.js';

// Code-split pixi.js (~600KB) — only loaded when agent has Live2D model
const BuddyCanvas = lazy(() =>
  import('../../features/buddy/components/buddy-canvas.js').then((m) => ({ default: m.BuddyCanvas })),
);

type DetailMode = 'none' | 'settings' | 'buddy';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>('none');

  const openSettings = useCallback(() => setDetailMode('settings'), []);
  const closeDetail = useCallback(() => setDetailMode('none'), []);

  return (
    <div className="flex h-screen bg-bg-base text-text-primary font-sans">
      {/* Sidebar */}
      <ConversationSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenSettings={openSettings}
      />

      {/* Center — main content (chat) */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Right panel — settings or buddy */}
      {detailMode === 'settings' && (
        <DetailPanel open title={t('settings.title')} onClose={closeDetail}>
          <SettingsDrawer />
        </DetailPanel>
      )}
      {detailMode === 'buddy' && (
        <DetailPanel open title={t('live2d.loadingLive2d')} onClose={closeDetail}>
          <Suspense fallback={
            <div className="flex items-center justify-center h-48">
              <span className="text-[13px] text-text-secondary">{t('live2d.loadingLive2d')}</span>
            </div>
          }>
            <BuddyCanvas />
          </Suspense>
        </DetailPanel>
      )}
    </div>
  );
}
