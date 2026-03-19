/**
 * Novel Import Page — workspace-scoped extraction intake.
 *
 * Chapter processing remains here; final review and publish happen in the workbench.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useNovelImport } from '@renderer/features/import/hooks/use-novel-import.js';
import { accumulatorToImportResult } from '@renderer/features/import/state/novel-accumulator.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

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
    navigate(`/workbench/${workspaceId}?panel=REVIEW`);
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

  const backButton = (
    <button
      onClick={() => {
        reset();
        navigate(workspaceId ? `/workbench/${workspaceId}?panel=IMPORT` : '/workbench');
      }}
      className="text-sm text-neutral-400 hover:text-white"
    >
      Back to Workspace
    </button>
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-400">Novel import requires an active workspace.</p>
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

  if (machineState === 'IDLE' || machineState === 'FILE_LOADED') {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.novel')}</h1>
        </div>

        <div className="mb-6 rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Workspace Import</p>
          <h2 className="mt-3 text-lg font-semibold text-white">Novel extraction accumulates inside one workspace.</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Chapter chunks, extraction artifacts, conflict decisions, and final rule lineage stay local until the unified workspace review.
          </p>
        </div>

        {machineState === 'IDLE' ? (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-600 bg-neutral-800/30 p-12 text-center transition-colors hover:border-neutral-400"
          >
            <p className="text-sm text-neutral-300">{t('import.dropText')}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 rounded-md bg-neutral-700 px-4 py-1.5 text-sm text-white hover:bg-neutral-600"
            >
              {t('import.browseFiles')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.text"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : null}

        {machineState === 'FILE_LOADED' && sourceText ? (
          <div className="max-w-xl space-y-4">
            <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
              <p className="text-sm text-neutral-300">
                {t('import.fileLoaded')}: <span className="text-white">{sourceFilename}</span>
              </p>
              <p className="text-sm text-neutral-400">
                {sourceText.length.toLocaleString()} {t('import.characters')}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm text-neutral-400">{t('import.extractionMode')}</label>
              <div className="flex gap-3">
                <button
                  onClick={() => switchMode('auto')}
                  className={`rounded-md px-3 py-1.5 text-sm ${mode === 'auto' ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300'}`}
                >
                  {t('import.modeAuto')}
                </button>
                <button
                  onClick={() => switchMode('manual')}
                  className={`rounded-md px-3 py-1.5 text-sm ${mode === 'manual' ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300'}`}
                >
                  {t('import.modeManual')}
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {mode === 'auto' ? t('import.modeAutoDesc') : t('import.modeManualDesc')}
              </p>
            </div>

            <button
              onClick={handleStartExtraction}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {t('import.startExtraction')}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-md border border-red-800 bg-red-900/20 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : null}
      </div>
    );
  }

  if (machineState === 'CHUNKING' || machineState === 'EXTRACTING' || machineState === 'ACCUMULATING') {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.extracting')}</h1>
        </div>

        <div className="max-w-xl space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-sm text-neutral-400">
              <span>{t('import.chapterProgress')}</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-700">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {accumulator ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-3 text-center">
                <p className="text-lg font-semibold text-white">{Object.keys(accumulator.worldRules).length}</p>
                <p className="text-xs text-neutral-400">{t('import.worldRulesCount')}</p>
              </div>
              <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-3 text-center">
                <p className="text-lg font-semibold text-white">{Object.keys(accumulator.characters).length}</p>
                <p className="text-xs text-neutral-400">{t('import.charactersCount')}</p>
              </div>
              <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-3 text-center">
                <p className="text-lg font-semibold text-white">{accumulator.conflicts.length}</p>
                <p className="text-xs text-neutral-400">{t('import.conflictsCount')}</p>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <button
              onClick={pause}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
            >
              {t('import.pause')}
            </button>
            <button
              onClick={resume}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
            >
              {t('import.resume')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (machineState === 'CHAPTER_REVIEW' && currentChapterResult) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.chapterReview')}</h1>
        </div>

        <div className="max-w-3xl space-y-4">
          <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
            <p className="text-sm text-neutral-400">{t('import.chapter')} {currentChapterResult.chapterIndex + 1}</p>
            <h2 className="mt-2 text-lg font-semibold text-white">{currentChapterResult.chapterTitle}</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
              <h3 className="text-sm font-medium text-white">{t('import.worldRulesCount')}</h3>
              <p className="mt-2 text-2xl font-semibold text-white">{currentChapterResult.worldRules.length}</p>
            </div>
            <div className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
              <h3 className="text-sm font-medium text-white">{t('import.charactersCount')}</h3>
              <p className="mt-2 text-2xl font-semibold text-white">{currentChapterResult.newCharacters.length}</p>
            </div>
          </div>

          <button
            onClick={() => confirmChapter()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {t('import.confirmChapter')}
          </button>
        </div>
      </div>
    );
  }

  if (machineState === 'PAUSED') {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.paused')}</h1>
        </div>

        <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <p className="text-sm text-neutral-400">
            Extraction is paused. Resume to continue accumulating into the current workspace draft.
          </p>
          <button
            onClick={resume}
            className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {t('import.resume')}
          </button>
        </div>
      </div>
    );
  }

  if (machineState === 'CONFLICT_CHECK' && accumulator) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.conflictCheck')}</h1>
        </div>

        <div className="max-w-4xl space-y-4">
          {accumulator.conflicts.map((conflict, index) => (
            <div key={`${conflict.ruleKey}:${index}`} className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <code className="text-xs text-neutral-500">{conflict.ruleKey}</code>
                  <p className="mt-2 text-sm text-neutral-300">{conflict.previousStatement}</p>
                  <p className="mt-2 text-sm text-neutral-400">{conflict.newStatement}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveConflict(index, 'KEEP_PREVIOUS')}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                  >
                    Keep Previous
                  </button>
                  <button
                    onClick={() => resolveConflict(index, 'USE_NEW')}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                  >
                    Use New
                  </button>
                  <button
                    onClick={() => resolveConflict(index, 'MERGE', conflict.newStatement)}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Merge
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={finishConflictCheck}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {t('import.proceedToReview')}
          </button>
        </div>
      </div>
    );
  }

  if (machineState === 'FINAL_REVIEW' || machineState === 'PUBLISHING') {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          {backButton}
          <h1 className="text-xl font-semibold text-white">{t('import.finalReview')}</h1>
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <h2 className="text-lg font-semibold text-white">Handoff to workspace review</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Final novel truth is being written into the current workspace review state. Publish remains available only from the workbench publish plan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <p className="text-sm text-neutral-400">State: {machineState}</p>
    </div>
  );
}
