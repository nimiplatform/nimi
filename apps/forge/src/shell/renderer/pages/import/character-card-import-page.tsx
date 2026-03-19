/**
 * Character Card Import Page — workspace-scoped intake only.
 *
 * Import review and publish now happen inside the owning workbench.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useCharacterCardImport } from '@renderer/features/import/hooks/use-character-card-import.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

export default function CharacterCardImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const applyCharacterCardReviewDraft = useForgeWorkspaceStore((state) => state.applyCharacterCardReviewDraft);
  const {
    validation,
    loadFile,
    mapRules,
  } = useCharacterCardImport();

  const [loading, setLoading] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);

  const handleImport = useCallback(async (file: File) => {
    if (!workspaceId) {
      return;
    }

    setLoading(true);
    setHandoffMessage('Parsing Character Card and writing review draft into the workspace.');

    try {
      const result = await loadFile(file);
      if (!result.success || !result.sourceManifest) {
        return;
      }

      const mapped = await mapRules(result.sourceManifest);
      applyCharacterCardReviewDraft(workspaceId, {
        sessionId: result.sessionId,
        sourceFile: file.name,
        importedAt: result.sourceManifest.importedAt,
        characterName: result.card.data.name,
        sourceManifest: mapped.sourceManifest,
        agentRules: mapped.agentRules,
        worldRules: mapped.worldRules,
      });
      navigate(`/workbench/${workspaceId}?panel=REVIEW`);
    } finally {
      setLoading(false);
      setHandoffMessage(null);
    }
  }, [applyCharacterCardReviewDraft, loadFile, mapRules, navigate, workspaceId]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    await handleImport(file);
  }, [handleImport]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.json')) {
      return;
    }
    await handleImport(file);
  }, [handleImport]);

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-400">Character Card import requires an active workspace.</p>
          <button
            onClick={() => navigate('/workbench')}
            className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
          >
            Back to Workbench
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workbench/${workspaceId}?panel=IMPORT`)}
            className="text-sm text-neutral-400 hover:text-white"
          >
            Back to Workspace
          </button>
          <h1 className="text-xl font-semibold text-white">{t('import.characterCard')}</h1>
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <p className="text-xs uppercase tracking-[0.18em] text-sky-300">Workspace Import</p>
          <h2 className="mt-3 text-lg font-semibold text-white">Character Card flows into workspace review.</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Raw JSON, source fidelity evidence, weak world seeds, and agent truth drafts are written into the current workspace.
            Review and publish happen in the workbench, not on this page.
          </p>
        </div>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-neutral-700 bg-neutral-900/40 p-12 text-center transition-colors hover:border-neutral-500"
        >
          {loading ? (
            <>
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="mt-4 text-sm text-neutral-400">{handoffMessage || 'Preparing workspace review draft.'}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-300">{t('import.dropJson')}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-md bg-neutral-700 px-4 py-1.5 text-sm text-white hover:bg-neutral-600"
              >
                {t('import.browseFiles')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </>
          )}
        </div>

        {validation && !validation.valid ? (
          <div className="rounded-md border border-red-800 bg-red-900/20 p-4">
            <p className="text-sm font-medium text-red-400">{t('import.validationFailed')}</p>
            <ul className="mt-2 space-y-1">
              {validation.errors.map((error, index) => (
                <li key={index} className="text-sm text-red-300">- {error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
