/**
 * Character Card Import Page — workspace-scoped intake only.
 *
 * Import review and publish now happen inside the owning workbench.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useCharacterCardImport } from '@renderer/features/import/hooks/use-character-card-import.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { ForgePage, ForgePageHeader, ForgeLoadingSpinner, ForgeErrorBanner } from '@renderer/components/page-layout.js';

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
          <p className="text-sm text-[var(--nimi-text-secondary)]">Character Card import requires an active workspace.</p>
          <Button tone="primary" size="sm" onClick={() => navigate('/workbench')} className="mt-3">
            Back to Workbench
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ForgePage maxWidth="max-w-3xl">
      <ForgePageHeader
        title={t('import.characterCard')}
        actions={
          <Button tone="ghost" size="sm" onClick={() => navigate(`/workbench/${workspaceId}?panel=IMPORT`)}>
            Back to Workspace
          </Button>
        }
      />

      <Surface tone="card" padding="md">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--nimi-status-info)]">Workspace Import</p>
        <h2 className="mt-3 text-lg font-semibold text-[var(--nimi-text-primary)]">Character Card flows into workspace review.</h2>
        <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
          Raw JSON, source fidelity evidence, weak world seeds, and agent truth drafts are written into the current workspace.
          Review and publish happen in the workbench, not on this page.
        </p>
      </Surface>

      <Surface
        tone="card"
        padding="lg"
        className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--nimi-border-subtle)] text-center transition-colors hover:border-[var(--nimi-text-muted)]"
        onDragOver={(event: React.DragEvent) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {loading ? (
          <>
            <ForgeLoadingSpinner />
            <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{handoffMessage || 'Preparing workspace review draft.'}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('import.dropJson')}</p>
            <Button tone="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="mt-3">
              {t('import.browseFiles')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
          </>
        )}
      </Surface>

      {validation && !validation.valid ? (
        <ForgeErrorBanner message={t('import.validationFailed')} />
      ) : null}

      {validation && !validation.valid ? (
        <Surface tone="card" padding="sm" className="border-[var(--nimi-status-danger)]">
          <ul className="space-y-1">
            {validation.errors.map((error, index) => (
              <li key={index} className="text-sm text-[var(--nimi-status-danger)]">- {error}</li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </ForgePage>
  );
}
