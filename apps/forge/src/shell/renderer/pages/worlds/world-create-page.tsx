/**
 * World Create Page — CREATE pipeline wrapper (FG-WORLD-003)
 *
 * Imports World-Studio's CreateWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateWorkbench } from '@world-engine/ui/create/create-workbench.js';
import { useWorldMutations } from '@renderer/hooks/use-world-mutations.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useWorldCreatePageModel } from './world-create-page-controller';
import { WorldCreateRuleTruthPreview } from './world-create-rule-truth-preview.js';

export default function WorldCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeDraftId = searchParams.get('draftId') || '';
  const userId = useAppStore((state) => state.auth?.user?.id || '');
  const mutations = useWorldMutations();

  const {
    actions,
    clearNotice,
    main,
    routing,
    status,
    workflow,
  } = useWorldCreatePageModel({
    mutations,
    navigate,
    resumeDraftId,
    userId,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/worlds')}
            className="text-sm text-neutral-400 transition-colors hover:text-white"
          >
            &larr; {t('worlds.backToList', 'Back')}
          </button>
          <h1 className="text-lg font-semibold text-white">
            {t('pages.worldCreate', 'Create World')}
          </h1>
        </div>
      </div>

      {status.notice ? (
        <div className="flex items-center justify-between border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400">
          <span>{status.notice}</span>
          <button onClick={clearNotice} className="text-yellow-400/60 hover:text-yellow-400">
            &times;
          </button>
        </div>
      ) : null}

      {workflow.createDisplayStage === 'REVIEW' ? (
        <WorldCreateRuleTruthPreview snapshot={main.snapshot} />
      ) : null}

      <div className="min-h-0 flex-1">
        <CreateWorkbench
          workflow={workflow}
          main={main}
          routing={routing}
          status={status}
          actions={actions}
        />
      </div>
    </div>
  );
}
