// Main layout shell — full-width chat + right settings panel
// Sidebar removed — agent switching via header dropdown

import { useTranslation } from 'react-i18next';
import { useAppStore } from '../providers/app-store.js';
import { DetailPanel } from './detail-panel.js';
import { SettingsDrawer } from '../../features/chat/components/settings-drawer.js';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const detailMode = useAppStore((s) => s.detailMode);
  const setDetailMode = useAppStore((s) => s.setDetailMode);

  return (
    <div className="flex h-screen bg-bg-base text-text-primary font-sans">
      {/* Center — main content (chat) */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Right panel — settings */}
      {detailMode === 'settings' && (
        <DetailPanel open title={t('settings.title')} onClose={() => setDetailMode('none')}>
          <SettingsDrawer />
        </DetailPanel>
      )}
    </div>
  );
}
