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
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeFullscreenState,
  ForgeLoadingSpinner,
  ForgeErrorBanner,
} from '@renderer/components/page-layout.js';

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
      <ForgeFullscreenState
        title="Character Card Import"
        message="Character Card import requires an active workspace."
        action="Back to Workbench"
        onAction={() => navigate('/workbench')}
      />
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

      <ForgeSection className="space-y-3" material="glass-regular">
        <ForgeSectionHeading
          eyebrow="Workspace Import"
          title="Character Card flows into workspace review."
          description="Raw JSON, source fidelity evidence, weak world seeds, and agent truth drafts are written into the current workspace. Review and publish happen in the workbench, not on this page."
        />
      </ForgeSection>

      <ForgeSection
        className="border-2 border-dashed border-[var(--nimi-border-subtle)] text-center transition-colors hover:border-[var(--nimi-text-muted)]"
        material="glass-regular"
      >
        <div
          className="flex flex-col items-center justify-center py-6"
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
        </div>
      </ForgeSection>

      {validation && !validation.valid ? (
        <ForgeErrorBanner message={t('import.validationFailed')} />
      ) : null}

      {validation && !validation.valid ? (
        <Surface tone="card" material="glass-thin" padding="sm" className="border-[var(--nimi-status-danger)]">
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
