/**
 * Import Hub Page — Entry point for both import pipelines
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
} from '@renderer/components/page-layout.js';
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

      <ForgeSection className="space-y-4" material="glass-regular">
        <ForgeSectionHeading
          eyebrow={t('import.title')}
          title={t('import.choosePipeline', 'Choose an Intake Pipeline')}
          description={t('import.pipelineDesc', 'Each import path creates a workspace-scoped review draft and hands final decisions back to the workbench.')}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ForgeActionCard
            icon={<span className="text-lg font-semibold">C</span>}
            title={t('import.characterCard')}
            description={t('import.characterCardDesc')}
            onClick={() => {
              const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Character Card Import' });
              navigate(`/workbench/${workspaceId}/import/character-card`);
            }}
          />

          <ForgeActionCard
            icon={<span className="text-lg font-semibold">N</span>}
            title={t('import.novel')}
            description={t('import.novelDesc')}
            onClick={() => {
              const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Novel Import' });
              navigate(`/workbench/${workspaceId}/import/novel`);
            }}
          />
        </div>
      </ForgeSection>
    </ForgePage>
  );
}
