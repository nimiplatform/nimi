/**
 * Novel Import Page — workspace-scoped extraction intake.
 *
 * Chapter processing remains here; final review and publish happen in the workbench.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useNovelImport } from '@renderer/features/import/hooks/use-novel-import.js';
import { accumulatorToImportResult } from '@renderer/features/import/state/novel-accumulator.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import { ForgePage, ForgePageHeader, ForgeStatCard, ForgeErrorBanner, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { ForgeSegmentControl, type SegmentOption } from '@renderer/components/segment-control.js';
import type { NovelImportMode } from '@renderer/features/import/types.js';

export default function NovelImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewSyncRef = useRef(false);
  const applyNovelReviewDraft = useForgeWorkspaceStore((state) => state.applyNovelReviewDraft);

  const {
    sessionId,
    machineState,
    mode,
    sourceManifest,
    accumulator,
    currentChapterResult,
    progress,
    error,
    loadFile,
    startExtraction,
    confirmChapter,
    pause,
    resume,
    switchMode,
    resolveConflict,
    finishConflictCheck,
    reset,
  } = useNovelImport();

  const [sourceText, setSourceText] = useState('');
  const [sourceFilename, setSourceFilename] = useState('');

  useEffect(() => {
    reviewSyncRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!workspaceId || machineState !== 'FINAL_REVIEW' || !accumulator || !sourceManifest || reviewSyncRef.current) {
      return;
    }

    const { worldRules, agentRules } = accumulatorToImportResult(accumulator);
    applyNovelReviewDraft(workspaceId, {
      sessionId,
      sourceFile: sourceManifest.sourceFile,
      importedAt: sourceManifest.importedAt,
      sourceManifest,
      accumulator,
      worldRules,
      agentBundles: agentRules,
    });
    reviewSyncRef.current = true;
    navigate(`/workbench/${workspaceId}?panel=AGENTS`);
  }, [
    accumulator,
    applyNovelReviewDraft,
    machineState,
    navigate,
    sessionId,
    sourceManifest,
    workspaceId,
  ]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setSourceFilename(file.name);
    const result = await loadFile(file);
    if (result.success && result.text) {
      setSourceText(result.text);
    }
  }, [loadFile]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    setSourceFilename(file.name);
    const result = await loadFile(file);
    if (result.success && result.text) {
      setSourceText(result.text);
    }
  }, [loadFile]);

  const handleStartExtraction = useCallback(async () => {
    if (!sourceText) {
      return;
    }
    await startExtraction(sourceText, sourceFilename, mode);
  }, [mode, sourceFilename, sourceText, startExtraction]);

  const backAction = (
    <Button
      tone="ghost"
      size="sm"
      onClick={() => {
        reset();
        navigate(workspaceId ? `/workbench/${workspaceId}?panel=IMPORT` : '/workbench');
      }}
    >
      Back to Workspace
    </Button>
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--nimi-text-secondary)]">Novel import requires an active workspace.</p>
          <Button tone="primary" size="sm" onClick={() => navigate('/workbench')} className="mt-3">
            Back to Workbench
          </Button>
        </div>
      </div>
    );
  }

  if (machineState === 'IDLE' || machineState === 'FILE_LOADED') {
    const modeOptions: SegmentOption<NovelImportMode>[] = [
      { value: 'auto', label: t('import.modeAuto') },
      { value: 'manual', label: t('import.modeManual') },
    ];

    return (
      <ForgePage maxWidth="max-w-3xl">
        <ForgePageHeader title={t('import.novel')} actions={backAction} />

        <Surface tone="card" padding="md">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--nimi-status-success)]">Workspace Import</p>
          <h2 className="mt-3 text-lg font-semibold text-[var(--nimi-text-primary)]">Novel extraction accumulates inside one workspace.</h2>
          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
            Chapter chunks, extraction artifacts, conflict decisions, and final rule lineage stay local until the unified workspace review.
          </p>
        </Surface>

        {machineState === 'IDLE' ? (
          <Surface
            tone="card"
            padding="lg"
            className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--nimi-border-subtle)] text-center transition-colors hover:border-[var(--nimi-text-muted)]"
            onDragOver={(event: React.DragEvent) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('import.dropText')}</p>
            <Button tone="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="mt-3">
              {t('import.browseFiles')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.text"
              onChange={handleFileSelect}
              className="hidden"
            />
          </Surface>
        ) : null}

        {machineState === 'FILE_LOADED' && sourceText ? (
          <div className="max-w-xl space-y-4">
            <Surface tone="card" padding="md">
              <p className="text-sm text-[var(--nimi-text-secondary)]">
                {t('import.fileLoaded')}: <span className="text-[var(--nimi-text-primary)]">{sourceFilename}</span>
              </p>
              <p className="text-sm text-[var(--nimi-text-secondary)]">
                {sourceText.length.toLocaleString()} {t('import.characters')}
              </p>
            </Surface>

            <div>
              <label className="mb-2 block text-sm text-[var(--nimi-text-secondary)]">{t('import.extractionMode')}</label>
              <ForgeSegmentControl options={modeOptions} value={mode} onChange={switchMode} />
              <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                {mode === 'auto' ? t('import.modeAutoDesc') : t('import.modeManualDesc')}
              </p>
            </div>

            <Button tone="primary" size="md" onClick={handleStartExtraction}>
              {t('import.startExtraction')}
            </Button>
          </div>
        ) : null}

        {error ? <ForgeErrorBanner message={error} /> : null}
      </ForgePage>
    );
  }

  if (machineState === 'CHUNKING' || machineState === 'EXTRACTING' || machineState === 'ACCUMULATING') {
    return (
      <ForgePage maxWidth="max-w-3xl">
        <ForgePageHeader title={t('import.extracting')} actions={backAction} />

        <div className="max-w-xl space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-sm text-[var(--nimi-text-secondary)]">
              <span>{t('import.chapterProgress')}</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--nimi-surface-panel)]">
              <div
                className="h-full rounded-full bg-[var(--nimi-status-success)] transition-[width] duration-300"
                style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {accumulator ? (
            <div className="grid grid-cols-3 gap-3">
              <ForgeStatCard label={t('import.worldRulesCount')} value={Object.keys(accumulator.worldRules).length} />
              <ForgeStatCard label={t('import.charactersCount')} value={Object.keys(accumulator.characters).length} />
              <ForgeStatCard label={t('import.conflictsCount')} value={accumulator.conflicts.length} />
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button tone="secondary" size="sm" onClick={pause}>
              {t('import.pause')}
            </Button>
            <Button tone="secondary" size="sm" onClick={resume}>
              {t('import.resume')}
            </Button>
          </div>
        </div>
      </ForgePage>
    );
  }

  if (machineState === 'CHAPTER_REVIEW' && currentChapterResult) {
    return (
      <ForgePage maxWidth="max-w-3xl">
        <ForgePageHeader title={t('import.chapterReview')} actions={backAction} />

        <div className="max-w-3xl space-y-4">
          <Surface tone="card" padding="md">
            <p className="text-sm text-[var(--nimi-text-secondary)]">{t('import.chapter')} {currentChapterResult.chapterIndex + 1}</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{currentChapterResult.chapterTitle}</h2>
          </Surface>

          <div className="grid gap-4 md:grid-cols-2">
            <ForgeStatCard label={t('import.worldRulesCount')} value={currentChapterResult.worldRules.length} />
            <ForgeStatCard label={t('import.charactersCount')} value={currentChapterResult.newCharacters.length} />
          </div>

          <Button tone="primary" size="md" onClick={() => confirmChapter()}>
            {t('import.confirmChapter')}
          </Button>
        </div>
      </ForgePage>
    );
  }

  if (machineState === 'PAUSED') {
    return (
      <ForgePage maxWidth="max-w-3xl">
        <ForgePageHeader title={t('import.paused')} actions={backAction} />

        <Surface tone="card" padding="md">
          <p className="text-sm text-[var(--nimi-text-secondary)]">
            Extraction is paused. Resume to continue accumulating into the current workspace draft.
          </p>
          <Button tone="primary" size="md" onClick={resume} className="mt-4">
            {t('import.resume')}
          </Button>
        </Surface>
      </ForgePage>
    );
  }

  if (machineState === 'CONFLICT_CHECK' && accumulator) {
    return (
      <ForgePage maxWidth="max-w-4xl">
        <ForgePageHeader title={t('import.conflictCheck')} actions={backAction} />

        <div className="space-y-4">
          {accumulator.conflicts.map((conflict, index) => (
            <Surface key={`${conflict.ruleKey}:${index}`} tone="card" padding="md">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <code className="text-xs text-[var(--nimi-text-muted)]">{conflict.ruleKey}</code>
                  <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{conflict.previousStatement}</p>
                  <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">{conflict.newStatement}</p>
                </div>
                <div className="flex gap-2">
                  <Button tone="secondary" size="sm" onClick={() => resolveConflict(index, 'KEEP_PREVIOUS')}>
                    Keep Previous
                  </Button>
                  <Button tone="secondary" size="sm" onClick={() => resolveConflict(index, 'USE_NEW')}>
                    Use New
                  </Button>
                  <Button tone="primary" size="sm" onClick={() => resolveConflict(index, 'MERGE', conflict.newStatement)}>
                    Merge
                  </Button>
                </div>
              </div>
            </Surface>
          ))}

          <Button tone="primary" size="md" onClick={finishConflictCheck}>
            {t('import.proceedToReview')}
          </Button>
        </div>
      </ForgePage>
    );
  }

  if (machineState === 'FINAL_REVIEW' || machineState === 'PUBLISHING') {
    return (
      <ForgePage maxWidth="max-w-3xl">
        <ForgePageHeader title={t('import.finalReview')} actions={backAction} />

        <Surface tone="card" padding="md">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Handoff to workspace review</h2>
          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
            Final novel truth is being written into the current workspace review state. Publish remains available only from the workbench publish plan.
          </p>
        </Surface>
      </ForgePage>
    );
  }

  return (
    <ForgePage maxWidth="max-w-3xl">
      <p className="text-sm text-[var(--nimi-text-secondary)]">State: {machineState}</p>
    </ForgePage>
  );
}
