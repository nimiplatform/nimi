/**
 * Import Hub Page — Entry point for both import pipelines
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { ForgePage, ForgePageHeader } from '@renderer/components/page-layout.js';
import { ForgeActionCard } from '@renderer/components/card-list.js';

export default function ImportHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createWorkspace = useForgeWorkspaceStore((state) => state.createWorkspace);

  return (
    <ForgePage maxWidth="max-w-3xl">
      <ForgePageHeader
        title={t('import.title')}
        subtitle={t('import.subtitle')}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Character Card V2 Import */}
        <ForgeActionCard
          icon={
            <span className="flex h-10 w-10 items-center justify-center rounded-[var(--nimi-radius-action)] bg-[var(--nimi-action-primary-bg)]/10 text-lg text-[var(--nimi-action-primary-text)]">
              C
            </span>
          }
          title={t('import.characterCard')}
          description={t('import.characterCardDesc')}
          onClick={() => {
            const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Character Card Import' });
            navigate(`/workbench/${workspaceId}/import/character-card`);
          }}
        />

        {/* Novel Import */}
        <ForgeActionCard
          icon={
            <span className="flex h-10 w-10 items-center justify-center rounded-[var(--nimi-radius-action)] bg-[var(--nimi-status-success)]/10 text-lg text-[var(--nimi-status-success)]">
              N
            </span>
          }
          title={t('import.novel')}
          description={t('import.novelDesc')}
          onClick={() => {
            const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Novel Import' });
            navigate(`/workbench/${workspaceId}/import/novel`);
          }}
        />
      </div>
    </ForgePage>
  );
}
