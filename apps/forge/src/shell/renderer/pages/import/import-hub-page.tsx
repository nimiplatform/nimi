/**
 * Import Hub Page — Entry point for both import pipelines
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

export default function ImportHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createWorkspace = useForgeWorkspaceStore((state) => state.createWorkspace);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">{t('import.title')}</h1>
        <p className="mt-1 text-sm text-neutral-400">{t('import.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 max-w-3xl">
        {/* Character Card V2 Import */}
        <button
          onClick={() => {
            const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Character Card Import' });
            navigate(`/workbench/${workspaceId}/import/character-card`);
          }}
          className="group flex flex-col items-start rounded-lg border border-neutral-700 bg-neutral-800/50 p-6 text-left transition-colors hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 text-lg">
            C
          </div>
          <h2 className="text-base font-medium text-white group-hover:text-blue-300">
            {t('import.characterCard')}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {t('import.characterCardDesc')}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              Character Card V2
            </span>
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              JSON
            </span>
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              chub.ai
            </span>
          </div>
        </button>

        {/* Novel Import */}
        <button
          onClick={() => {
            const workspaceId = createWorkspace({ mode: 'NEW_WORLD', title: 'Novel Import' });
            navigate(`/workbench/${workspaceId}/import/novel`);
          }}
          className="group flex flex-col items-start rounded-lg border border-neutral-700 bg-neutral-800/50 p-6 text-left transition-colors hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 text-lg">
            N
          </div>
          <h2 className="text-base font-medium text-white group-hover:text-emerald-300">
            {t('import.novel')}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            {t('import.novelDesc')}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              TXT
            </span>
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              {t('import.progressiveExtraction')}
            </span>
            <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
              LLM
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}
